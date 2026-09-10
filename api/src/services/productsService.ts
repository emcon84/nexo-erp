import csvParser from "csv-parser";
import fs from "fs";
import { basePrisma, prisma } from "../config/db";
import { syncHqStock } from "./stockService";
import { recomputeForCsvImport } from "./priceLooseService";
import { normalizeProductName } from "../utils/productName";

interface ProductInput {
  name: string;
  price: number;
  code?: string;
  description: string;
  category: string;
  image: string;
  quantity: number;
  /** Extra columns (variant values keyed by variant definition name) */
  _variantColumns?: Record<string, string>;
}

/**
 * Resuelve el nombre de categoría (texto libre, viene del CSV o del form de
 * alta manual) a un Category.id de la organización. Crea la categoría si no
 * existe todavía (evita que el ADMIN tenga que precrearlas a mano).
 * Recibe basePrisma + organizationId explícito (no `prisma` con scope
 * automático) porque bulkAddProducts corre dentro de un callback de stream,
 * fuera del AsyncLocalStorage del request.
 */
export const resolveCategoryId = async (
  categoryName: string | undefined | null,
  organizationId: string,
): Promise<string | null> => {
  const name = categoryName?.trim();
  if (!name) return null;

  // Path-based lookup: "Perros > Alimento Seco (Balanceado)"
  if (name.includes(">")) {
    const parts = name.split(">").map(s => s.trim()).filter(Boolean);
    let parentId: string | null = null;

    for (const part of parts) {
      let cat: { id: string; name: string; organizationId: string } | null = await basePrisma.category.findFirst({
        where: { organizationId, name: part, parentId },
      });
      if (!cat) {
        cat = await basePrisma.category.create({
          data: { name: part, organizationId, parentId: parentId as any },
        });
      }
      parentId = cat.id;
    }

    return parentId;
  }

  // Simple name lookup (backward compat)
  const existing = await basePrisma.category.findFirst({
    where: { organizationId, name },
  });
  if (existing) return existing.id;

  const created = await basePrisma.category.create({
    data: { name, organizationId },
  });
  return created.id;
};

/**
 * Carga masiva de productos desde un CSV, asignándolos a la organización dada.
 * Recibe el organizationId explícito porque el insert ocurre dentro de un
 * callback de stream (donde el contexto de tenant por AsyncLocalStorage puede
 * no estar disponible); por eso usamos basePrisma + organizationId explícito.
 */
export const bulkAddProducts = async (
  filePath: string,
  organizationId: string,
): Promise<{ count: number; errors: string[] }> => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`El archivo no existe en la ruta especificada: ${filePath}`);
  }

  const KNOWN_COLUMNS = new Set(["name", "price", "code", "description", "category", "image", "quantity"]);

  return new Promise((resolve, reject) => {
    const rows: ProductInput[] = [];

    fs.createReadStream(filePath)
      .pipe(csvParser())
      .on("data", (row: any) => {
        // Strip BOM from column names (Excel UTF-8 CSVs)
        const cleanRow: Record<string, string> = {};
        for (const key of Object.keys(row)) {
          const cleanKey = key.replace(/^\uFEFF/, "").trim();
          cleanRow[cleanKey] = row[key];
        }

        // Separate known columns from variant columns
        const variantColumns: Record<string, string> = {};
        for (const key of Object.keys(cleanRow)) {
          if (!KNOWN_COLUMNS.has(key) && cleanRow[key]?.trim()) {
            variantColumns[key] = cleanRow[key].trim();
          }
        }
        rows.push({
          name: normalizeProductName(cleanRow.name ?? ""),
          price: parseFloat(cleanRow.price),
          code: cleanRow.code || undefined,
          description: cleanRow.description,
          category: cleanRow.category,
          image: cleanRow.image,
          quantity: parseInt(cleanRow.quantity, 10),
          _variantColumns: Object.keys(variantColumns).length > 0 ? variantColumns : undefined,
        });
      })
      .on("end", async () => {
        try {
          const errors: string[] = [];
          let productsCreated = 0;
          const createdIds: string[] = [];

          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const lineNum = i + 2; // +2 for header row + 1-based

            try {
              const categoryId = await resolveCategoryId(row.category, organizationId);

              // If no variants, use create directly
              if (!row._variantColumns || Object.keys(row._variantColumns).length === 0 || !categoryId) {
                const product = await basePrisma.product.create({
                  data: {
                    name: row.name,
                    price: row.price,
                    code: row.code,
                    description: row.description,
                    categoryId: categoryId ?? null,
                    image: row.image,
                    quantity: row.quantity,
                    organizationId,
                  },
                });

                // Mantener ProductStock(HQ) sincronizado (spec D4). basePrisma
                // explícito: corre dentro del callback del stream, fuera del ALS.
                if (row.quantity !== undefined) {
                  await syncHqStock(organizationId, product.id, row.quantity, basePrisma);
                }

                createdIds.push(product.id);
                productsCreated++;
                continue;
              }

              // Resolve variant columns to option IDs
              const variantDefs = await basePrisma.categoryVariantDefinition.findMany({
                where: { categoryId },
                include: { options: true },
              });

              const defMap = new Map(variantDefs.map(d => [d.name, d]));
              const optionIds: string[] = [];
              const unmatched: string[] = [];

              for (const [colName, colValue] of Object.entries(row._variantColumns)) {
                const def = defMap.get(colName);
                if (!def) {
                  unmatched.push(`"${colName}" (la categoría "${row.category}" no tiene esa variante)`);
                  continue;
                }
                const option = def.options.find(
                  o => o.value.toLowerCase() === colValue.toLowerCase(),
                );
                if (!option) {
                  const available = def.options.map(o => o.value).join(", ");
                  unmatched.push(`"${colName}=${colValue}" (valores disponibles: ${available})`);
                  continue;
                }
                optionIds.push(option.id);
              }

              if (unmatched.length > 0) {
                errors.push(`Fila ${lineNum} (${row.name}): ${unmatched.join("; ")}`);
              }

              // Create product with variants
              const product = await basePrisma.product.create({
                data: {
                  name: row.name,
                  price: row.price,
                  code: row.code,
                  description: row.description,
                  categoryId,
                  image: row.image,
                  quantity: row.quantity,
                  organizationId,
                },
              });

              if (optionIds.length > 0) {
                await basePrisma.productVariant.createMany({
                  data: optionIds.map(optionId => ({
                    productId: product.id,
                    optionId,
                    organizationId,
                  })),
                });
              }

              // Mantener ProductStock(HQ) sincronizado (spec D4). basePrisma
              // explícito: corre dentro del callback del stream, fuera del ALS.
              if (row.quantity !== undefined) {
                await syncHqStock(organizationId, product.id, row.quantity, basePrisma);
              }

              createdIds.push(product.id);
              productsCreated++;
            } catch (rowError: any) {
              errors.push(`Fila ${lineNum} (${row.name || "sin nombre"}): ${rowError.message}`);
            }
          }

          // B-05d: recompute priceKgSuelto for all newly created products.
          if (createdIds.length > 0) {
            await recomputeForCsvImport(basePrisma, organizationId, createdIds);
          }

          resolve({ count: productsCreated, errors });
        } catch (error) {
          reject(error);
        }
      })
      .on("error", (error: any) => {
        reject(error);
      });
  });
};

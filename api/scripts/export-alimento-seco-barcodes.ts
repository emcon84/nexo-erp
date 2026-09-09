/**
 * Exporta un listado de los productos de "Alimento Seco" de la organización con
 * su estado de código de barras: los que YA tienen `barcode` (EAN-13/UPC) y los
 * que NO.
 *
 * Útil para descartar los que ya están listos y trabajar sobre los que faltan.
 *
 * Categorías consideradas: todas las de la org cuyo nombre normalizado contiene
 * "alimento seco" (ej. "Alimento Seco (Balanceado)" bajo Perros y Gatos).
 *
 * Env:
 *   ORG_SLUG = slug de la organización (default el-almacen-de-las-mascotas)
 *
 * Usage (salida a stdout para redirigir a un archivo; el resumen va a stderr):
 *   npx ts-node scripts/export-alimento-seco-barcodes.ts > alimento-seco-barcodes.csv
 */
import "dotenv/config";
import { basePrisma } from "../src/config/db";

const DEFAULT_ORG_SLUG = "el-almacen-de-las-mascotas";

export const resolveOrgSlug = (env: NodeJS.ProcessEnv = process.env): string =>
  env.ORG_SLUG || DEFAULT_ORG_SLUG;

/** Normaliza un nombre: minúsculas, sin acentos, espacios colapsados. */
const normalizeName = (name: string): string =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Escapa un valor para CSV delimitado por ';' (Excel AR). */
const csvCell = (value: string): string => {
  const s = value ?? "";
  const needQuote = /[";\n\r]/.test(s);
  return needQuote ? `"${s.replace(/"/g, '""')}"` : s;
};

const hasBarcode = (value: string | null | undefined): boolean =>
  Boolean(value && value.trim().length > 0);

export interface ProductRow {
  name: string;
  species: string;
  barcode: string;
  code: string;
}

async function main() {
  const slug = resolveOrgSlug();

  const org = await basePrisma.organization.findFirst({ where: { slug } });
  if (!org) throw new Error(`Organización no encontrada (slug='${slug}')`);

  const [categories, products] = await Promise.all([
    basePrisma.category.findMany({
      where: { organizationId: org.id },
      select: { id: true, name: true, parentId: true },
    }),
    basePrisma.product.findMany({
      where: { organizationId: org.id },
      select: {
        id: true,
        name: true,
        categoryId: true,
        barcode: true,
        code: true,
      },
    }),
  ]);

  const byId = new Map(categories.map((c) => [c.id, c]));
  const secoCategoryIds = new Set<string>();
  for (const c of categories) {
    if (normalizeName(c.name).includes("alimento seco")) {
      secoCategoryIds.add(c.id);
    }
  }

  const speciesOf = (categoryId: string | null): string => {
    const cat = categoryId ? byId.get(categoryId) : undefined;
    const parent = cat?.parentId ? byId.get(cat.parentId) : undefined;
    const haystack = normalizeName(`${parent?.name ?? ""} ${cat?.name ?? ""}`);
    if (haystack.includes("perro")) return "Perro";
    if (haystack.includes("gato")) return "Gato";
    return "Sin especie";
  };

  const rows: ProductRow[] = [];
  for (const p of products) {
    if (!p.categoryId || !secoCategoryIds.has(p.categoryId)) continue;
    rows.push({
      name: p.name,
      species: speciesOf(p.categoryId),
      barcode: p.barcode ?? "",
      code: p.code ?? "",
    });
  }

  // Orden: primero los que NO tienen barcode (los "por hacer"), luego los que sí.
  // Dentro de cada grupo, alfabético por nombre.
  const sorted = rows.slice().sort((a, b) => {
    const aMissing = !hasBarcode(a.barcode);
    const bMissing = !hasBarcode(b.barcode);
    if (aMissing !== bMissing) return aMissing ? -1 : 1;
    return a.name.localeCompare(b.name, "es", { sensitivity: "base" });
  });

  const header = "NOMBRE;ESPECIE;CODIGO_SKU;CODIGO_BARRA;TIENE_BARRA";
  const lines = [header];
  for (const r of sorted) {
    lines.push(
      [
        csvCell(r.name),
        csvCell(r.species),
        csvCell(r.code),
        csvCell(r.barcode),
        hasBarcode(r.barcode) ? "SI" : "NO",
      ].join(";"),
    );
  }

  process.stdout.write(lines.join("\n") + "\n");

  const sinBarra = rows.filter((r) => !hasBarcode(r.barcode)).length;
  const conBarra = rows.length - sinBarra;
  console.error(
    `\n[${org.name}] Alimento seco: ${rows.length} productos ` +
      `(${sinBarra} SIN código de barras | ${conBarra} CON código de barras).`,
  );
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error("FATAL:", err);
      process.exit(1);
    })
    .finally(async () => {
      await basePrisma.$disconnect();
    });
}

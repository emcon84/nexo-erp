import { Request, Response } from "express";
import { prisma, basePrisma } from "../config/db";
import { bulkAddProducts, resolveCategoryId } from "../services/productsService";
import {
  syncHqStock,
  canEditBranchStock,
  getStockSummary as getStockSummaryService,
} from "../services/stockService";
import {
  recomputeForProduct,
  recomputeForBulkPriceUpdate,
  recomputeForCsvImport,
} from "../services/priceLooseService";
import { findCellForProduct, normalizeName } from "../services/priceMatchingService";
import { roundBolsaPriceIfHigh } from "../utils/money";
import { isUnitSellable, computePerUnitPrice } from "../utils/unitsPerBox";
import { parseScaleBarcode } from "../utils/scaleBarcode";
import { requireOrganizationId } from "../config/tenantContext";
import { PLAN_LIMITS } from "../config/planLimits";
import { AuthedRequest } from "../middlewares/authMiddleware";

/**
 * BranchIds del usuario leídos de la DB (design D3: la DB es la fuente de
 * verdad, el token nunca lo es — las asignaciones pueden cambiar a mitad de
 * sesión). BranchAssignment no es tenant-scoped (no tiene organizationId): el
 * filtro por userId es seguro y global.
 */
const readUserBranchIds = async (userId: string): Promise<string[]> => {
  const assignments = await basePrisma.branchAssignment.findMany({
    where: { userId },
    select: { branchId: true },
  });
  return assignments.map((a) => a.branchId);
};

// Create a new product (organizationId lo inyecta la extension de Prisma).
// Alta manual: exige categoryId real (elegido de un <select>), no nombre.
// Se valida que la categoría exista y pertenezca a la org ANTES del create
// (findFirst, no findUnique — bloqueado por la extensión multi-tenant de
// db.ts) para no dejar reventar como error de FK 500 ni filtrar categoryId
// de otra organización.
const createProduct = async (req: Request, res: Response) => {
  try {
    const { categoryId, variantOptionIds, ...data } = req.body;
    const category = await prisma.category.findFirst({
      where: { id: categoryId },
    });
    if (!category) {
      return res
        .status(400)
        .json({ message: "La categoría indicada no existe" });
    }

    // Validate variantOptionIds belong to the category's variant definitions
    if (variantOptionIds && variantOptionIds.length > 0) {
      const validOptions = await prisma.categoryVariantOption.findMany({
        where: {
          id: { in: variantOptionIds },
          variant: { categoryId },
        },
      });
      if (validOptions.length !== variantOptionIds.length) {
        return res
          .status(400)
          .json({ message: "Algunas opciones de variante no pertenecen a esta categoría" });
      }
    }

    const product = await prisma.product.create({
      data: { ...data, categoryId },
    });

    // Mantener ProductStock(HQ) sincronizado con el quantity del body (spec
    // D4): crear con quantity=10 deja ProductStock(HQ)=10 y Product.quantity=10.
    if (data.quantity !== undefined) {
      await syncHqStock(requireOrganizationId(), product.id, data.quantity);
    }

    // Create ProductVariant rows
    if (variantOptionIds && variantOptionIds.length > 0) {
      const orgId = requireOrganizationId();
      await prisma.productVariant.createMany({
        data: variantOptionIds.map((optionId: string) => ({
          productId: product.id,
          optionId,
          organizationId: orgId,
        })),
      });
    }

    // Return product with variant assignments
    const created = await prisma.product.findFirst({
      where: { id: product.id },
      include: {
        variantAssignments: {
          include: {
            option: {
              include: { variant: true },
            },
          },
        },
      },
    });

    res.status(201).json(created);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
};

// Bulk upload products (array en el body)
const bulkUploadProducts = async (req: Request, res: Response) => {
  try {
    const products = req.body;
    if (!Array.isArray(products)) {
      return res
        .status(400)
        .json({ message: "Request body must be an array of products" });
    }

    const organizationId = requireOrganizationId();
    const results = [];

    for (const { category, variantOptionIds, ...rest } of products) {
      const categoryId = await resolveCategoryId(category, organizationId);

      // If the product has variantOptionIds, create individually to
      // get the product ID back (createMany doesn't return IDs in PostgreSQL).
      if (variantOptionIds && variantOptionIds.length > 0) {
        // Validate options belong to the category
        if (categoryId) {
          const validOptions = await prisma.categoryVariantOption.findMany({
            where: {
              id: { in: variantOptionIds },
              variant: { categoryId },
            },
          });
          if (validOptions.length !== variantOptionIds.length) {
            console.warn(
              `[bulkUploadProducts] Skipping variant assignments for "${rest.name}": some options don't belong to category "${category}"`,
            );
          }
        }

        const product = await prisma.product.create({
          data: { ...rest, categoryId: categoryId ?? null },
        });

        if (variantOptionIds.length > 0 && categoryId) {
          await prisma.productVariant.createMany({
            data: variantOptionIds.map((optionId: string) => ({
              productId: product.id,
              optionId,
              organizationId,
            })),
          });
        }

        if (rest.quantity !== undefined) {
          await syncHqStock(organizationId, product.id, rest.quantity);
        }

        results.push(product);
      } else {
        // No variants — use create directly
        const product = await prisma.product.create({
          data: { ...rest, categoryId: categoryId ?? null },
        });

        if (rest.quantity !== undefined) {
          await syncHqStock(organizationId, product.id, rest.quantity);
        }

        results.push(product);
      }
    }

    res
      .status(201)
      .json({ message: "Products added successfully", data: results });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
};

export const uploadProductsCsv = async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  try {
    const organizationId = requireOrganizationId();
    const result = await bulkAddProducts(req.file.path, organizationId);
    res.status(201).json({
      message: `${result.count} productos importados`,
      count: result.count,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  } catch (error) {
    console.error("Error processing file:", error);
    res.status(500).json({ message: "Error processing file", error });
  }
};

/**
 * GET /products/template-csv?category=Collares
 * Público — devuelve un CSV de plantilla con las columnas base + columnas de
 * variantes según la categoría indicada. Busca la categoría globalmente (sin
 * scope de org) porque la plantilla es solo nombres de columnas, no datos
 * sensibles.
 */
export const downloadTemplateCsv = async (req: Request, res: Response) => {
  try {
    const categoryName = req.query.category as string | undefined;
    const BASE_COLUMNS = ["name", "price", "description", "category", "image", "quantity"];
    let columns = [...BASE_COLUMNS];

    if (categoryName) {
      // Buscar categoría globalmente — la estructura de variantes es la misma
      // para cualquier org que tenga esa categoría.
      const category = await basePrisma.category.findFirst({
        where: { name: categoryName },
        include: {
          variantDefs: { orderBy: { name: "asc" } },
        },
      });

      if (category && category.variantDefs.length > 0) {
        for (const def of category.variantDefs) {
          columns.push(def.name);
        }
      }
    }

    // Add example row
    const exampleRow = ["Ejemplo Producto", "1500", "Descripción opcional", categoryName || "Collares", "", "10"];
    // Add example variant values for each variant column
    if (categoryName) {
      const exampleDefs = columns.length - BASE_COLUMNS.length;
      for (let i = 0; i < exampleDefs; i++) {
        exampleRow.push("valor de ejemplo");
      }
    }

    const csv = [columns.join(","), exampleRow.join(",")].join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="plantilla-productos${categoryName ? "-" + categoryName.replace(/\s+/g, "-").toLowerCase() : ""}.csv"`,
    );
    res.status(200).send("\uFEFF" + csv); // BOM for Excel UTF-8
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// Get all products with optional filters (scopeado por org vía extension)
/**
 * Where de búsqueda por texto (GET /products?name=...).
 *
 * Semántica:
 * - La COMA separa términos ALTERNATIVOS (OR) — multi-marca: "Purina, Proplan"
 *   matchea productos de cualquiera de las dos (nombre, código o variante).
 * - Dentro de cada término, los ESPACIOS son AND de palabras: "cat chow carne"
 *   matchea "CAT CHOW ADULTOS CARNE X 15 KG" aunque las palabras estén separadas.
 *
 * Sin comas el resultado es byte-for-byte el comportamiento original.
 */
// Sinónimos de RAZA (razas pequeñas vs medianas/grandes). Mantener las listas
// EXACTAMENTE iguales al frontend (pullstok-front/src/lib/productFilter.ts).
const SMALL_BREED_PHRASES = [
  "sm", "razas pequeñas", "razas pequenas", "raza pequeña", "raza pequena",
  "razas peq", "raza peq", "small breed", "razas chicas", "razas mini",
  "talla pequeña", "talla pequena",
];
const LARGE_BREED_PHRASES = [
  "lg", "m&g", "razas m&g", "razas medianas o grandes", "razas medianas y grandes",
  "razas medianas", "razas grandes", "raza mediana", "raza grande", "large breed",
];
const SMALL_REMOVE = ["razas", "raza", "pequeña", "pequeñas", "pequena", "pequenas", "peq", "chicas", "mini", "talla", "small", "breed"];
const LARGE_REMOVE = ["razas", "raza", "mediana", "medianas", "grande", "grandes", "m&g", "o", "y", "talla", "large", "breed"];

export function buildProductSearchWhere(searchTerm: string): any {
  const variantMatch = (w: string) => ({
    variantAssignments: {
      some: {
        option: {
          value: { contains: w, mode: "insensitive" as const },
        },
      },
    },
  });

  // Detección de raza dentro de un término. Devuelve las palabras "regulares"
  // (AND) y los tokens de búsqueda de raza (OR). Con breedTokens vacío el
  // resultado es el comportamiento original.
  const extractBreed = (words: string[]): { regular: string[]; breedTokens: string[] } => {
    const term = words.join(" ");
    const smallActive = SMALL_BREED_PHRASES.some(p => term.includes(p));
    const largeActive = LARGE_BREED_PHRASES.some(p => term.includes(p));
    let regular = words;
    let breedTokens: string[] = [];
    if (smallActive) {
      regular = regular.filter(w => !SMALL_REMOVE.includes(w));
      breedTokens = breedTokens.concat(SMALL_BREED_PHRASES);
    }
    if (largeActive) {
      regular = regular.filter(w => !LARGE_REMOVE.includes(w));
      breedTokens = breedTokens.concat(LARGE_BREED_PHRASES);
    }
    return { regular, breedTokens };
  };

  // AND de palabras dentro de un término, integrando los tokens de raza.
  const buildAndWhere = (words: string[]) => {
    const { regular, breedTokens } = extractBreed(words);
    const regularWhere = regular.map(w => ({
      OR: [
        { name: { contains: w, mode: "insensitive" } },
        { code: { contains: w, mode: "insensitive" } },
        variantMatch(w),
      ],
    }));
    if (breedTokens.length === 0) {
      return { AND: regularWhere };
    }
    return {
      AND: [
        ...regularWhere,
        {
          OR: breedTokens.map(t => ({
            OR: [
              { name: { contains: t, mode: "insensitive" } },
              { code: { contains: t, mode: "insensitive" } },
              variantMatch(t),
            ],
          })),
        },
      ],
    };
  };

  const termWhere = (term: string) => {
    const termWords = term.split(/\s+/).filter(w => w.length > 0);
    return termWords.length > 1
      ? buildAndWhere(termWords)
      : {
          OR: [
            { name: { contains: term, mode: "insensitive" } },
            { code: { contains: term, mode: "insensitive" } },
            variantMatch(term),
          ],
        };
  };

  const terms = searchTerm
    .split(",")
    .map(t => t.trim())
    .filter(t => t.length > 0);
  if (terms.length > 1) {
    return { OR: terms.map(termWhere) };
  }
  const words = searchTerm.split(/\s+/).filter(w => w.length > 0);
  if (words.length > 1) {
    return buildAndWhere(words);
  }
  return {
    OR: [
      { name: { contains: searchTerm, mode: "insensitive" } },
      { code: { contains: searchTerm, mode: "insensitive" } },
      variantMatch(searchTerm),
    ],
  };
}

/**
 * Candidate WHERE para el filtro `?title=` (sdd/alican-plan-titles). El front
 * deriva la clave de una sección como `[brand, line, subline].filter(Boolean)
 * .join("|")` (contract exacto). Prisma no puede concatenar columnas en un
 * WHERE, así que se enumeran las asignaciones posibles de las partes a los 3
 * campos en orden, con los campos NO usados fijados a null: así cada candidato
 * matchea EXACTAMENTE las secciones cuya clave compuesta da el valor buscado
 * (una sección con brand+line+subline NO matchea una clave de 2 partes porque
 * su candidato exige null en el campo sobrante). Asunción: las secciones del
 * PDF Alican siempre llevan brand; si el día de mañana una sección tuviera
 * solo line+subline (brand null) el candidato {line, subline} la cubre igual.
 */
export function planTitleWhereCandidates(
  key: string,
): { brand: string | null; line: string | null; subline: string | null }[] {
  const parts = key
    .split("|")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 1) {
    return [{ brand: parts[0], line: null, subline: null }];
  }
  if (parts.length === 2) {
    return [
      { brand: parts[0], line: parts[1], subline: null },
      { brand: parts[0], line: null, subline: parts[1] },
      { brand: null, line: parts[0], subline: parts[1] },
    ];
  }
  if (parts.length === 3) {
    return [{ brand: parts[0], line: parts[1], subline: parts[2] }];
  }
  return [];
}

const PLAN_LIST_TYPES = ["SECO", "WET"] as const;
type PlanListType = (typeof PLAN_LIST_TYPES)[number];

/**
 * Resuelve el query param opcional ?priceListType= (SECO|WET). Ausente → SECO
 * (comportamiento legacy byte-for-byte). Valor inválido → error 400 con
 * mensaje claro. La validación vive en el controller porque el filtro llega
 * por query string, no por body (donde ya existe el zod de los schemas).
 */
function resolvePriceListType(
  raw: string | undefined,
): { value: PlanListType } | { error: string } {
  if (raw === undefined) return { value: "SECO" };
  if (raw === "SECO" || raw === "WET") return { value: raw };
  return {
    error: `Tipo de planilla inválido: "${raw}". Valores permitidos: "SECO" o "WET".`,
  };
}

const getProducts = async (req: Request, res: Response) => {
  try {
    const { name, category, minPrice, maxPrice, description, branchId, title } = req.query;

    const planType = resolvePriceListType(
      req.query.priceListType as string | undefined,
    );
    if ("error" in planType) {
      res.status(400).json({ message: planType.error });
      return;
    }

    const where: any = {};

    if (title) {
      const candidates = planTitleWhereCandidates(title as string);
      if (candidates.length === 0) {
        // Clave sin partes válidas: ningún producto puede matchearla.
        where.id = "__no-match__";
      } else {
        where.priceListEntries = {
          some: {
            matched: true,
            section: {
              priceList: { type: planType.value },
              OR: candidates,
            },
          },
        };
      }
    }

    // ?priceListType= presente → filtra por pertenencia a la planilla de ese
    // tipo (solo productos con entries matcheadas del tipo elegido). Ausente →
    // comportamiento actual sin filtro de pertenencia.
    if (req.query.priceListType !== undefined) {
      const membership = {
        some: {
          matched: true,
          section: { priceList: { type: planType.value } },
        },
      };
      if (where.priceListEntries) {
        // El filtro por título ya fijó un `some` sobre la misma relación
        // (Prisma no permite dos claves `some`): se combinan como AND.
        where.priceListEntries = {
          some: { AND: [where.priceListEntries.some, membership.some] },
        };
      } else {
        where.priceListEntries = membership;
      }
    }

    if (name) {
      const searchTerm = name as string;
      Object.assign(where, buildProductSearchWhere(searchTerm));
    }
    // "Solo lo que trabajo": ?carriedOnly=1 (o true) → solo productos con
    // carried=true (oculta los que se pueden pedir pero no se venden aún).
    if (req.query.carriedOnly === "1" || req.query.carriedOnly === "true") {
      where.carried = true;
    }
    if (category) {
      where.category = { name: { equals: category as string, mode: "insensitive" } };
    }
    if (minPrice || maxPrice) {
      where.price = {};
      if (minPrice) where.price.gte = parseFloat(minPrice as string);
      if (maxPrice) where.price.lte = parseFloat(maxPrice as string);
    }
    if (description) {
      where.description = {
        contains: description as string,
        mode: "insensitive",
      };
    }
    const include = {
      category: { select: { id: true, name: true } },
      provider: { select: { id: true, name: true } },
      variantAssignments: {
        include: {
          option: {
            include: { variant: { select: { id: true, name: true } } },
          },
        },
      },
      // Sección de planilla del tipo seleccionado (?priceListType=, default
      // SECO) MÁS RECIENTE (sdd/alican-plan-titles): solo brand/line/subline/
      // position. NUNCA se exponen precios de proveedor.
      priceListEntries: {
        where: {
          matched: true,
          section: { priceList: { type: planType.value } },
        },
        orderBy: { section: { priceList: { period: "desc" as const } } },
        take: 1,
        select: {
          section: {
            select: { brand: true, line: true, subline: true, position: true },
          },
        },
      },
      ...(branchId
        ? {
            stocks: {
              where: { branchId: branchId as string },
              select: { quantity: true },
            },
          }
        : {}),
    };

    // Exponer solo la sección de la planilla (planSection) y descartar el array
    // completo de entries (que incluiría precios de proveedor si se ampliara).
    // sdd/venta-por-unidad-multpack: además expone `unitsPerBox` (columna nueva)
    // y el `perUnitPrice` DERIVADO (round2(price/unitsPerBox)) on-the-fly — nunca
    // persistido. `null` cuando el producto no es vendible por unidad.
    const mapProduct = (p: any) => {
      const { priceListEntries, unitsPerBox, ...rest } = p;
      return {
        ...rest,
        unitsPerBox: unitsPerBox ?? null,
        perUnitPrice: isUnitSellable(unitsPerBox)
          ? computePerUnitPrice(Number(p.price), unitsPerBox)
          : null,
        planSection:
          Array.isArray(priceListEntries) && priceListEntries.length > 0
            ? priceListEntries[0].section ?? null
            : null,
      };
    };

    // Paginación SERVER-SIDE opt-in (vendor dashboard). Solo se activa cuando
    // `page` y `pageSize` están presentes y son enteros positivos; si vienen
    // malformados o faltan, se mantiene el comportamiento legacy byte-for-byte
    // (array plano). Los llamadores existentes no cambian su shape.
    let page: number | undefined;
    let pageSize: number | undefined;

    const rawPage = Number(req.query.page);
    const rawPageSize = Number(req.query.pageSize);
    if (
      req.query.page !== undefined &&
      req.query.pageSize !== undefined &&
      Number.isInteger(rawPage) &&
      Number.isInteger(rawPageSize) &&
      rawPage > 0 &&
      rawPageSize > 0
    ) {
      page = rawPage;
      pageSize = rawPageSize;
    }

    if (page !== undefined && pageSize !== undefined) {
      // orderBy determinista para que skip/take no derive entre páginas (solo
      // afecta a la rama paginada — los llamadores legacy no se reordenan).
      const take = pageSize;
      const skip = (page - 1) * pageSize;

      const [items, total] = await Promise.all([
        prisma.product.findMany({ where, include, take, skip, orderBy: { name: "asc" } }),
        prisma.product.count({ where }),
      ]);

      res.status(200).json({
        items: items.map(mapProduct),
        total,
        page,
        pageSize,
        hasMore: skip + items.length < total,
      });
      return;
    }

    const products = await prisma.product.findMany({ where, include });
    res.status(200).json(products.map(mapProduct));
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * GET /products/filter-facets?category=...
 * Complete filter facets for the vendor dashboard chips, independent of the
 * paginated product list (which only reflects loaded pages). Always returns
 * ALL categories of the org that have at least one product, sorted by name.
 * Variants are derived only from products whose category matches the optional
 * `category` param (case-insensitive substring); without the param → [].
 * Tenant scoping is handled by the extended Prisma client (TENANT_MODELS).
 */
export const getProductFilterFacets = async (req: Request, res: Response) => {
  try {
    const organizationId = requireOrganizationId();
    const category = req.query.category as string | undefined;

    const planType = resolvePriceListType(
      req.query.priceListType as string | undefined,
    );
    if ("error" in planType) {
      res.status(400).json({ message: planType.error });
      return;
    }

    const categories = await prisma.category.findMany({
      where: { products: { some: {} } },
      select: { id: true, name: true },
    });
    categories.sort((a, b) => a.name.localeCompare(b.name));

    let variants: { name: string; values: string[] }[] = [];

    if (category && category.trim() !== "") {
      const products = await prisma.product.findMany({
        where: {
          category: { name: { contains: category, mode: "insensitive" } },
        },
        select: {
          categoryId: true,
          category: { select: { id: true, name: true } },
          variantAssignments: {
            select: {
              option: { select: { value: true, variant: { select: { name: true } } } },
            },
          },
        },
      });

      const groups: Record<string, Set<string>> = {};
      for (const p of products) {
        for (const a of p.variantAssignments) {
          const variantName = a.option.variant.name;
          const optionValue = a.option.value;
          if (variantName && optionValue) {
            if (!groups[variantName]) groups[variantName] = new Set();
            groups[variantName].add(optionValue);
          }
        }
      }
      variants = Object.entries(groups)
        .map(([name, values]) => ({ name, values: [...values].sort() }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    // Títulos de planilla del tipo seleccionado (sdd/alican-plan-titles,
    // default SECO): mismas reglas que el include de GET /products — entries
    // matcheadas de planillas de ese tipo de la org actual. La clave compuesta
    // y la etiqueta replican EXACTAMENTE la derivación del front
    // (src/lib/printGrouping.ts). El count cuenta productos DISTINTOS por
    // título (un producto puede aparecer en varias filas/secciones). El orden
    // es por position de sección (orden del PDF) y luego alfabético.
    const entries = await prisma.priceListEntry.findMany({
      where: {
        matched: true,
        productId: { not: null },
        section: { priceList: { organizationId, type: planType.value } },
      },
      select: {
        productId: true,
        section: {
          select: { brand: true, line: true, subline: true, position: true },
        },
      },
    });

    const byKey = new Map<
      string,
      { key: string; label: string; count: number; position: number }
    >();
    const productsPerKey = new Map<string, Set<string>>();
    for (const e of entries) {
      const s = e.section;
      if (!s.brand && !s.subline) continue; // sin marca ni sublínea no hay título
      if (!e.productId) continue; // el where ya filtra not null; guard para TS
      const key = [s.brand, s.line, s.subline].filter(Boolean).join("|");
      const label = s.subline ?? s.brand ?? "";
      const bucket = byKey.get(key) ?? { key, label, count: 0, position: Infinity };
      if (!productsPerKey.has(key)) productsPerKey.set(key, new Set());
      if (!productsPerKey.get(key)!.has(e.productId)) {
        productsPerKey.get(key)!.add(e.productId);
        bucket.count += 1;
      }
      bucket.position = Math.min(bucket.position, s.position);
      byKey.set(key, bucket);
    }
    const titles = [...byKey.values()]
      .map((t) => ({ key: t.key, label: t.label, count: t.count }))
      .sort((a, b) => {
        const pa = byKey.get(a.key)!.position;
        const pb = byKey.get(b.key)!.position;
        if (pa !== pb) return pa - pb;
        return a.label.localeCompare(b.label, "es");
      });

    res.status(200).json({ categories, variants, titles });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// Get a single product by ID
const getProductById = async (req: Request, res: Response) => {
  try {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id },
      include: {
        category: { select: { id: true, name: true } },
        provider: { select: { id: true, name: true } },
        variantAssignments: {
          include: {
            option: {
              include: { variant: { select: { id: true, name: true } } },
            },
          },
        },
      },
    });
    if (product) {
      res.status(200).json(product);
    } else {
      res.status(404).json({ message: "Product not found" });
    }
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// Update a product by ID
const updateProduct = async (req: Request, res: Response) => {
  try {
    const { variantOptionIds, ...data } = req.body;

    // Precio de BOLSA CERRADA >= 500 → múltiplo de 100; < 500 se conserva.
    // NO se toca priceKgSuelto (venta por kg) ni suggestedPrice.
    if (data.price !== undefined && data.price !== null) {
      data.price = roundBolsaPriceIfHigh(Number(data.price));
    }

    // Manual per-kg price override (decisión #201): an explicit number fixes
    // the value by hand (priceKgSueltoManual=true, recompute skips it); null
    // returns to the automatic computation (flag=false); absent = untouched.
    if (data.priceKgSuelto !== undefined) {
      data.priceKgSueltoManual = data.priceKgSuelto === null ? false : true;
    }

    // If categoryId is changing, clear old variant assignments
    if (data.categoryId !== undefined) {
      const existing = await prisma.product.findFirst({
        where: { id: req.params.id },
        select: { categoryId: true },
      });
      if (existing && existing.categoryId !== data.categoryId) {
        // Validate the incoming options against the NEW category BEFORE
        // deleting anything: re-inserting options from another category would
        // leave the product inconsistent (createProduct rejects them with 400,
        // so duplicating such a product would fail). Empty array stays allowed
        // (clears the assignments).
        if (variantOptionIds && variantOptionIds.length > 0) {
          const validOptions = await prisma.categoryVariantOption.findMany({
            where: {
              id: { in: variantOptionIds },
              variant: { categoryId: data.categoryId },
            },
          });
          if (validOptions.length !== variantOptionIds.length) {
            return res
              .status(400)
              .json({ message: "Algunas opciones de variante no pertenecen a esta categoría" });
          }
        }
        await prisma.productVariant.deleteMany({
          where: { productId: req.params.id },
        });
      }
    }

    const result = await prisma.product.updateMany({
      where: { id: req.params.id },
      data,
    });
    if (result.count === 0) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Recompute priceKgSuelto after any data change that may affect it
    // (price, weightKg, bulkFactor). Runs inside the same implied tx.
    await recomputeForProduct(prisma, req.params.id);

    // Sincronizar ProductStock(HQ) cuando la edición trae quantity (spec D4).
    if (data.quantity !== undefined) {
      await syncHqStock(requireOrganizationId(), req.params.id, data.quantity);
    }

    // Handle variantOptionIds if provided
    if (variantOptionIds !== undefined) {
      // Clear existing
      await prisma.productVariant.deleteMany({
        where: { productId: req.params.id },
      });

      // Insert new ones
      if (variantOptionIds.length > 0) {
        const orgId = requireOrganizationId();
        await prisma.productVariant.createMany({
          data: variantOptionIds.map((optionId: string) => ({
            productId: req.params.id,
            optionId,
            organizationId: orgId,
          })),
        });
      }
    }

    const product = await prisma.product.findFirst({
      where: { id: req.params.id },
      include: {
        category: { select: { id: true, name: true } },
        provider: { select: { id: true, name: true } },
        variantAssignments: {
          include: {
            option: {
              include: { variant: { select: { id: true, name: true } } },
            },
          },
        },
      },
    });
    res.status(200).json(product);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
};

// Toggle "Publicar en tienda" (WS4 — UI dedicada de Tienda/listado de
// productos). Acción de un solo campo, separada de updateProduct para que
// la UI pueda togglear sin mandar el resto del producto.
const publishProduct = async (req: Request, res: Response) => {
  try {
    const { publishedToStore } = req.body as { publishedToStore: boolean };
    const result = await prisma.product.updateMany({
      where: { id: req.params.id },
      data: { publishedToStore },
    });
    if (result.count === 0) {
      return res.status(404).json({ message: "Product not found" });
    }
    const product = await prisma.product.findFirst({
      where: { id: req.params.id },
    });
    res.status(200).json(product);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
};

// Delete a product by ID
const deleteProduct = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const product = await prisma.product.findFirst({ where: { id } });
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // No permitir borrar productos asociados a órdenes o presupuestos.
    const hasOrders = await prisma.orderItem.findFirst({
      where: { productId: id },
    });
    if (hasOrders) {
      return res.status(400).json({
        message: "No se puede eliminar: el producto tiene órdenes asociadas",
      });
    }

    const hasBudgets = await prisma.quotationItem.findFirst({
      where: { productId: id },
    });
    if (hasBudgets) {
      return res.status(400).json({
        message: "No se puede eliminar: el producto tiene presupuestos asociados",
      });
    }

    const result = await prisma.product.deleteMany({ where: { id } });
    // Si deleteMany borró 0 filas, el id no existía → NO es éxito. Antes se
    // devolvía 200 "deleted" aunque no se borrara nada (el front mostraba éxito).
    if (result.count === 0) {
      return res.status(404).json({ message: "Product not found" });
    }
    res.status(200).json({ message: "Product deleted successfully" });
  } catch (error: any) {
    // FK constraint: el producto tiene dependencias sin onDelete Cascade
    // (variantes, stock, listas de precio) → avisar claro en vez del 500 crudo.
    if (error?.code === "P2003") {
      return res.status(400).json({
        message:
          "No se puede eliminar: el producto tiene datos asociados (variantes, stock o listas de precio)",
      });
    }
    res.status(500).json({ message: error.message });
  }
};

/**
 * GET /products/by-code/:code
 * Búsqueda rápida por código de barras / SKU.
 */
export const getProductByCode = async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const organizationId = requireOrganizationId();
    const product = await prisma.product.findFirst({
      where: {
        organizationId,
        OR: [{ code }, { barcode: code }],
      },
      // Include mínimo (mobile): el scanner solo pinta category.name y
      // option.value + variant.name. No se trae el árbol de variantes completo.
      include: {
        category: { select: { id: true, name: true } },
        variantAssignments: {
          include: {
            option: {
              select: {
                id: true,
                value: true,
                variantId: true,
                variant: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });
    if (!product) return res.status(404).json({ message: "Producto no encontrado" });

    // Precio por kg de la LISTA de precios suelto (PriceKgPrice) — fuente
    // autoritativa para el scanner. NO usar product.priceKgSuelto (B-01/B-04):
    // para bolsas suele ser el valor DERIVADO del precio por unidad
    // (price/weightKg × factor) y puede no coincidir con la lista de suelto.
    let priceKgLista: number | null = null;
    if (product.categoryId) {
      const [categories, brands, types, cells] = await Promise.all([
        prisma.category.findMany({
          where: { organizationId },
          select: { id: true, name: true, parentId: true },
        }),
        prisma.priceKgBrand.findMany({
          where: { organizationId },
          select: { id: true, name: true, keywords: true },
        }),
        prisma.priceKgType.findMany({
          where: { organizationId },
          select: { id: true, name: true, synonyms: true },
        }),
        prisma.priceKgPrice.findMany({
          where: { organizationId },
          select: { id: true, brandId: true, typeId: true, species: true, priceKg: true },
        }),
      ]);
      const categoryById = new Map(categories.map((c) => [c.id, c]));
      const { cell } = findCellForProduct(
        { id: product.id, name: product.name, categoryId: product.categoryId },
        brands as any,
        types as any,
        categoryById as any,
        cells as any,
      );
      priceKgLista = cell?.priceKg ?? null;
    }

    res.status(200).json({ ...product, priceKgLista });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * GET /products/offline-snapshot
 * Snapshot liviano del catálogo (org-scoped) para operar OFFLINE (Fase 1, solo
 * lectura): el scanner/búsqueda resuelven contra datos locales en el celular.
 * NO trae includes pesados; solo lo que la tarjeta del scanner necesita.
 * `priceKgLista` = precio por kg de la LISTA de suelto (PriceKgPrice, resuelto
 * con findCellForProduct), NO el priceKgSuelto derivado de la bolsa.
 */
export const getOfflineSnapshot = async (req: Request, res: Response) => {
  try {
    const organizationId = requireOrganizationId();

    const [categories, brands, types, cells, products] = await Promise.all([
      prisma.category.findMany({
        where: { organizationId },
        select: { id: true, name: true, parentId: true },
      }),
      prisma.priceKgBrand.findMany({
        where: { organizationId },
        select: { id: true, name: true, keywords: true },
      }),
      prisma.priceKgType.findMany({
        where: { organizationId },
        select: { id: true, name: true, synonyms: true },
      }),
      prisma.priceKgPrice.findMany({
        where: { organizationId },
        select: { id: true, brandId: true, typeId: true, species: true, priceKg: true },
      }),
      prisma.product.findMany({
        where: { organizationId },
        select: {
          id: true,
          name: true,
          code: true,
          barcode: true,
          price: true,
          description: true,
          categoryId: true,
          priceKgSuelto: true,
          priceKgSueltoManual: true,
          category: { select: { name: true } },
          variantAssignments: {
            select: {
              option: {
                select: {
                  id: true,
                  value: true,
                  variantId: true,
                  variant: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      }),
    ]);

    const categoryById = new Map(categories.map((c) => [c.id, c]));

    const snapshot = products.map((p) => {
      const { cell } = findCellForProduct(
        { id: p.id, name: p.name, categoryId: p.categoryId },
        brands as any,
        types as any,
        categoryById as any,
        cells as any,
      );
      return {
        id: p.id,
        name: p.name,
        code: p.code,
        barcode: p.barcode,
        price: p.price,
        priceKgLista: cell?.priceKg ?? null,
        priceKgSuelto: p.priceKgSuelto,
        priceKgSueltoManual: p.priceKgSueltoManual,
        description: p.description,
        categoryId: p.categoryId,
        categoryName: p.category?.name ?? null,
        variants: (p.variantAssignments || []).map((va) => ({
          value: va.option.value,
          variantName: va.option.variant.name,
          variantId: va.option.variantId,
          optionId: va.option.id,
        })),
      };
    });

    res.status(200).json(snapshot);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * GET /products/by-scan/:barcode
 * Resuelve un código escaneado (pistola). Si es etiqueta de balanza (EAN-13 que
 * empieza por «20») extrae scaleCode + peso en gramos, busca la CELDA de la
 * planilla "Precios por kilo" (PriceKgPrice) por scaleCode y devuelve su
 * precio/kg + nombre (marca · tipo) + peso en kg. El POS lo agrega como línea
 * POR_PESO. Si NO es etiqueta de balanza, cae al lookup normal por code/barcode.
 * Devuelve 400 si el código es ilegible, 404 si no hay celda/producto.
 */
export const getProductByScan = async (req: Request, res: Response) => {
  try {
    const { barcode } = req.params;
    const organizationId = requireOrganizationId();
    const parsed = parseScaleBarcode(barcode);
    if (parsed === null) {
      return res.status(400).json({ message: "Código de barras inválido" });
    }

    if (parsed.isScale) {
      const cell = await prisma.priceKgPrice.findFirst({
        where: { organizationId, scaleCode: parsed.code },
        include: {
          brand: { select: { name: true } },
          type: { select: { name: true } },
        },
      });
      if (!cell) {
        return res.status(404).json({ message: "Celda suelta no encontrada para el código de balanza" });
      }
      const looseName = `${cell.brand.name} · ${cell.type.name}`;
      return res.status(200).json({
        isScale: true,
        scaleCode: parsed.code,
        weightGram: parsed.weightGrams,
        weightKg: parsed.weightKg,
        cell: { id: cell.id, priceKg: cell.priceKg, brandName: cell.brand.name, typeName: cell.type.name, species: cell.species },
        looseName,
        priceKg: cell.priceKg,
        total: Math.round(parsed.weightKg * cell.priceKg * 100) / 100,
      });
    }

    const product = await prisma.product.findFirst({
      where: { organizationId, OR: [{ code: barcode }, { barcode }] },
      include: {
        category: { select: { id: true, name: true } },
        variantAssignments: { include: { option: { include: { variant: true } } } },
      },
    });
    if (!product) return res.status(404).json({ message: "Producto no encontrado" });
    return res.status(200).json({ product, isScale: false });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * POST /products/bulk-price-update — actualización masiva de precios
 * (sdd/bulk-price-update-selectors). Selectores: brands (multi, obligatorio) +
 * categoryIds (node ids; el server expande cada subtree) + excludeProductIds
 * (exclusiones por producto) + percentage con signo (−100..500, clamp ≥ 0,
 * 2 decimales). dryRun=true → preview paginada (50/page) con agregados sobre el
 * set completo; apply → re-resuelve el set DENTRO de un $transaction interactivo
 * (autoritativo, nunca confía en el preview).
 */

// Cap del set afectado (spec/design: BULK_UPDATE_MAX = 5000). Preview y apply
// lo reutilizan; superarlo → 400 (no se ejecuta nada).
export const BULK_UPDATE_MAX = 5000;
const PREVIEW_PAGE_SIZE = 50;

/** newPrice = price * (1 + margin/100) * (1 + pct/100), clamp ≥ 0, round 2.
 * La ganancia (margin) se aplica SIEMPRE primero; el % de aumento (pct) compone
 * por encima (multiplicativa). margin ausente = 0 (back-compat). */
export const computeNewPrice = (price: number, pct: number, margin = 0) =>
  Math.max(0, Math.round(price * (1 + margin / 100) * (1 + pct / 100) * 100) / 100);

/**
 * Expande cada category node a SÍ MISMO + todos sus descendientes caminando la
 * self-relation org-scoped Category.parentId/children. Deduplica la unión.
 * Ids desconocidos no lanzan error (sin descendientes, inofensivos: el where
 * con `in: [idDesconocido]` no matchea productos de la org).
 */
export async function resolveCategoryScope(
  tx: any,
  categoryIds: string[],
): Promise<string[]> {
  if (categoryIds.length === 0) return [];
  const cats = await tx.category.findMany({ select: { id: true, parentId: true } });
  const children = new Map<string, string[]>();
  for (const c of cats) {
    if (c.parentId) {
      if (!children.has(c.parentId)) children.set(c.parentId, []);
      children.get(c.parentId)!.push(c.id);
    }
  }
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (!seen.has(id)) {
      seen.add(id);
      (children.get(id) ?? []).forEach(walk);
    }
  };
  categoryIds.forEach(walk);
  return [...seen];
}

/**
 * Where común de preview y apply: brand (some option.value in brandValues sobre
 * variant "Marca") AND categoryId in expanded (solo si hay expansión) AND id
 * notIn excludeProductIds (solo si hay exclusiones) AND providerId in
 * providerIds (solo si hay proveedores — sdd/alican-wholesale-price-list/providers:
 * el filtro de marcas y el de proveedores se combinan como AND) AND id in
 * sectionProductIds (solo si hay secciones de planilla — restringe a los
 * productos matcheados de esas líneas del PDF) AND priceListEntries.some sobre
 * el tipo de planilla seleccionado (priceListTypes SECO/WET — solo si hay
 * tipos, scoped por org anti-fuga). SIN filtro publishedToStore: aplica a
 * TODOS los productos matcheados, incluidos no publicados (comportamiento
 * confirmado).
 */
export function buildBulkPriceWhere(
  brandValues: string[],
  expanded: string[],
  excludeProductIds: string[],
  providerIds: string[] = [],
  sectionProductIds: string[] = [],
  priceListTypes: string[] = [],
  organizationId?: string,
) {
  const where: any = {};
  if (brandValues.length > 0) {
    where.variantAssignments = {
      some: {
        option: {
          value: { in: brandValues },
          variant: { name: "Marca" },
        },
      },
    };
  }
  if (expanded.length > 0) where.categoryId = { in: expanded };
  if (excludeProductIds.length > 0) where.id = { notIn: excludeProductIds };
  if (providerIds.length > 0) where.providerId = { in: providerIds };
  if (sectionProductIds.length > 0) {
    where.id = { ...(where.id ?? {}), in: sectionProductIds };
  }
  if (priceListTypes.length > 0) {
    where.priceListEntries = {
      some: {
        section: {
          priceList: {
            type: { in: priceListTypes },
            ...(organizationId ? { organizationId } : {}),
          },
        },
      },
    };
  }
  return where;
}

/**
 * Productos matcheados de las secciones de planilla seleccionadas (líneas del
 * PDF). Anti-fuga por org: las secciones se filtran vía su PriceList
 * (organizationId). Vacío → [] sin tocar la DB. El resultado se dedupea.
 */
export async function resolveSectionProductIds(
  tx: any,
  orgId: string,
  sectionIds: string[],
): Promise<string[]> {
  if (sectionIds.length === 0) return [];
  const entries = (await tx.priceListEntry.findMany({
    where: {
      section: { id: { in: sectionIds }, priceList: { organizationId: orgId } },
      productId: { not: null },
    },
    select: { productId: true },
  })) as { productId: string | null }[];
  return [...new Set(entries.map((e) => e.productId!))];
}

/**
 * Mapa productId → % efectivo por sección de planilla (línea del PDF).
 * Anti-fuga por org: las secciones se filtran vía su PriceList
 * (organizationId). Vacío → Map vacío sin tocar la DB. Si un producto está
 * en varias secciones con override, gana el PRIMERO encontrado.
 */
export async function resolveSectionPercentageByProduct(
  tx: any,
  orgId: string,
  sectionPercentages: { sectionId: string; percentage: number }[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (sectionPercentages.length === 0) return map;
  const pctBySection = new Map(sectionPercentages.map((s) => [s.sectionId, s.percentage]));
  const entries = (await tx.priceListEntry.findMany({
    where: {
      section: { id: { in: [...pctBySection.keys()] }, priceList: { organizationId: orgId } },
      productId: { not: null },
    },
    select: { productId: true, sectionId: true },
  })) as { productId: string | null; sectionId: string }[];
  for (const e of entries) {
    if (e.productId && !map.has(e.productId)) {
      map.set(e.productId, pctBySection.get(e.sectionId)!);
    }
  }
  return map;
}

/**
 * Mapa id → parentId de todas las categorías de la org. Lo usan preview y
 * apply para caminar ancestros al resolver el % efectivo de un producto
 * (override de categoría hereda a TODO su subtree: nodo y descendientes).
 */
export function buildCategoryParentMap(
  cats: { id: string; parentId: string | null }[],
): ReadonlyMap<string, string | null> {
  return new Map(cats.map((c) => [c.id, c.parentId]));
}

/**
 * % efectivo de un producto: override por producto > override por sección de
 * planilla (línea del PDF) > override del nodo de categoría o su ancestro más
 * cercano (incl. sí mismo) > global. 0% explícito es válido (incluido pero sin
 * cambio de precio). null categoryId → salta la caminata de ancestros.
 * productOverrides desconocido → null (producto sin override, se resuelve por
 * categoría/global).
 */
export function resolveEffectivePercentage(a: {
  productId: string | null;
  categoryId: string | null;
  parentById: ReadonlyMap<string, string | null>;
  productPercentages: ReadonlyMap<string, number>;
  sectionPercentages?: ReadonlyMap<string, number>;
  categoryPercentages: ReadonlyMap<string, number>;
  globalPct: number;
}): number {
  if (a.productId !== null && a.productPercentages.has(a.productId)) {
    return a.productPercentages.get(a.productId)!;
  }
  const sectionPct = a.sectionPercentages ?? new Map<string, number>();
  if (a.productId !== null && sectionPct.has(a.productId)) {
    return sectionPct.get(a.productId)!;
  }
  let catId = a.categoryId;
  while (catId !== null) {
    const override = a.categoryPercentages.get(catId);
    if (override !== undefined) return override;
    catId = a.parentById.get(catId) ?? null;
  }
  return a.globalPct;
}

export const bulkPriceUpdate = async (req: Request, res: Response) => {
  try {
    const {
      brandValues,
      percentage,
      margin,
      categoryIds = [],
      excludeProductIds = [],
      providerIds = [],
      priceListSectionIds = [],
      priceListTypes = [],
      categoryPercentages = [],
      productPercentages = [],
      sectionPercentages = [],
    } = req.body as {
      brandValues: string[];
      percentage?: number;
      margin?: number;
      categoryIds?: string[];
      excludeProductIds?: string[];
      providerIds?: string[];
      priceListSectionIds?: string[];
      priceListTypes?: ("SECO" | "WET")[];
      categoryPercentages?: { categoryId: string; percentage: number }[];
      productPercentages?: { productId: string; percentage: number }[];
      sectionPercentages?: { sectionId: string; percentage: number }[];
    };
    const dryRun = req.query.dryRun === "true";
    const organizationId = requireOrganizationId();
    // Global opcional: sin valor → 0 (productos sin override no cambian).
    const globalPct = percentage ?? 0;

    const expanded = await resolveCategoryScope(prisma, categoryIds);
    const sectionProductIds = await resolveSectionProductIds(
      prisma,
      organizationId,
      priceListSectionIds,
    );
    const where = buildBulkPriceWhere(
      brandValues,
      expanded,
      excludeProductIds,
      providerIds,
      sectionProductIds,
      priceListTypes,
      organizationId,
    );

    // Overrides: mapa de ancestros (para heredar override de categoría al
    // subtree) + maps de % por categoría/producto. Preview Y apply resuelven
    // el % efectivo con resolveEffectivePercentage (misma fuente de verdad).
    const cats = await prisma.category.findMany({
      select: { id: true, parentId: true },
    });
    const parentById = buildCategoryParentMap(cats);
    const catPctMap = new Map(
      categoryPercentages.map((c) => [c.categoryId, c.percentage]),
    );
    const prodPctMap = new Map(
      productPercentages.map((p) => [p.productId, p.percentage]),
    );
    // Overrides por sección de planilla (línea del PDF): mapa productId → %.
    // Se resuelve fuera del tx para el preview; el apply lo RE-resuelve dentro
    // del $transaction (autoritativo — nunca confía en un preview stale).
    const sectionPctMap = await resolveSectionPercentageByProduct(
      prisma,
      organizationId,
      sectionPercentages,
    );

    const products = await prisma.product.findMany({
      where,
      select: {
        id: true,
        name: true,
        price: true,
        categoryId: true,
        category: { select: { name: true } },
        variantAssignments: {
          select: {
            option: { select: { value: true, variant: { select: { name: true } } } },
          },
        },
      },
    });

    const rows = products.map((p) => {
      const oldPrice = Math.round(Number(p.price) * 100) / 100;
      const effectivePercentage = resolveEffectivePercentage({
        productId: p.id,
        categoryId: p.categoryId ?? null,
        parentById,
        productPercentages: prodPctMap,
        sectionPercentages: sectionPctMap,
        categoryPercentages: catPctMap,
        globalPct,
      });
      const newPrice = roundBolsaPriceIfHigh(computeNewPrice(oldPrice, effectivePercentage, margin ?? 0));
      return {
        id: p.id,
        name: p.name,
        categoryName: p.category?.name ?? null,
        brandValues: p.variantAssignments
          .filter((a) => a.option.variant.name === "Marca")
          .map((a) => a.option.value),
        oldPrice,
        newPrice,
        delta: Math.round((newPrice - oldPrice) * 100) / 100,
        effectivePercentage,
      };
    });

    const affected = rows.length;
    const previousTotal =
      Math.round(rows.reduce((s, r) => s + r.oldPrice, 0) * 100) / 100;
    const newTotal =
      Math.round(rows.reduce((s, r) => s + r.newPrice, 0) * 100) / 100;

    if (!dryRun) {
      // Apply: re-resuelve el set afectado DENTRO del $transaction (autoritativo
      // — nunca confía en un preview stale). Cap y exclusiones se chequean
      // in-tx para que el >cap NUNCA escriba (rollback implícito).
      const result = await prisma.$transaction(async (tx) => {
        const expandedTx = await resolveCategoryScope(tx, categoryIds);
        // Apply autoritativo: re-resuelve los productIds de las secciones
        // DENTRO del tx (nunca confía en el preview stale).
        const sectionProductIdsTx = await resolveSectionProductIds(
          tx,
          organizationId,
          priceListSectionIds,
        );
        // Overrides por sección: re-resuelto DENTRO del tx (autoritativo, mismo
        // patrón que resolveSectionProductIds — nunca confía en el preview).
        const sectionPctMapTx = await resolveSectionPercentageByProduct(
          tx,
          organizationId,
          sectionPercentages,
        );
        const rowsTx = await tx.product.findMany({
          where: buildBulkPriceWhere(
            brandValues,
            expandedTx,
            excludeProductIds,
            providerIds,
            sectionProductIdsTx,
            priceListTypes,
            organizationId,
          ),
          select: { id: true, price: true, categoryId: true },
        });
        if (rowsTx.length === 0) {
          return { affected: 0, previousTotal: 0, newTotal: 0, overCap: false };
        }
        if (rowsTx.length > BULK_UPDATE_MAX) {
          return { affected: rowsTx.length, previousTotal: 0, newTotal: 0, overCap: true };
        }
        // Autoritativo: cada producto lleva su % EFECTIVO (product > section >
        // categoría ancestro más cercana > global), igual que el preview. Nunca
        // global a ciegas — los overrides se aplican al escribir (REQ-5).
        const updates = rowsTx.map((r) => {
          const effective = resolveEffectivePercentage({
            productId: r.id,
            categoryId: r.categoryId ?? null,
            parentById,
            productPercentages: prodPctMap,
            sectionPercentages: sectionPctMapTx,
            categoryPercentages: catPctMap,
            globalPct,
          });
          return {
            id: r.id,
            newPrice: roundBolsaPriceIfHigh(computeNewPrice(Number(r.price), effective, margin ?? 0)),
          };
        });
        await Promise.all(
          updates.map((u) =>
            tx.product.updateMany({ where: { id: u.id }, data: { price: u.newPrice } }),
          ),
        );

        // B-05c: recompute priceKgSuelto for the SAME resolved set after
        // the price writes, inside the same $transaction. Overrides (per-product
        // bulkFactor) are resolved per row by the service.
        const recomputeWhere = buildBulkPriceWhere(
          brandValues,
          expandedTx,
          excludeProductIds,
          providerIds,
          sectionProductIdsTx,
          priceListTypes,
          organizationId,
        );
        await recomputeForBulkPriceUpdate(tx, recomputeWhere, organizationId);

        const prevTotal =
          Math.round(rowsTx.reduce((s, r) => s + Number(r.price), 0) * 100) / 100;
        const newTot =
          Math.round(updates.reduce((s, u) => s + u.newPrice, 0) * 100) / 100;
        return { affected: updates.length, previousTotal: prevTotal, newTotal: newTot, overCap: false };
      });

      if (result.overCap) {
        return res.status(400).json({
          message: `El lote supera el máximo de ${BULK_UPDATE_MAX} productos. Ajustá el alcance.`,
        });
      }
      if (result.affected === 0) {
        return res.status(400).json({
          message: "Todos los productos fueron excluidos o no hay coincidencias",
        });
      }
      return res.status(200).json({
        affected: result.affected,
        previousTotal: result.previousTotal,
        newTotal: result.newTotal,
      });
    }

    // Preview (dryRun): cap y paginación; agregados sobre el set COMPLETO.
    if (affected > BULK_UPDATE_MAX) {
      return res.status(400).json({
        message: `El lote supera el máximo de ${BULK_UPDATE_MAX} productos. Ajustá el alcance.`,
      });
    }
    // all=true → devuelve TODAS las filas (impresión). Respeta exclusiones y
    // overrides; el cap de 5000 ya se chequeó arriba.
    if (req.query.all === "true") {
      return res.status(200).json({
        affected,
        previousTotal,
        newTotal,
        page: 1,
        pageSize: rows.length,
        total: rows.length,
        rows,
      });
    }
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const slice = rows.slice((page - 1) * PREVIEW_PAGE_SIZE, page * PREVIEW_PAGE_SIZE);
    res.status(200).json({
      affected,
      previousTotal,
      newTotal,
      page,
      pageSize: PREVIEW_PAGE_SIZE,
      total: rows.length,
      rows: slice,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * POST /products/bulk-carried — marca/desmarca el flag "carried" de varios
 * productos a la vez (selección múltiple en la tabla del admin). Solo ADMIN.
 */
export const bulkCarried = async (req: Request, res: Response) => {
  try {
    const organizationId = requireOrganizationId();
    const { productIds, carried } = req.body;
    const result = await prisma.product.updateMany({
      where: { id: { in: productIds }, organizationId },
      data: { carried },
    });
    return res.status(200).json({ updated: result.count });
  } catch (error: any) {
    console.error("Error actualizando carried (bulk):", error);
    return res.status(500).json({ message: "Error al actualizar" });
  }
};

/**
 * POST /products/bulk-publish — publica/despublica en la tienda online todos
 * los productos de la org que tengan asignada la variante "Marca" con un valor
 * IN brandValues (mismo where por marca que bulkPriceUpdate, reutilizado vía
 * buildBulkPriceWhere). Solo ADMIN/MANAGEMENT.
 *
 * Si publicado (publishedToStore === true) respeta el tope de productos
 * publicables del plan (maxStoreProducts): si el total resultante supera el
 * límite responde 403 { error: "PLAN_LIMIT" } (PREMIUM es ilimitado → null).
 * Devuelve { count } = productos actualizados.
 */
export const bulkPublish = async (req: Request, res: Response) => {
  try {
    const organizationId = requireOrganizationId();
    const { brandValues, publishedToStore } = req.body as {
      brandValues: string[];
      publishedToStore: boolean;
    };
    // Reutiliza el where por marca de bulkPriceUpdate (variante "Marca").
    const where = buildBulkPriceWhere(brandValues, [], [], [], [], [], organizationId);

    if (publishedToStore) {
      const org = await basePrisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
      });
      const limit = PLAN_LIMITS[org.plan].maxStoreProducts;
      if (limit !== null) {
        // current = ya publicados; toPublish = matcheados por marca aún no
        // publicados. El total resultante debe caber en el tope del plan.
        const [current, toPublish] = await Promise.all([
          prisma.product.count({ where: { publishedToStore: true } }),
          prisma.product.count({ where: { ...where, publishedToStore: false } }),
        ]);
        if (current + toPublish > limit) {
          return res.status(403).json({
            error: "PLAN_LIMIT",
            resource: "storeProducts",
            limit,
            current,
          });
        }
      }
    }

    const result = await prisma.product.updateMany({
      where,
      data: { publishedToStore },
    });
    return res.status(200).json({ count: result.count });
  } catch (error: any) {
    console.error("Error en publicación masiva por marca:", error);
    return res.status(500).json({ message: "Error al publicar en tienda" });
  }
};

/**
 * GET /products/brands — marcas disponibles de la org (valores únicos de la
 * variante "Marca", ordenados alfabéticamente). Alimenta el selector del
 * bulk-publish por marca. ProductVariant es tenant-scoped (scope org
 * automático), así que cualquier rol autenticado solo ve las marcas de su org.
 */
export const listStoreBrands = async (req: Request, res: Response) => {
  try {
    const rows = await prisma.productVariant.findMany({
      where: { option: { variant: { name: "Marca" } } },
      select: { option: { select: { value: true } } },
    });
    const brands = [...new Set(rows.map((r) => r.option.value))].sort((a, b) =>
      a.localeCompare(b),
    );
    return res.status(200).json({ brands });
  } catch (error: any) {
    console.error("Error listando marcas:", error);
    return res.status(500).json({ message: "Error al listar marcas" });
  }
};

/**
 * GET /products/:id/stock — stock del producto en todas las sucursales ACTIVAS
 * de la org (spec A1). Respuesta autocontenida (design D5): no depende de
 * GET /branches (que es ADMIN/MANAGEMENT-only), cualquier rol autenticado la
 * puede leer. canEdit se calcula con el rol + BranchAssignment del usuario
 * (leído de la DB, fuente de verdad — design D3).
 */
export const getProductStock = async (req: AuthedRequest, res: Response) => {
  try {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!product) {
      return res.status(404).json({ message: "Producto no encontrado" });
    }

    const [branches, stocks, branchIds] = await Promise.all([
      prisma.branch.findMany({
        where: { isActive: true },
        select: { id: true, name: true, isHeadquarters: true },
      }),
      prisma.productStock.findMany({
        where: { productId: product.id },
        select: { branchId: true, quantity: true },
      }),
      readUserBranchIds(req.user!.id),
    ]);

    const stockByBranch = new Map(stocks.map((s) => [s.branchId, s.quantity]));

    res.status(200).json({
      productId: product.id,
      branches: branches.map((b) => ({
        branchId: b.id,
        branchName: b.name,
        quantity: stockByBranch.get(b.id) ?? 0,
        isHeadquarters: b.isHeadquarters,
        canEdit: canEditBranchStock(req.user!.role, branchIds, b.id),
      })),
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * PUT /products/:id/stock/:branchId — actualiza el stock de UNA sucursal
 * (spec A2). Autorización server-side: ADMIN/MANAGEMENT editan cualquier
 * sucursal; VENDEDOR/CASHIER solo las suyas; el resto 403. BranchAssignment se
 * re-lee de la DB en CADA PUT (design D3 — el token no es fuente de verdad).
 * Si la sucursal es la casa central, sincroniza la columna legacy
 * Product.quantity (spec D4); las no-HQ NO la tocan.
 */
export const updateBranchStock = async (req: AuthedRequest, res: Response) => {
  try {
    const organizationId = requireOrganizationId();
    const { quantity } = req.body as { quantity: number };
    const { id, branchId } = req.params;

    const product = await prisma.product.findFirst({
      where: { id },
      select: { id: true },
    });
    if (!product) {
      return res.status(404).json({ message: "Producto no encontrado" });
    }

    const branch = await prisma.branch.findFirst({
      where: { id: branchId, isActive: true },
      select: { id: true, isHeadquarters: true },
    });
    if (!branch) {
      return res.status(404).json({ message: "Sucursal no encontrada" });
    }

    // Autorización: rol + asignaciones FRESCAS de la DB (spec A2).
    const branchIds = await readUserBranchIds(req.user!.id);
    if (!canEditBranchStock(req.user!.role, branchIds, branchId)) {
      return res
        .status(403)
        .json({ message: "No tenés permiso para editar el stock de esta sucursal." });
    }

    // Upsert manual (updateMany count 0 → create): la fila de stock nace
    // on-first-write (sucursal sin fila previa queda en el valor indicado).
    const updated = await prisma.productStock.updateMany({
      where: { productId: id, branchId },
      data: { quantity },
    });
    if (updated.count === 0) {
      await prisma.productStock.create({
        data: { productId: id, branchId, quantity, organizationId },
      });
    }

    // D4: solo la casa central sincroniza la columna legacy Product.quantity.
    if (branch.isHeadquarters) {
      await syncHqStock(organizationId, id, quantity);
    }

    res.status(200).json({ message: "Stock actualizado", branchId, quantity });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
};

/**
 * GET /products/stock-summary — resumen de stock de TODA la org: `total`
 * (suma de todos los ProductStock, incluye sucursales inactivas) + detalle por
 * sucursal ACTIVA (quantity por branch, 0 si no tiene filas). Cualquier rol
 * autenticado puede leerlo (mismo criterio que getProductStock). Usa prisma
 * (scope de tenant del request vía requireOrganizationId).
 */
export const getStockSummary = async (req: Request, res: Response) => {
  try {
    const organizationId = requireOrganizationId();
    const summary = await getStockSummaryService(organizationId);
    res.status(200).json(summary);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * GET /products/seco-barcodes-report — reporte de productos de "Alimento Seco"
 * con/sin código de barras (EAN/UPC). La categoría puede llamarse "Alimento
 * Seco" o "Alimento Seco (Balanceado)", por eso el filtro es por contener
 * "alimento seco" (normalizado) y NO por igualdad exacta. Solo lectura.
 */
export const getSecoBarcodesReport = async (req: Request, res: Response) => {
  try {
    const organizationId = requireOrganizationId();

    const categories = await prisma.category.findMany({
      where: { organizationId },
      select: { id: true, name: true, parentId: true },
    });
    const secoIds = categories
      .filter((c) => normalizeName(c.name).includes("alimento seco"))
      .map((c) => c.id);

    const products = await prisma.product.findMany({
      where: { organizationId, categoryId: { in: secoIds } },
      select: {
        id: true,
        name: true,
        code: true,
        barcode: true,
        categoryId: true,
      },
      orderBy: { name: "asc" },
    });

    const byId = new Map(categories.map((c) => [c.id, c]));
    const items = products.map((p) => {
      const cat = p.categoryId ? byId.get(p.categoryId) : undefined;
      const parentName = cat?.parentId ? byId.get(cat.parentId)?.name ?? "" : "";
      const haystack = normalizeName(`${parentName} ${cat?.name ?? ""}`);
      let species = "Sin especie";
      if (haystack.includes("perro")) species = "Perro";
      else if (haystack.includes("gato")) species = "Gato";
      const barcode = (p.barcode ?? "").trim();
      return {
        id: p.id,
        name: p.name,
        species,
        code: p.code ?? "",
        barcode,
        hasBarcode: barcode.length > 0,
      };
    });

    const conBarcode = items.filter((i) => i.hasBarcode).length;
    const sinBarcode = items.length - conBarcode;

    res.json({ total: items.length, conBarcode, sinBarcode, items });
  } catch (error) {
    console.error("Error en getSecoBarcodesReport:", error);
    res.status(500).json({ message: "Error al generar el reporte de códigos de barra" });
  }
};

export default {
  createProduct,
  bulkUploadProducts,
  getProducts,
  getProductFilterFacets,
  getSecoBarcodesReport,
  getProductById,
  updateProduct,
  publishProduct,
  deleteProduct,
  bulkPriceUpdate,
  bulkCarried,
  bulkPublish,
  listStoreBrands,
  getProductStock,
  updateBranchStock,
  getStockSummary,
};

/**
 * Asigna `PriceKgPrice.scaleCode` (código interno de balanza, EAN-13 = 20 +
 * scaleCode + peso en gramos + verificador) a las CELDAS de la planilla
 * "Precios por kilo" (los "productos sueltos": marca × tipo × especie).
 *
 * Esquema: códigos CORRIDOS a partir de SCALE_CODE_BASE (101), ordenados por
 * marca madre → tipo → especie, en formato de 3 dígitos (101..999). La balanza
 * Systel Cuora imprime el PLU en un campo de 4 dígitos dentro de la etiqueta
 * (101 → 0101), pero el scaleCode del ERP es el número de 3 dígitos que tipea
 * el operador. El límite de la balanza rechaza códigos ≥ 4000, así que el rango
 * de 3 dígitos [101, 999] queda muy por debajo.
 *
 * ANTES se usaba '<familia 2> + <índice 2>' (familia = índice alfabético de la
 * media madre), pero con 46 marcas madre generaba códigos 40xx-46xx que la
 * balanza rechaza por superar el límite. Se reemplaza por códigos corridos.
 *
 * "Marca madre" = marca de la planilla con las variantes colapsadas
 * (se quitan tokens tipo RP/EN/CORDERO/PREMIUM...): "PRO PLAN RP" → "PRO PLAN".
 *
 * Set objetivo: celdas de la org con priceKg > 0 (las "146 celdas con precio
 * cargado" de la planilla). Idempotente.
 *
 * Env/flag:
 *   ORG_SLUG = slug de la organización (default el-almacen-de-las-mascotas)
 *   --apply  = escribe en la BD (sin --apply = dry-run)
 *
 * Usage: npx ts-node scripts/assign-scale-codes.ts [--apply]
 */
import "dotenv/config";
import { basePrisma } from "../src/config/db";

const DEFAULT_ORG_SLUG = "el-almacen-de-las-mascotas";

/** Primer código a usar (101 → códigos de 3 dígitos: el operador tipea menos). */
const SCALE_CODE_BASE = 100;
/** Capacidad de 3 dígitos (101..999) — la balanza imprime el PLU en 4 posiciones. */
const SCALE_CODE_LIMIT = 899; // cantidad de códigos disponibles (101..999)

export const hasApplyFlag = (argv: string[] = process.argv): boolean =>
  argv.includes("--apply");

export const resolveOrgSlug = (env: NodeJS.ProcessEnv = process.env): string =>
  env.ORG_SLUG || DEFAULT_ORG_SLUG;

// Tokens de variante/línea (no la marca madre) que se descartan al derivar la
// familia. IMPORTANTE: "ROYAL" NO se descarta ("ROYAL CANIN" es la marca madre).
const VARIANT_TOKENS = new Set([
  "RP", "EN", "NF", "URINARY", "CORDERO", "SALMON", "POLLO", "TRUCHA", "CERDO",
  "CRIADORES", "CLASSIC", "COMPLETE", "PREMIUM", "SUPER", "GREEN", "LINE",
  "GOLD", "NOVELES", "EQUILIBRIUM", "GASTRO", "OBESITY", "RENAL", "CARDIAC",
  "DIABETIC", "HEPATIC", "GASTROINTESTINAL", "HIPOALERGNICO", "HIPOALERGICO",
  "ARTICULAR", "Y", "ARROZ", "MP",
]);

/** Marca madre a partir del nombre de marca de la planilla. */
export const parentBrandOf = (name: string): string => {
  const tokens = name.split(/\s+/).filter(Boolean);
  const kept = tokens.filter((t) => !VARIANT_TOKENS.has(t.toUpperCase()));
  return kept.join(" ").trim() || name.trim();
};

export interface CellLike {
  id: string;
  brandId: string;
  brandName: string;
  parentBrand: string;
  typeName: string;
  species: string;
  priceKg: number;
}

export interface PlannedCode {
  priceKgPriceId: string;
  scaleCode: string;
  parentBrand: string;
  typeName: string;
  species: string;
}

/**
 * Asigna códigos corridos (1001+) dentro del rango que acepta la balanza,
 * ordenando de forma determinista por marca madre → tipo → especie. Si las
 * celdas superan el rango disponible, las que no entran van con "0000".
 */
export const planScaleCodes = (cells: CellLike[]): PlannedCode[] => {
  const sorted = cells
    .slice()
    .sort((a, b) => {
      const byParent = a.parentBrand.localeCompare(b.parentBrand, "es", { sensitivity: "base" });
      if (byParent !== 0) return byParent;
      const byType = a.typeName.localeCompare(b.typeName, "es", { sensitivity: "base" });
      if (byType !== 0) return byType;
      return a.species.localeCompare(b.species, "es", { sensitivity: "base" });
    });

  const out: PlannedCode[] = [];
  sorted.forEach((c, i) => {
    const num = SCALE_CODE_BASE + 1 + i; // 101, 102, ...
    const scaleCode =
      i + 1 > SCALE_CODE_LIMIT
        ? "0000"
        : String(num); // 3 dígitos: 101..999 (sin ceros a la izquierda)
    out.push({
      priceKgPriceId: c.id,
      scaleCode,
      parentBrand: c.parentBrand,
      typeName: c.typeName,
      species: c.species,
    });
  });
  return out;
};

async function main() {
  const apply = hasApplyFlag();
  const slug = resolveOrgSlug();

  const org = await basePrisma.organization.findFirst({ where: { slug } });
  if (!org) throw new Error(`Organización no encontrada (slug='${slug}')`);

  const [brands, types, cells] = await Promise.all([
    basePrisma.priceKgBrand.findMany({ where: { organizationId: org.id }, select: { id: true, name: true } }),
    basePrisma.priceKgType.findMany({ where: { organizationId: org.id }, select: { id: true, name: true } }),
    basePrisma.priceKgPrice.findMany({
      where: { organizationId: org.id, priceKg: { gt: 0 } },
      select: { id: true, brandId: true, typeId: true, species: true, priceKg: true },
    }),
  ]);

  const brandById = new Map(brands.map((b) => [b.id, b.name]));
  const typeById = new Map(types.map((t) => [t.id, t.name]));

  const cellLikes: CellLike[] = [];
  for (const c of cells) {
    const brandName = brandById.get(c.brandId) ?? "";
    if (!brandName) continue;
    cellLikes.push({
      id: c.id,
      brandId: c.brandId,
      brandName,
      parentBrand: parentBrandOf(brandName),
      typeName: typeById.get(c.typeId) ?? "",
      species: c.species,
      priceKg: c.priceKg,
    });
  }

  const plan = planScaleCodes(cellLikes);

  if (apply) {
    let updated = 0;
    await basePrisma.$transaction(async (tx) => {
      for (const row of plan) {
        const res = await tx.priceKgPrice.updateMany({
          where: { id: row.priceKgPriceId, organizationId: org.id },
          data: { scaleCode: row.scaleCode },
        });
        updated += res.count;
      }
    });
    console.log(`[${org.name}] ${updated} celdas actualizadas con scaleCode.`);
  } else {
    console.log(`DRY-RUN [${org.name}] — sin --apply no se escribe nada.\n`);
    console.log(`Set: ${cellLikes.length} celdas con precio cargado.\n`);
    const byParent = new Map<string, { code: string; type: string; species: string }[]>();
    for (const row of plan) {
      const arr = byParent.get(row.parentBrand) ?? [];
      arr.push({ code: row.scaleCode, type: row.typeName, species: row.species });
      byParent.set(row.parentBrand, arr);
    }
    for (const [parent, items] of byParent) {
      console.log(`  ${parent}: ${items.map((i) => `${i.code}=${i.type} ${i.species}`).join(", ")}`);
    }
  }
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

/**
 * Standardize product names to the mixed English+Spanish convention (matching the
 * Pro Plan bag: life-stage/line in ENGLISH, breed/range in SPANISH, flavor in Spanish).
 *
 * Convention:
 *   MARCA + ETAPA/LÍNEA (inglés) + PORTE (español) + PESO X{kg}KG
 *   - Species: DOG / CAT (PERRO/GATO -> DOG/CAT).
 *   - Stages/lines English: ADULT, PUPPY, KITTEN, SENIOR, ADULT +7, STERILIZED,
 *     REDUCED CALORIE, ACTIVE MIND, SENSITIVE SKIN & STOMACH, SENSITIVE SKIN,
 *     URINARY, SKIN CARE, FORMULA, TRIPLE, HIGH PROTEIN, LIVE CLEAR,
 *     GASTROINTESTINAL, RENAL, OBESITY, NEUROLOGICAL, JOINT MOBILITY, COMPLETE.
 *   - Breed/range Spanish: RAZAS PEQUEÑAS, RAZAS MEDIANAS, RAZAS GRANDES,
 *     RAZAS MEDIANAS Y GRANDES.
 *   - Flavor Spanish: POLLO, CARNE, PESCADO, SALMÓN, PAVO.
 *   - Weight always "... X{n}KG" with Spanish decimal comma (X7,5KG, X0,5KG).
 *
 * Applies to: PRO PLAN (breed re-fix to Spanish), CAT CHOW, DOG CHOW, EXCELLENT.
 * Keys are the CURRENT DB names, normalized (trim + collapse spaces). Standalone ts-node
 * script — run ON THE VPS. Dry-run default.
 *
 * Usage:
 *   npx ts-node prisma/rename-brands.ts --org el-almacen-de-las-mascotas
 *   npx ts-node prisma/rename-brands.ts --org el-almacen-de-las-mascotas --apply
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

/** Collapse whitespace so spacing differences don't cause map misses. */
const norm = (s: string) => s.trim().replace(/\s+/g, " ");

/** Current name (normalized) -> standardized mixed English+Spanish name. */
const RENAME_MAP: Record<string, string> = {
  // ══════════════════════ PRO PLAN — porte a español ══════════════════════
  "PRO PLAN DOG ACTIVE MIND MEDIUM & LARGE X15KG": "PRO PLAN DOG ACTIVE MIND RAZAS MEDIANAS Y GRANDES X15KG",
  "PRO PLAN DOG ACTIVE MIND MEDIUM & LARGE X3KG": "PRO PLAN DOG ACTIVE MIND RAZAS MEDIANAS Y GRANDES X3KG",
  "PRO PLAN DOG ACTIVE MIND SMALL BREED X1KG": "PRO PLAN DOG ACTIVE MIND RAZAS PEQUEÑAS X1KG",
  "PRO PLAN DOG ACTIVE MIND SMALL BREED X3KG": "PRO PLAN DOG ACTIVE MIND RAZAS PEQUEÑAS X3KG",
  "PRO PLAN DOG ACTIVE MIND SMALL BREED X7,5KG": "PRO PLAN DOG ACTIVE MIND RAZAS PEQUEÑAS X7,5KG",
  "PRO PLAN DOG ADULT LARGE BREED BONUS X18KG": "PRO PLAN DOG ADULT RAZAS GRANDES BONUS X18KG",
  "PRO PLAN DOG ADULT LARGE BREED X12KG": "PRO PLAN DOG ADULT RAZAS GRANDES X12KG",
  "PRO PLAN DOG ADULT LARGE BREED X15KG": "PRO PLAN DOG ADULT RAZAS GRANDES X15KG",
  "PRO PLAN DOG ADULT MEDIUM BONUS X18KG": "PRO PLAN DOG ADULT RAZAS MEDIANAS BONUS X18KG",
  "PRO PLAN DOG ADULT MEDIUM X12KG": "PRO PLAN DOG ADULT RAZAS MEDIANAS X12KG",
  "PRO PLAN DOG ADULT MEDIUM X15KG": "PRO PLAN DOG ADULT RAZAS MEDIANAS X15KG",
  "PRO PLAN DOG ADULT MEDIUM X3KG": "PRO PLAN DOG ADULT RAZAS MEDIANAS X3KG",
  "PRO PLAN DOG ADULT SMALL BREED X15KG": "PRO PLAN DOG ADULT RAZAS PEQUEÑAS X15KG",
  "PRO PLAN DOG ADULT SMALL BREED X1KG": "PRO PLAN DOG ADULT RAZAS PEQUEÑAS X1KG",
  "PRO PLAN DOG ADULT SMALL BREED X3KG": "PRO PLAN DOG ADULT RAZAS PEQUEÑAS X3KG",
  "PRO PLAN DOG ADULT SMALL BREED X7,5KG": "PRO PLAN DOG ADULT RAZAS PEQUEÑAS X7,5KG",
  "PRO PLAN DOG EXIGENT SMALL BREED X7,5KG": "PRO PLAN DOG EXIGENT RAZAS PEQUEÑAS X7,5KG",
  "PRO PLAN DOG PUPPY COMPLETE MEDIUM X15KG": "PRO PLAN DOG PUPPY COMPLETE RAZAS MEDIANAS X15KG",
  "PRO PLAN DOG PUPPY LARGE BREED X15KG": "PRO PLAN DOG PUPPY RAZAS GRANDES X15KG",
  "PRO PLAN DOG PUPPY SMALL BREED X1KG": "PRO PLAN DOG PUPPY RAZAS PEQUEÑAS X1KG",
  "PRO PLAN DOG PUPPY SMALL BREED X3KG": "PRO PLAN DOG PUPPY RAZAS PEQUEÑAS X3KG",
  "PRO PLAN DOG PUPPY SMALL BREED X7,5KG": "PRO PLAN DOG PUPPY RAZAS PEQUEÑAS X7,5KG",
  "PRO PLAN DOG REDUCED CALORIE MEDIUM & LARGE X12KG": "PRO PLAN DOG REDUCED CALORIE RAZAS MEDIANAS Y GRANDES X12KG",
  "PRO PLAN DOG REDUCED CALORIE MEDIUM & LARGE X3KG": "PRO PLAN DOG REDUCED CALORIE RAZAS MEDIANAS Y GRANDES X3KG",
  "PRO PLAN DOG REDUCED CALORIE SMALL BREED X1KG": "PRO PLAN DOG REDUCED CALORIE RAZAS PEQUEÑAS X1KG",
  "PRO PLAN DOG REDUCED CALORIE SMALL BREED X3KG": "PRO PLAN DOG REDUCED CALORIE RAZAS PEQUEÑAS X3KG",
  "PRO PLAN DOG REDUCED CALORIE SMALL BREED X7,5KG": "PRO PLAN DOG REDUCED CALORIE RAZAS PEQUEÑAS X7,5KG",
  "PRO PLAN DOG SENIOR SENSITIVE SKIN & STOMACH SMALL BREED X7,5KG": "PRO PLAN DOG SENIOR SENSITIVE SKIN & STOMACH RAZAS PEQUEÑAS X7,5KG",
  "PRO PLAN DOG SENIOR SENSITIVE SKIN SMALL BREED X7,5KG": "PRO PLAN DOG SENIOR SENSITIVE SKIN RAZAS PEQUEÑAS X7,5KG",
  "PRO PLAN DOG SENSITIVE SKIN & STOMACH MEDIUM & LARGE X3KG": "PRO PLAN DOG SENSITIVE SKIN & STOMACH RAZAS MEDIANAS Y GRANDES X3KG",
  "PRO PLAN DOG SENSITIVE SKIN & STOMACH SMALL BREED X3KG": "PRO PLAN DOG SENSITIVE SKIN & STOMACH RAZAS PEQUEÑAS X3KG",
  "PRO PLAN DOG SENSITIVE SKIN MEDIUM & LARGE X3KG": "PRO PLAN DOG SENSITIVE SKIN RAZAS MEDIANAS Y GRANDES X3KG",
  "PRO PLAN DOG SENSITIVE SKIN SMALL BREED X3KG": "PRO PLAN DOG SENSITIVE SKIN RAZAS PEQUEÑAS X3KG",

  // ══════════════════════ CAT CHOW ══════════════════════
  "CAT CHOW ADULTOS CARNE X 1 KG": "CAT CHOW ADULT CARNE X1KG",
  "CAT CHOW ADULTOS CARNE X 15 KG": "CAT CHOW ADULT CARNE X15KG",
  "CAT CHOW ADULTOS CARNE X 3 KG": "CAT CHOW ADULT CARNE X3KG",
  "CAT CHOW ADULTOS CARNE X 8 KG": "CAT CHOW ADULT CARNE X8KG",
  "CAT CHOW ADULTOS CARNE X500G": "CAT CHOW ADULT CARNE X0,5KG",
  "CAT CHOW ADULTOS PESC X18K BONUS": "CAT CHOW ADULT PESCADO X18KG BONUS",
  "CAT CHOW ADULTOS PESCADO X 1 KG": "CAT CHOW ADULT PESCADO X1KG",
  "CAT CHOW ADULTOS PESCADO X 15 KG": "CAT CHOW ADULT PESCADO X15KG",
  "CAT CHOW ADULTOS PESCADO X 3 KG": "CAT CHOW ADULT PESCADO X3KG",
  "CAT CHOW ADULTOS PESCADO X 8 KG": "CAT CHOW ADULT PESCADO X8KG",
  "CAT CHOW ADULTOS PESCADO X500G": "CAT CHOW ADULT PESCADO X0,5KG",
  "CAT CHOW ESTERILIZADOS X 15 KG": "CAT CHOW STERILIZED X15KG",
  "CAT CHOW GATITOS X 3 KG": "CAT CHOW KITTEN X3KG",
  "CAT CHOW GATITOS X 1 KG": "CAT CHOW KITTEN X1KG",
  "CAT CHOW GATITOS X 15 K": "CAT CHOW KITTEN X15KG",
  "CAT CHOW GATITOS X 500 GRS": "CAT CHOW KITTEN X0,5KG",
  "CAT CHOW WET ESTERILIZ 15X85G": "CAT CHOW WET STERILIZED 15X85G",
  "CAT CHOW WET GATITO POLL 15X85": "CAT CHOW WET KITTEN POLLO 15X85G",
  "CAT CHOW WET PESCADO 15X85G": "CAT CHOW WET PESCADO 15X85G",
  "CAT CHOW WET POLLO 15X85G": "CAT CHOW WET POLLO 15X85G",

  // ══════════════════════ DOG CHOW ══════════════════════
  "DOG CHOW AD TRIPLE M/G X 20 KG": "DOG CHOW ADULT TRIPLE RAZAS MEDIANAS Y GRANDES X20KG",
  "DOG CHOW AD TRIPLE PEQ X 20 KG": "DOG CHOW ADULT TRIPLE RAZAS PEQUEÑAS X20KG",
  "DOG CHOW ADULTO ALTA PROT X 2,7K": "DOG CHOW ADULT HIGH PROTEIN X2,7KG",
  "DOG CHOW ADULTO MED-GDE 24 BONUS": "DOG CHOW ADULT RAZAS MEDIANAS Y GRANDES X24KG BONUS",
  "DOG CHOW ADULTO MED-GDE X 1,5 KG": "DOG CHOW ADULT RAZAS MEDIANAS Y GRANDES X1,5KG",
  "DOG CHOW ADULTO MED-GDE X 15 K": "DOG CHOW ADULT RAZAS MEDIANAS Y GRANDES X15KG",
  "DOG CHOW ADULTO MED-GDE X 3 KG": "DOG CHOW ADULT RAZAS MEDIANAS Y GRANDES X3KG",
  "DOG CHOW ADULTO MED-GDE X 8 KG": "DOG CHOW ADULT RAZAS MEDIANAS Y GRANDES X8KG",
  "DOG CHOW ADULTO PEQUEÑA 24 BONUS": "DOG CHOW ADULT RAZAS PEQUEÑAS X24KG BONUS",
  "DOG CHOW ADULTO PEQUEÑA X 1,5 KG": "DOG CHOW ADULT RAZAS PEQUEÑAS X1,5KG",
  "DOG CHOW ADULTO PEQUEÑA X 3 KG": "DOG CHOW ADULT RAZAS PEQUEÑAS X3KG",
  "DOG CHOW ADULTO PEQUEÑA X 8 KG": "DOG CHOW ADULT RAZAS PEQUEÑAS X8KG",
  "DOG CHOW CACH MED-GDE X 1,5KG": "DOG CHOW PUPPY RAZAS MEDIANAS Y GRANDES X1,5KG",
  "DOG CHOW CACH MED-GDE X 21 KG": "DOG CHOW PUPPY RAZAS MEDIANAS Y GRANDES X21KG",
  "DOG CHOW CACH MED-GDE X 3 KG": "DOG CHOW PUPPY RAZAS MEDIANAS Y GRANDES X3KG",
  "DOG CHOW CACH MED-GDE X15 KG": "DOG CHOW PUPPY RAZAS MEDIANAS Y GRANDES X15KG",
  "DOG CHOW CACH PEQUEÑA X 1,5 KG": "DOG CHOW PUPPY RAZAS PEQUEÑAS X1,5KG",
  "DOG CHOW CACH PEQUEÑA X 21 KG": "DOG CHOW PUPPY RAZAS PEQUEÑAS X21KG",
  "DOG CHOW CACH PEQUEÑA X 3 KG": "DOG CHOW PUPPY RAZAS PEQUEÑAS X3KG",
  "DOG CHOW EDAD MADURA X 21 KG": "DOG CHOW SENIOR X21KG",
  "DOG CHOW EDAD MADURA X 3KG": "DOG CHOW SENIOR X3KG",
  "DOG CHOW EDAD MADURA X 8 KG": "DOG CHOW SENIOR X8KG",
  "DOG CHOW WET CCH POLL 15SX100G": "DOG CHOW WET PUPPY POLLO 15X100G",
  "DOG CHOW WET PAVO 15 S X 100GR": "DOG CHOW WET PAVO 15X100G",
  "DOG CHOW WET R PEQ POL 15X100G": "DOG CHOW WET RAZAS PEQUEÑAS POLLO 15X100G",
  "DOG CHOW WET R PEQ SALM 15X100": "DOG CHOW WET RAZAS PEQUEÑAS SALMÓN 15X100G",

  // ══════════════════════ EXCELLENT ══════════════════════
  "EXCELLENT FORMULA ADULTO X20KG": "EXCELLENT FORMULA ADULT X20KG",
  "EXCELLENT FORMULA CACH X20KG": "EXCELLENT FORMULA PUPPY X20KG",
  "EXCELLENT FORMULA GATO X 15 KG": "EXCELLENT FORMULA CAT X15KG",
  "EXCELLENT GATO ADULTO X 1 KG": "EXCELLENT CAT ADULT X1KG",
  "EXCELLENT GATO ADULTO X 3 KG": "EXCELLENT CAT ADULT X3KG",
  "EXCELLENT GATO ADULTO X 7,5 KG": "EXCELLENT CAT ADULT X7,5KG",
  "EXCELLENT GATO ADULTO X 15 KG": "EXCELLENT CAT ADULT X15KG",
  "EXCELLENT GATO ADULTO X 18 KG": "EXCELLENT CAT ADULT X18KG",
  "EXCELLENT GATO CACH X 1 KG": "EXCELLENT CAT KITTEN X1KG",
  "EXCELLENT GATO CACH X 7.5 KG": "EXCELLENT CAT KITTEN X7,5KG",
  "EXCELLENT GATO ESTERILIZ X 7,5KG": "EXCELLENT CAT STERILIZED X7,5KG",
  "EXCELLENT GATO ESTERILIZADO X 1K": "EXCELLENT CAT STERILIZED X1KG",
  "EXCELLENT GATO SKIN CARE X 1 KG": "EXCELLENT CAT SKIN CARE X1KG",
  "EXCELLENT GATO SKIN CARE X7,5 KG": "EXCELLENT CAT SKIN CARE X7,5KG",
  "EXCELLENT GATO URINARY X 1 KG": "EXCELLENT CAT URINARY X1KG",
  "EXCELLENT GATO URINARY X 15 KG": "EXCELLENT CAT URINARY X15KG",
  "EXCELLENT GATO URINARY X 7.5 KG": "EXCELLENT CAT URINARY X7,5KG",
  "EXCELLENT PERRO AD LG BD X 3KG": "EXCELLENT DOG ADULT RAZAS GRANDES X3KG",
  "EXCELLENT PERRO AD LG BD X 15KG": "EXCELLENT DOG ADULT RAZAS GRANDES X15KG",
  "EXCELLENT PERRO AD LG BD X 20KG": "EXCELLENT DOG ADULT RAZAS GRANDES X20KG",
  "EXCELLENT PERRO AD LG/BD BON 22K": "EXCELLENT DOG ADULT RAZAS GRANDES BONUS X22KG",
  "EXCELLENT PERRO AD SKIN CARE 15K": "EXCELLENT DOG ADULT SKIN CARE X15KG",
  "EXCELLENT PERRO AD SKIN CARE 3KG": "EXCELLENT DOG ADULT SKIN CARE X3KG",
  "EXCELLENT PERRO AD SMALL BD X 3K": "EXCELLENT DOG ADULT RAZAS PEQUEÑAS X3KG",
  "EXCELLENT PERRO AD SMALL BD X15K": "EXCELLENT DOG ADULT RAZAS PEQUEÑAS X15KG",
  "EXCELLENT PERRO ADULTO +7 X 15KG": "EXCELLENT DOG ADULT +7 X15KG",
  "EXCELLENT PERRO ADULTO +7 X 3 KG": "EXCELLENT DOG ADULT +7 X3KG",
  "EXCELLENT PERRO CACH LG BD X 3K": "EXCELLENT DOG PUPPY RAZAS GRANDES X3KG",
  "EXCELLENT PERRO CACH LG BD X15K": "EXCELLENT DOG PUPPY RAZAS GRANDES X15KG",
  "EXCELLENT PERRO CACH LG BD X20K": "EXCELLENT DOG PUPPY RAZAS GRANDES X20KG",
  "EXCELLENT PERRO CACH SM BD X 3K": "EXCELLENT DOG PUPPY RAZAS PEQUEÑAS X3KG",
  "EXCELLENT PERRO CACH SM BD X15K": "EXCELLENT DOG PUPPY RAZAS PEQUEÑAS X15KG",
  "EXCELLENT PERRO CH LG/BD BON 22K": "EXCELLENT DOG PUPPY RAZAS GRANDES BONUS X22KG",
  "EXCELLENT PERRO RED CAL X15KG": "EXCELLENT DOG ADULT REDUCED CALORIE X15KG",
  "EXCELLENT PERRO RED CAL X3KG": "EXCELLENT DOG ADULT REDUCED CALORIE X3KG",
};

// Prefixes of the brands we touch (Pro Plan products may currently be "PRO PLAN" after batch 1/2).
const BRAND_PREFIXES = ["PRO PLAN", "PROPLAN", "CAT CHOW", "DOG CHOW", "EXCELLENT"];

async function main() {
  const args = process.argv.slice(2);
  const orgSlug = args.includes("--org") ? args[args.indexOf("--org") + 1] : null;
  const apply = args.includes("--apply");

  if (!orgSlug) {
    console.error("Usage: npx ts-node prisma/rename-brands.ts --org <slug> [--apply]");
    process.exit(1);
  }

  console.log(`🔍 Standardize brand product names for org slug: ${orgSlug}`);
  console.log(`   Mode: ${apply ? "APPLY (writes)" : "DRY-RUN (preview only)"}`);
  console.log();

  const org = await db.organization.findFirst({ where: { slug: orgSlug } });
  if (!org) {
    console.error(`❌ Organization not found: ${orgSlug}`);
    process.exit(1);
  }
  console.log(`   Organization: ${org.name} (${org.id})`);

  // Fetch every product whose name starts with one of the target brands.
  const products = await db.product.findMany({
    where: {
      organizationId: org.id,
      OR: BRAND_PREFIXES.map((p) => ({ name: { startsWith: p } })),
    },
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
  });
  console.log(`   Brand products found: ${products.length}`);
  console.log(`   Entries in rename map: ${Object.keys(RENAME_MAP).length}`);
  console.log();

  const proposals: Array<{ id: string; code: string | null; old: string; next: string }> = [];
  const unchanged: Array<string> = [];
  const unmatched: Array<{ id: string; code: string | null; name: string }> = [];

  for (const p of products) {
    const key = norm(p.name);
    const next = RENAME_MAP[key];
    if (next === undefined) unmatched.push({ id: p.id, code: p.code, name: p.name });
    else if (next === key) unchanged.push(p.name);
    else proposals.push({ id: p.id, code: p.code, old: p.name, next });
  }

  const foundKeys = new Set(products.map((p) => norm(p.name)));
  const mapKeysNotInDb = Object.keys(RENAME_MAP).filter((k) => !foundKeys.has(k));

  console.log("📋 PROPOSED RENAMES:");
  for (const r of proposals) {
    console.log(`   ${r.old}`);
    console.log(`   => ${r.next}`);
  }
  console.log();

  if (unchanged.length > 0) {
    console.log(`ℹ️  ${unchanged.length} product(s) already correct (no change):`);
    for (const n of unchanged) console.log(`   - ${n}`);
    console.log();
  }

  if (unmatched.length > 0) {
    console.log(`⚠️  ${unmatched.length} product(s) NOT in the map (will be skipped):`);
    for (const u of unmatched) {
      console.log(`   - ${u.name}${u.code ? ` (${u.code})` : ""}`);
    }
    console.log();
  }

  if (mapKeysNotInDb.length > 0) {
    console.log(`❌ ${mapKeysNotInDb.length} map key(s) have NO matching product (possible typo):`);
    for (const k of mapKeysNotInDb) console.log(`   - ${k}`);
    console.log();
  } else {
    console.log("✅ Every map key has a matching product in the org.");
  }

  const totalToWrite = proposals.length;
  if (totalToWrite > 0 && (unmatched.length > 0 || mapKeysNotInDb.length > 0)) {
    console.log("⚠️  There are unmatched/missing entries — review before applying.");
  }

  console.log();

  if (!apply) {
    console.log("🔒 DRY-RUN: no writes performed. Run with --apply to persist.");
    console.log(`   Would rename ${totalToWrite} product(s).`);
    console.log();
    console.log("   Run with --apply to execute:");
    console.log(`   npx ts-node prisma/rename-brands.ts --org ${orgSlug} --apply`);
  } else {
    if (mapKeysNotInDb.length > 0) {
      console.error("❌ Aborting APPLY: there are map keys with no matching product (possible typo). Fix the map first.");
      await db.$disconnect();
      process.exit(1);
    }

    console.log("✍️  APPLYING renames (single atomic transaction)...");
    await db.$transaction(
      proposals.map((r) =>
        db.product.updateMany({
          where: { id: r.id, organizationId: org.id },
          data: { name: r.next },
        }),
      ),
    );
    console.log(`   Renamed: ${totalToWrite}/${totalToWrite}`);
    console.log();
    console.log("✅ Rename complete!");
  }

  await db.$disconnect();
}

main().catch((e) => {
  console.error("❌ Fatal error:", e);
  process.exit(1);
});

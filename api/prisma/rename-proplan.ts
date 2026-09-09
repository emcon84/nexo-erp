/**
 * Rename Pro Plan products to a standardized English naming convention.
 *
 * Rules applied (agreed with owner — batch 2, correcting batch 1 which used Spanish
 * line names). The official Pro Plan line/brand terms stay in ENGLISH:
 *   - Brand prefix "PRO PLAN".
 *   - Lines: REDUCED CALORIE, SENSITIVE SKIN & STOMACH (S&S), SENSITIVE SKIN (SKN/SKIN),
 *     ACTIVE MIND, URINARY (vet UR), URINARY CARE (cat), GASTROINTESTINAL (EN),
 *     RENAL (NF), OBESITY (OM), NEUROLOGICAL (NC), JOINT MOBILITY (JM),
 *     LIVE CLEAR, STERILIZED, ADULT, PUPPY, SENIOR, EXIGENT, KITTEN, COMPLETE.
 *   - Breed/range: SMALL BREED (PEQ/SM BD), MEDIUM (MED), LARGE BREED (GDE/LG BD),
 *     MEDIUM & LARGE (M&G/MYG).
 *   - Weight suffix always "... X{n}KG" with Spanish decimal comma (X7,5KG).
 *   - Wet flavors stay Spanish (POLLO, SALMON).
 *
 * The keys are the CURRENT names in the DB (batch-1 Spanish form); the values are the
 * corrected English form. Standalone ts-node script — run ON THE VPS. Dry-run default.
 *
 * Usage:
 *   npx ts-node prisma/rename-proplan.ts --org el-almacen-de-las-mascotas
 *   npx ts-node prisma/rename-proplan.ts --org el-almacen-de-las-mascotas --apply
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

/** Current name (batch-1 Spanish form) -> corrected English form. */
const RENAME_MAP: Record<string, string> = {
  // ── Gato — seco ──────────────────────────────────────────────────────
  "PRO PLAN CAT GASTROINTESTINAL X1,5KG": "PRO PLAN CAT GASTROINTESTINAL X1,5KG",
  "PRO PLAN CAT RENAL X1,5KG": "PRO PLAN CAT RENAL X1,5KG",
  "PRO PLAN CAT OBESIDAD X1,5KG": "PRO PLAN CAT OBESITY X1,5KG",
  "PRO PLAN CAT URINARIO X1,5KG": "PRO PLAN CAT URINARY X1,5KG",
  "PRO PLAN CAT URINARIO X7,5KG": "PRO PLAN CAT URINARY X7,5KG",
  "PRO PLAN CAT ADULTO +7 X7,5KG": "PRO PLAN CAT ADULT +7 X7,5KG",
  "PRO PLAN CAT ADULTO X15KG": "PRO PLAN CAT ADULT X15KG",
  "PRO PLAN CAT ADULTO X7,5KG": "PRO PLAN CAT ADULT X7,5KG",
  "PRO PLAN CAT ADULTO X1KG": "PRO PLAN CAT ADULT X1KG",
  "PRO PLAN CAT LIVE CLEAR X1KG": "PRO PLAN CAT LIVE CLEAR X1KG",
  "PRO PLAN CAT LIVE CLEAR X3KG": "PRO PLAN CAT LIVE CLEAR X3KG",
  "PRO PLAN CAT PIEL Y ESTÓMAGO SENSIBLE X1KG": "PRO PLAN CAT SENSITIVE SKIN & STOMACH X1KG",
  "PRO PLAN CAT PIEL Y ESTÓMAGO SENSIBLE X3KG": "PRO PLAN CAT SENSITIVE SKIN & STOMACH X3KG",
  "PRO PLAN CAT ESTERILIZADO X1KG": "PRO PLAN CAT STERILIZED X1KG",
  "PRO PLAN CAT ESTERILIZADO X7,5KG": "PRO PLAN CAT STERILIZED X7,5KG",
  "PRO PLAN CAT CUIDADO URINARIO X15KG": "PRO PLAN CAT URINARY CARE X15KG",
  "PRO PLAN CAT CUIDADO URINARIO X1KG": "PRO PLAN CAT URINARY CARE X1KG",
  "PRO PLAN CAT CUIDADO URINARIO X3KG": "PRO PLAN CAT URINARY CARE X3KG",
  "PRO PLAN CAT CUIDADO URINARIO X7,5KG": "PRO PLAN CAT URINARY CARE X7,5KG",
  // ── Gato — KITTEN ────────────────────────────────────────────────────
  "PRO PLAN KITTEN X1KG": "PRO PLAN KITTEN X1KG",
  "PRO PLAN KITTEN X7,5KG": "PRO PLAN KITTEN X7,5KG",
  // ── Perro — vet ──────────────────────────────────────────────────────
  "PRO PLAN DOG GASTROINTESTINAL X2KG": "PRO PLAN DOG GASTROINTESTINAL X2KG",
  "PRO PLAN DOG GASTROINTESTINAL X7,5KG": "PRO PLAN DOG GASTROINTESTINAL X7,5KG",
  "PRO PLAN DOG ARTICULAR X2KG": "PRO PLAN DOG JOINT MOBILITY X2KG",
  "PRO PLAN DOG NEUROLÓGICO X2KG": "PRO PLAN DOG NEUROLOGICAL X2KG",
  "PRO PLAN DOG NEUROLÓGICO X7,5KG": "PRO PLAN DOG NEUROLOGICAL X7,5KG",
  "PRO PLAN DOG RENAL X2KG": "PRO PLAN DOG RENAL X2KG",
  "PRO PLAN DOG RENAL X7,5KG": "PRO PLAN DOG RENAL X7,5KG",
  "PRO PLAN DOG OBESIDAD X2KG": "PRO PLAN DOG OBESITY X2KG",
  "PRO PLAN DOG OBESIDAD X7,5KG": "PRO PLAN DOG OBESITY X7,5KG",
  "PRO PLAN DOG URINARIO X2KG": "PRO PLAN DOG URINARY X2KG",
  "PRO PLAN DOG URINARIO X7,5KG": "PRO PLAN DOG URINARY X7,5KG",
  // ── Perro — ACTIVE MIND ──────────────────────────────────────────────
  "PRO PLAN DOG MENTE ACTIVA MEDIANO Y GRANDE X15KG": "PRO PLAN DOG ACTIVE MIND MEDIUM & LARGE X15KG",
  "PRO PLAN DOG MENTE ACTIVA MEDIANO Y GRANDE X3KG": "PRO PLAN DOG ACTIVE MIND MEDIUM & LARGE X3KG",
  "PRO PLAN DOG MENTE ACTIVA RAZA PEQUEÑA X7,5KG": "PRO PLAN DOG ACTIVE MIND SMALL BREED X7,5KG",
  "PRO PLAN DOG MENTE ACTIVA RAZA PEQUEÑA X1KG": "PRO PLAN DOG ACTIVE MIND SMALL BREED X1KG",
  "PRO PLAN DOG MENTE ACTIVA RAZA PEQUEÑA X3KG": "PRO PLAN DOG ACTIVE MIND SMALL BREED X3KG",
  // ── Perro — ADULT ────────────────────────────────────────────────────
  "PRO PLAN DOG ADULTO RAZA GRANDE BONUS X18KG": "PRO PLAN DOG ADULT LARGE BREED BONUS X18KG",
  "PRO PLAN DOG ADULTO RAZA MEDIANA BONUS X18KG": "PRO PLAN DOG ADULT MEDIUM BONUS X18KG",
  "PRO PLAN DOG ADULTO RAZA GRANDE X12KG": "PRO PLAN DOG ADULT LARGE BREED X12KG",
  "PRO PLAN DOG ADULTO RAZA GRANDE X15KG": "PRO PLAN DOG ADULT LARGE BREED X15KG",
  "PRO PLAN DOG ADULTO RAZA MEDIANA X12KG": "PRO PLAN DOG ADULT MEDIUM X12KG",
  "PRO PLAN DOG ADULTO RAZA MEDIANA X15KG": "PRO PLAN DOG ADULT MEDIUM X15KG",
  "PRO PLAN DOG ADULTO RAZA MEDIANA X3KG": "PRO PLAN DOG ADULT MEDIUM X3KG",
  "PRO PLAN DOG ADULTO RAZA PEQUEÑA X3KG": "PRO PLAN DOG ADULT SMALL BREED X3KG",
  "PRO PLAN DOG ADULTO RAZA PEQUEÑA X1KG": "PRO PLAN DOG ADULT SMALL BREED X1KG",
  "PRO PLAN DOG ADULTO RAZA PEQUEÑA X15KG": "PRO PLAN DOG ADULT SMALL BREED X15KG",
  "PRO PLAN DOG ADULTO RAZA PEQUEÑA X7,5KG": "PRO PLAN DOG ADULT SMALL BREED X7,5KG",
  // ── Perro — EXIGENT ──────────────────────────────────────────────────
  "PRO PLAN DOG EXIGENT RAZA PEQUEÑA X7,5KG": "PRO PLAN DOG EXIGENT SMALL BREED X7,5KG",
  // ── Perro — PUPPY ────────────────────────────────────────────────────
  "PRO PLAN DOG PUPPY RAZA GRANDE X15KG": "PRO PLAN DOG PUPPY LARGE BREED X15KG",
  "PRO PLAN DOG PUPPY COMPLETE X1KG": "PRO PLAN DOG PUPPY COMPLETE X1KG",
  "PRO PLAN DOG PUPPY COMPLETE RAZA MEDIANA X15KG": "PRO PLAN DOG PUPPY COMPLETE MEDIUM X15KG",
  "PRO PLAN DOG PUPPY COMPLETE X12KG": "PRO PLAN DOG PUPPY COMPLETE X12KG",
  "PRO PLAN DOG PUPPY COMPLETE X15KG": "PRO PLAN DOG PUPPY COMPLETE X15KG",
  "PRO PLAN DOG PUPPY COMPLETE X3KG": "PRO PLAN DOG PUPPY COMPLETE X3KG",
  "PRO PLAN DOG PUPPY RAZA PEQUEÑA X1KG": "PRO PLAN DOG PUPPY SMALL BREED X1KG",
  "PRO PLAN DOG PUPPY RAZA PEQUEÑA X3KG": "PRO PLAN DOG PUPPY SMALL BREED X3KG",
  "PRO PLAN DOG PUPPY RAZA PEQUEÑA X7,5KG": "PRO PLAN DOG PUPPY SMALL BREED X7,5KG",
  // ── Perro — SENIOR ───────────────────────────────────────────────────
  "PRO PLAN DOG SENIOR PIEL Y ESTÓMAGO SENSIBLE RAZA PEQUEÑA X7,5KG": "PRO PLAN DOG SENIOR SENSITIVE SKIN & STOMACH SMALL BREED X7,5KG",
  "PRO PLAN DOG SENIOR PIEL SENSIBLE RAZA PEQUEÑA X7,5KG": "PRO PLAN DOG SENIOR SENSITIVE SKIN SMALL BREED X7,5KG",
  // ── Perro — SENSITIVE ────────────────────────────────────────────────
  "PRO PLAN DOG PIEL Y ESTÓMAGO SENSIBLE MEDIANO Y GRANDE X3KG": "PRO PLAN DOG SENSITIVE SKIN & STOMACH MEDIUM & LARGE X3KG",
  "PRO PLAN DOG PIEL Y ESTÓMAGO SENSIBLE RAZA PEQUEÑA X3KG": "PRO PLAN DOG SENSITIVE SKIN & STOMACH SMALL BREED X3KG",
  "PRO PLAN DOG PIEL SENSIBLE RAZA PEQUEÑA X3KG": "PRO PLAN DOG SENSITIVE SKIN SMALL BREED X3KG",
  "PRO PLAN DOG PIEL SENSIBLE MEDIANO Y GRANDE X3KG": "PRO PLAN DOG SENSITIVE SKIN MEDIUM & LARGE X3KG",
  // ── Perro — REDUCED CALORIE ──────────────────────────────────────────
  "PRO PLAN DOG CALORÍAS REDUCIDAS MEDIANO Y GRANDE X12KG": "PRO PLAN DOG REDUCED CALORIE MEDIUM & LARGE X12KG",
  "PRO PLAN DOG CALORÍAS REDUCIDAS MEDIANO Y GRANDE X3KG": "PRO PLAN DOG REDUCED CALORIE MEDIUM & LARGE X3KG",
  "PRO PLAN DOG CALORÍAS REDUCIDAS RAZA PEQUEÑA X1KG": "PRO PLAN DOG REDUCED CALORIE SMALL BREED X1KG",
  "PRO PLAN DOG CALORÍAS REDUCIDAS RAZA PEQUEÑA X3KG": "PRO PLAN DOG REDUCED CALORIE SMALL BREED X3KG",
  "PRO PLAN DOG CALORÍAS REDUCIDAS RAZA PEQUEÑA X7,5KG": "PRO PLAN DOG REDUCED CALORIE SMALL BREED X7,5KG",
  // ── Húmedos ──────────────────────────────────────────────────────────
  "PRO PLAN WET CAT ESTERILIZADO 15X85G": "PRO PLAN WET CAT STERILIZED 15X85G",
  "PRO PLAN WET CAT KITTEN 15X85G": "PRO PLAN WET CAT KITTEN 15X85G",
  "PRO PLAN WET CAT POLLO 15X85G": "PRO PLAN WET CAT POLLO 15X85G",
  "PRO PLAN WET CAT SALMON 15X85G": "PRO PLAN WET CAT SALMON 15X85G",
  "PRO PLAN WET DOG POLLO 15X100G": "PRO PLAN WET DOG POLLO 15X100G",
};

async function main() {
  const args = process.argv.slice(2);
  const orgSlug = args.includes("--org") ? args[args.indexOf("--org") + 1] : null;
  const apply = args.includes("--apply");

  if (!orgSlug) {
    console.error("Usage: npx ts-node prisma/rename-proplan.ts --org <slug> [--apply]");
    process.exit(1);
  }

  console.log(`🔍 Rename Pro Plan products for org slug: ${orgSlug}`);
  console.log(`   Mode: ${apply ? "APPLY (writes)" : "DRY-RUN (preview only)"}`);
  console.log();

  const org = await db.organization.findFirst({ where: { slug: orgSlug } });
  if (!org) {
    console.error(`❌ Organization not found: ${orgSlug}`);
    process.exit(1);
  }
  console.log(`   Organization: ${org.name} (${org.id})`);

  // Fetch current Pro Plan products (all now start with "PRO PLAN").
  const products = await db.product.findMany({
    where: {
      organizationId: org.id,
      name: { contains: "PRO PLAN", mode: "insensitive" },
    },
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
  });
  console.log(`   Pro Plan products found: ${products.length}`);
  console.log(`   Entries in rename map: ${Object.keys(RENAME_MAP).length}`);
  console.log();

  const proposals: Array<{ id: string; code: string | null; old: string; next: string }> = [];
  const unchanged: Array<string> = [];
  const unmatched: Array<{ id: string; code: string | null; name: string }> = [];

  for (const p of products) {
    const next = RENAME_MAP[p.name.trim()];
    if (next === undefined) unmatched.push({ id: p.id, code: p.code, name: p.name });
    else if (next === p.name.trim()) unchanged.push(p.name);
    else proposals.push({ id: p.id, code: p.code, old: p.name, next });
  }

  // Safety: every map key should correspond to an actual product in the org.
  const foundOldNames = new Set(products.map((p) => p.name.trim()));
  const mapKeysNotInDb = Object.keys(RENAME_MAP).filter((k) => !foundOldNames.has(k));

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
    console.log(`⚠️  ${unmatched.length} Pro Plan product(s) NOT in the map (will be skipped):`);
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
    console.log(`   npx ts-node prisma/rename-proplan.ts --org ${orgSlug} --apply`);
  } else {
    if (unmatched.length > 0 || mapKeysNotInDb.length > 0) {
      console.error("❌ Aborting APPLY: there are unmatched/missing entries. Fix the map first.");
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

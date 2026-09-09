/**
 * Cargar/alinear productos "PRO PLAN VETERINARY DIETS" (Canine + Feline) según la
 * planilla del proveedor. Hace tres cosas:
 *   1) RENOMBRA los existentes al naming de la planilla (código + descriptivo,
 *      ej. EN GASTROENTERICO, NF NEFROLOGICO, OM OBESIDAD, UR URINARIO...).
 *   2) ACTUALIZA el precio de los ya cargados cuando difiere de la planilla.
 *   3) CREA los productos que faltan (con su peso y precio; sin precio → $0).
 *
 * No toca el campo code (el dueño dijo que no importa). Los nuevos van en la
 * categoría "Alimento Seco (Balanceado)" dominante de la org, sin proveedor,
 * con quantity 0 y weightKg set.
 *
 * Standalone ts-node — correr EN EL VPS. Dry-run por defecto; --apply escribe.
 *
 *   npx ts-node prisma/load-proplan-vet.ts --org el-almacen-de-las-mascotas
 *   npx ts-node prisma/load-proplan-vet.ts --org el-almacen-de-las-mascotas --apply
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

/** Nombre actual (normalizado) → { name?, price? }. Los que solo cambian nombre
 * no llevan price; los que solo cambian de precio no llevan name. */
const UPDATES: Record<string, { name?: string; price?: number }> = {
  // ── Canine ──
  "PRO PLAN DOG NEUROLOGICAL X2KG": { name: "PRO PLAN DOG NC NEUROLOGICO X2KG" },
  "PRO PLAN DOG NEUROLOGICAL X7,5KG": { name: "PRO PLAN DOG NC NEUROLOGICO X7,5KG" },
  "PRO PLAN DOG JOINT MOBILITY X2KG": { name: "PRO PLAN DOG JM MOV ARTICULAR X2KG", price: 32200 },
  "PRO PLAN DOG GASTROINTESTINAL X2KG": { name: "PRO PLAN DOG EN GASTROENTERICO X2KG" },
  "PRO PLAN DOG GASTROINTESTINAL X7,5KG": { name: "PRO PLAN DOG EN GASTROENTERICO X7,5KG" },
  "PRO PLAN DOG RENAL X2KG": { name: "PRO PLAN DOG NF NEFROLOGICO X2KG" },
  "PRO PLAN DOG RENAL X7,5KG": { name: "PRO PLAN DOG NF NEFROLOGICO X7,5KG", price: 82000 },
  "PRO PLAN DOG OBESITY X2KG": { name: "PRO PLAN DOG OM OBESIDAD X2KG" },
  "PRO PLAN DOG OBESITY X7,5KG": { name: "PRO PLAN DOG OM OBESIDAD X7,5KG", price: 78200 },
  "PRO PLAN DOG URINARY X2KG": { name: "PRO PLAN DOG UR URINARIO X2KG", price: 24600 },
  "PRO PLAN DOG URINARY X7,5KG": { name: "PRO PLAN DOG UR URINARIO X7,5KG", price: 73600 },
  // ── Feline ──
  "PRO PLAN CAT GASTROINTESTINAL X1,5KG": { name: "PRO PLAN CAT EN GASTROENTERICO X1,5KG" },
  "PRO PLAN CAT RENAL X1,5KG": { name: "PRO PLAN CAT NF NEFROLOGICO X1,5KG", price: 23000 },
  "PRO PLAN CAT OBESITY X1,5KG": { name: "PRO PLAN CAT OM OBESIDAD X1,5KG" },
};

/** Productos NUEVOS (faltan en la base) → { name, weightKg, price }. */
const NEW_PRODUCTS: Array<{ name: string; weightKg: number; price: number }> = [
  { name: "PRO PLAN DOG JM MOV ARTICULAR X7,5KG", weightKg: 7.5, price: 0 },
  { name: "PRO PLAN DOG HA HIDROLIZADO X2KG", weightKg: 2, price: 0 },
  { name: "PRO PLAN DOG CC CARDIOLOGICO X2KG", weightKg: 2, price: 0 },
  { name: "PRO PLAN DOG CC CARDIOLOGICO X7,5KG", weightKg: 7.5, price: 0 },
  { name: "PRO PLAN CAT HA HIPOALERGÉNICO X1,5KG", weightKg: 1.5, price: 0 },
  { name: "PRO PLAN CAT HA HIPOALERGÉNICO X3KG", weightKg: 3, price: 0 },
  { name: "PRO PLAN CAT NF NEFROLOGICO X3KG", weightKg: 3, price: 0 },
  { name: "PRO PLAN CAT OM OBESIDAD X3KG", weightKg: 3, price: 28000 },
  { name: "PRO PLAN CAT DM DIABETIC X1,5KG", weightKg: 1.5, price: 0 },
  { name: "PRO PLAN CAT UR URINARIO X1,5KG", weightKg: 1.5, price: 24700 },
  { name: "PRO PLAN CAT UR URINARIO X7,5KG", weightKg: 7.5, price: 102300 },
];

const norm = (s: string) => s.trim().replace(/\s+/g, " ");

async function main() {
  const args = process.argv.slice(2);
  const orgSlug = args.includes("--org") ? args[args.indexOf("--org") + 1] : null;
  const apply = args.includes("--apply");

  if (!orgSlug) {
    console.error("Usage: npx ts-node prisma/load-proplan-vet.ts --org <slug> [--apply]");
    process.exit(1);
  }

  console.log(`🔍 Cargar Pro Plan Veterinary Diets para org slug: ${orgSlug}`);
  console.log(`   Mode: ${apply ? "APPLY (writes)" : "DRY-RUN (preview only)"}`);
  console.log();

  const org = await db.organization.findFirst({ where: { slug: orgSlug } });
  if (!org) {
    console.error(`❌ Organization not found: ${orgSlug}`);
    process.exit(1);
  }
  const orgId = org.id;
  console.log(`   Organization: ${org.name} (${orgId})`);

  // Categoría "Alimento Seco (Balanceado)" dominante de la org (la usan 50
  // productos Pro Plan, verificada antes de correr el script).
  const category = await db.category.findFirst({
    where: { id: "123b9d5a-ff1f-472b-b773-0f0e65fd8612", organizationId: orgId },
  });
  if (!category) {
    console.error("❌ No se encontró la categoría Alimento Seco (Balanceado) esperada.");
    process.exit(1);
  }
  console.log(`   Categoría: ${category.name} (${category.id})`);
  console.log();

  // ── 1+2) Renombrar y/o actualizar precio de los existentes ──
  const updateKeys = Object.keys(UPDATES);
  const existing = await db.product.findMany({
    where: { organizationId: orgId, name: { in: updateKeys } },
    select: { id: true, name: true },
  });
  const existingByName = new Map(existing.map((p) => [norm(p.name), p]));
  const missingUpdates = updateKeys.filter((k) => !existingByName.has(k));

  console.log("📋 Existing product updates (rename / price):");
  for (const k of updateKeys) {
    const p = existingByName.get(k);
    if (!p) continue;
    const u = UPDATES[k];
    console.log(`   ${k}`);
    if (u.name) console.log(`   ${u.name ? "=> name: " + u.name : ""}`);
    if (u.price !== undefined) console.log(`   => price: ${u.price}`);
  }
  if (missingUpdates.length > 0) {
    console.log(`\n⚠️  Estos UPDATES no matchearon producto existente (revisar):`);
    for (const k of missingUpdates) console.log(`   - ${k}`);
  }
  console.log();

  // ── 3) Crear los que faltan ──
  const existingNames = new Set(existing.map((p) => norm(p.name)));
  const toCreate = NEW_PRODUCTS.filter((n) => !existingNames.has(norm(n.name)));
  const alreadyExisting = NEW_PRODUCTS.filter((n) => existingNames.has(norm(n.name)));

  console.log(`📋 New products to create (${toCreate.length}):`);
  for (const n of toCreate) {
    console.log(`   ${n.name} | ${n.weightKg} kg | $${n.price}`);
  }
  if (alreadyExisting.length > 0) {
    console.log(`\nℹ️  Estos ya existen (se omiten en este run):`);
    for (const n of alreadyExisting) console.log(`   - ${n.name}`);
  }
  console.log();

  if (!apply) {
    console.log("🔒 DRY-RUN: no writes performed.");
    console.log(`   Updates: ${updateKeys.length - missingUpdates.length} · Creates: ${toCreate.length}`);
    console.log();
    console.log("   Run with --apply to execute:");
    console.log(`   npx ts-node prisma/load-proplan-vet.ts --org ${orgSlug} --apply`);
    await db.$disconnect();
    return;
  }

  // ── APPLY ──
  if (missingUpdates.length > 0) {
    console.error("❌ Aborting APPLY: hay UPDATES que no matchean producto. Revisar el script.");
    await db.$disconnect();
    process.exit(1);
  }

  console.log("✍️  APPLYING...");

  // a) Update existing (rename + price) — 1 transacción.
  await db.$transaction(
    updateKeys.map((k) => {
      const p = existingByName.get(k)!;
      const u = UPDATES[k];
      return db.product.updateMany({
        where: { id: p.id, organizationId: orgId },
        data: {
          ...(u.name ? { name: u.name } : {}),
          ...(u.price !== undefined ? { price: u.price } : {}),
        },
      });
    }),
  );
  console.log(`   Renamed/updated: ${updateKeys.length}`);

  // b) Create new — 1 transacción (solo los que aún no existen).
  await db.$transaction(
    toCreate.map((n) =>
      db.product.create({
        data: {
          name: n.name,
          price: n.price,
          quantity: 0,
          weightKg: n.weightKg,
          categoryId: category.id,
          organizationId: orgId,
        },
      }),
    ),
  );
  console.log(`   Created: ${toCreate.length}`);

  console.log("✅ Done!");
  await db.$disconnect();
}

main().catch((e) => {
  console.error("❌ Fatal error:", e);
  process.exit(1);
});

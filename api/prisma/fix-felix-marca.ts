/**
 * Asignar la variante "Marca" = "Felix" a todos los productos del grupo FELIX
 * (marca Purina). Estos productos venían con la Marca mal puesta (Gati, Cat Chow)
 * o sin Marca → en el print del dashboard aparecían mezclados en otras secciones.
 *
 * Por cada producto cuyo nombre arranca con "FELIX":
 *   1) Resuelve (o crea) el CategoryVariantDefinition "Marca" de SU categoría.
 *   2) Resuelve (o crea) el CategoryVariantOption "Felix".
 *   3) Reemplaza las asignaciones "Marca" por una única hacia "Felix".
 *
 * Standalone ts-node — correr EN EL VPS. Dry-run por defecto; --apply escribe.
 *
 *   npx ts-node prisma/fix-felix-marca.ts --org el-almacen-de-las-mascotas
 *   npx ts-node prisma/fix-felix-marca.ts --org el-almacen-de-las-mascotas --apply
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

const PREFIX = "FELIX";
const BRAND = "Felix";

/** Resuelve (o crea) el CategoryVariantDefinition "Marca" de la categoría. */
async function ensureMarcaVariantDef(categoryId: string, orgId: string): Promise<string | null> {
  if (!categoryId) return null;
  const found = await db.categoryVariantDefinition.findFirst({
    where: { categoryId, name: "Marca", organizationId: orgId },
    select: { id: true },
  });
  if (found) return found.id;
  const created = await db.categoryVariantDefinition.create({
    data: { categoryId, name: "Marca", organizationId: orgId },
  });
  return created.id;
}

/** Resuelve (o crea) el CategoryVariantOption con el valor de marca. */
async function ensureMarcaOption(variantDefId: string, orgId: string, value: string): Promise<string> {
  const found = await db.categoryVariantOption.findFirst({
    where: { variantId: variantDefId, value, organizationId: orgId },
    select: { id: true },
  });
  if (found) return found.id;
  const created = await db.categoryVariantOption.create({
    data: { variantId: variantDefId, value, organizationId: orgId },
  });
  return created.id;
}

async function main() {
  const args = process.argv.slice(2);
  const orgSlug = args.includes("--org") ? args[args.indexOf("--org") + 1] : null;
  const apply = args.includes("--apply");

  if (!orgSlug) {
    console.error("Usage: npx ts-node prisma/fix-felix-marca.ts --org <slug> [--apply]");
    process.exit(1);
  }

  console.log(`🔍 Asignar Marca "${BRAND}" a productos ${PREFIX} para org slug: ${orgSlug}`);
  console.log(`   Mode: ${apply ? "APPLY (writes)" : "DRY-RUN (preview only)"}`);
  console.log();

  const org = await db.organization.findFirst({ where: { slug: orgSlug } });
  if (!org) {
    console.error(`❌ Organization not found: ${orgSlug}`);
    process.exit(1);
  }
  const orgId = org.id;
  console.log(`   Organization: ${org.name} (${orgId})`);

  const products = await db.product.findMany({
    where: { organizationId: orgId, name: { startsWith: PREFIX } },
    select: {
      id: true,
      name: true,
      categoryId: true,
      variantAssignments: {
        select: {
          option: { select: { id: true, value: true, variant: { select: { name: true } } } },
        },
      },
    },
    orderBy: { name: "asc" },
  });
  console.log(`   Productos ${PREFIX} encontrados: ${products.length}`);
  console.log();

  const plans: Array<{ name: string; current: string | null; action: "fix" | "add" }> = [];
  const ok: string[] = [];

  for (const p of products) {
    const marcaAssign = p.variantAssignments.find((a) => a.option.variant.name === "Marca");
    const current = marcaAssign?.option.value ?? null;
    if (current === BRAND) ok.push(p.name);
    else plans.push({ name: p.name, current, action: current === null ? "add" : "fix" });
  }

  if (ok.length > 0) {
    console.log(`ℹ️  ${ok.length} producto(s) ya tienen la Marca correcta (sin cambios):`);
    for (const n of ok) console.log(`   - ${n}`);
    console.log();
  }

  if (plans.length > 0) {
    console.log(`📋 CAMBIOS (${plans.length}):`);
    for (const r of plans) {
      const arrow = r.action === "add" ? "AGREGAR marca" : "CORREGIR marca";
      console.log(`   [${arrow}] ${r.name}`);
      console.log(`        Marca actual: ${r.current ?? "(sin marca)"} → destino: ${BRAND}`);
    }
    console.log();
  } else {
    console.log("✅ Todos los productos FELIX ya tienen la Marca correcta.");
  }

  if (!apply) {
    console.log("🔒 DRY-RUN: no writes performed. Run with --apply to persist.");
    console.log(`   Would change ${plans.length} product(s).`);
    console.log();
    console.log("   Run with --apply to execute:");
    console.log(`   npx ts-node prisma/fix-felix-marca.ts --org ${orgSlug} --apply`);
    await db.$disconnect();
    return;
  }

  if (plans.length === 0) {
    console.log("Nada que aplicar.");
    await db.$disconnect();
    return;
  }

  console.log("✍️  APPLYING...");
  let changed = 0;
  for (const r of plans) {
    const p = products.find((x) => x.name === r.name);
    if (!p) continue;

    const variantDefId = await ensureMarcaVariantDef(p.categoryId ?? "", orgId);
    if (!variantDefId) {
      console.error(`   ⚠️  ${r.name}: sin categoría, no se puede asignar Marca.`);
      continue;
    }
    const optionId = await ensureMarcaOption(variantDefId, orgId, BRAND);

    await db.$transaction([
      db.productVariant.deleteMany({
        where: { productId: p.id, option: { variant: { name: "Marca" } } },
      }),
      db.productVariant.create({
        data: { productId: p.id, optionId, organizationId: orgId },
      }),
    ]);
    changed++;
    console.log(`   ✔ ${r.name} → ${BRAND}`);
  }

  console.log();
  console.log(`✅ Cambiados: ${changed}/${plans.length}`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error("❌ Fatal error:", e);
  process.exit(1);
});

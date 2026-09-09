/**
 * Normalizar la variante "Marca" de los productos del grupo PURINA.
 *
 * Problema: el listado imprimible del dashboard agrupa por la variante "Marca"
 * (productBrandOf en printGrouping.ts). Los productos Purina llegaron con la
 * Marca mal asignada ("Gati", "Proplan", "Sabrosito") o sin Marca → en el print
 * aparecen secciones confusas (GATI, PROPLAN, SABROSITO, SIN MARCA) con
 * productos mezclados.
 *
 * Fix: para cada producto cuyo nombre arranca con un prefijo Purina, se asigna
 * la Marca correcta derivada del nombre. Se REEMPLAZA la Marca existente si es
 * distinta y se AGREGA si falta.
 *
 *   Marca derivada por prefijo del nombre:
 *     PRO PLAN / PROPLAN  → ProPlan
 *     CAT CHOW            → Cat Chow
 *     DOG CHOW            → Dog Chow
 *     EXCELLENT           → Excellent
 *
 * Por cada producto:
 *   1) Resuelve (o crea) el CategoryVariantDefinition "Marca" de SU categoría.
 *   2) Resuelve (o crea) el CategoryVariantOption con el valor de marca.
 *   3) Elimina los ProductVariant que apunten a una opción de variante "Marca"
 *      y crea el nuevo ProductVariant hacia la opción correcta.
 *
 * Standalone ts-node — correr EN EL VPS. Dry-run por defecto; --apply escribe.
 *
 *   npx ts-node prisma/fix-purina-marca.ts --org el-almacen-de-las-mascotas
 *   npx ts-node prisma/fix-purina-marca.ts --org el-almacen-de-las-mascotas --apply
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

/** Prefijos de nombre que identifican a cada marca del grupo Purina. */
const BRAND_BY_PREFIX: Array<{ prefix: string; brand: string }> = [
  { prefix: "PRO PLAN", brand: "ProPlan" },
  { prefix: "PROPLAN", brand: "ProPlan" },
  { prefix: "CAT CHOW", brand: "Cat Chow" },
  { prefix: "DOG CHOW", brand: "Dog Chow" },
  { prefix: "EXCELLENT", brand: "Excellent" },
];

/** Marca del grupo Purina que corresponde a un nombre (por prefijo). */
function brandOf(name: string): string | null {
  const n = (name || "").toUpperCase();
  for (const { prefix, brand } of BRAND_BY_PREFIX) {
    if (n.startsWith(prefix)) return brand;
  }
  return null;
}

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
    console.error("Usage: npx ts-node prisma/fix-purina-marca.ts --org <slug> [--apply]");
    process.exit(1);
  }

  console.log(`🔍 Normalizar Marca de productos Purina para org slug: ${orgSlug}`);
  console.log(`   Mode: ${apply ? "APPLY (writes)" : "DRY-RUN (preview only)"}`);
  console.log();

  const org = await db.organization.findFirst({ where: { slug: orgSlug } });
  if (!org) {
    console.error(`❌ Organization not found: ${orgSlug}`);
    process.exit(1);
  }
  const orgId = org.id;
  console.log(`   Organization: ${org.name} (${orgId})`);

  // Productos del grupo Purina: nombre arranca con algún prefijo.
  const products = await db.product.findMany({
    where: {
      organizationId: orgId,
      OR: BRAND_BY_PREFIX.map(({ prefix }) => ({ name: { startsWith: prefix } })),
    },
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
  console.log(`   Productos Purina encontrados: ${products.length}`);
  console.log();

  const plans: Array<{
    name: string;
    current: string | null;
    target: string;
    action: "fix" | "add";
  }> = [];
  const ok: Array<string> = [];

  for (const p of products) {
    const target = brandOf(p.name);
    if (!target) continue; // no debería pasar

    const marcaAssign = p.variantAssignments.find(
      (a) => a.option.variant.name === "Marca",
    );
    const current = marcaAssign?.option.value ?? null;

    if (current === target) {
      ok.push(p.name);
    } else {
      plans.push({
        name: p.name,
        current,
        target,
        action: current === null ? "add" : "fix",
      });
    }
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
      console.log(`        Marca actual: ${r.current ?? "(sin marca)"} → destino: ${r.target}`);
    }
    console.log();
  } else {
    console.log("✅ Todos los productos Purina ya tienen la Marca correcta.");
  }

  if (!apply) {
    console.log("🔒 DRY-RUN: no writes performed. Run with --apply to persist.");
    console.log(`   Would change ${plans.length} product(s).`);
    console.log();
    console.log("   Run with --apply to execute:");
    console.log(`   npx ts-node prisma/fix-purina-marca.ts --org ${orgSlug} --apply`);
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
    const optionId = await ensureMarcaOption(variantDefId, orgId, r.target);

    await db.$transaction([
      // Eliminar TODAS las asignaciones a variante "Marca" (corrige la mala o
      // limpia duplicados) y dejar una sola hacia la opción correcta.
      db.productVariant.deleteMany({
        where: { productId: p.id, option: { variant: { name: "Marca" } } },
      }),
      db.productVariant.create({
        data: { productId: p.id, optionId, organizationId: orgId },
      }),
    ]);
    changed++;
    console.log(`   ✔ ${r.name} → ${r.target}`);
  }

  console.log();
  console.log(`✅ Cambiados: ${changed}/${plans.length}`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error("❌ Fatal error:", e);
  process.exit(1);
});

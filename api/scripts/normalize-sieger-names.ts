/**
 * normalize-sieger-names.ts
 *
 * Tool de datos (standalone): normaliza TODOS los productos Sieger/Katze a
 * MAYÚSCULAS + espaciado consistente, y detecta/fusiona productos DUPLICADOS
 * (el mismo producto físico aparece dos veces: una fila con `code` y otra sin).
 *
 * Importante: NO reescribe la semántica del nombre (receta/presentación). Solo
 * unifica el casing y el espaciado. La detección de duplicados usa una CLAVE
 * interna (marca + presentación removidas + puntuación normalizada) que NUNCA
 * se escribe en la BD; solo sirve para agrupar.
 *
 * Default: DRY-RUN (genera un plan JSON, no toca nada).
 * `--apply`: ejecuta el plan (renames + merge de stock + borrado de drops seguros).
 *
 * Correr EN EL VPS (Node 20), con la BD de Postgres:
 *   npx ts-node scripts/normalize-sieger-names.ts            # dry-run
 *   npx ts-node scripts/normalize-sieger-names.ts --apply    # aplicar
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import * as fs from "fs";
import * as path from "path";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

const OUT_DIR = path.resolve(__dirname, "data");
const PLAN_PATH = path.join(OUT_DIR, "sieger-normalize-plan.json");
const SUMMARY_PATH = path.join(OUT_DIR, "sieger-normalize-summary.json");

/** Prefijos de marca a remover al construir la clave interna de receta. */
const BRAND_PREFIXES = ["SIEGER KATZE", "SIEGER", "KATZE"];

type ProductRow = {
  id: string;
  name: string;
  code: string | null;
  price: number;
  image: string | null;
  organizationId: string;
  _count: { stocks: number; saleItems: number; orderItems: number };
  stocks: Array<{ branchId: string; quantity: number }>;
};

type RenamePlan = { id: string; oldName: string; newName: string };
type MergePlan = {
  keepId: string;
  keepName: string;
  dropId: string;
  dropName: string;
  dropStockRows: Array<{ branchId: string; quantity: number }>;
  dropHasSales: boolean;
};

type Plan = {
  generatedAt: string;
  mode: "DRY" | "APPLY";
  totalProducts: number;
  renames: RenamePlan[];
  merges: MergePlan[];
  uniqueNormalized: number;
};

/**
 * Nombre normalizado para MOSTRAR/ESCRIBIR: uppercase, espacios colapsados,
 * trim. No altera el contenido de la receta ni la presentación (ni siquiera el
 * punto final, que los ejemplos confirman que se conserva: "X 3 KG.").
 */
function normalizeName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().toUpperCase();
}

/**
 * Extrae los pesos/presentaciones listados en un nombre (para emparejar un
 * drop sin-code con su canónico con-code). Ej "X 1/3/15 KG." → [1, 3, 15];
 * "X 7,5 kg." → [7.5]; "X 340 GR." → [340].
 */
function weightsOf(name: string): number[] {
  const out: number[] = [];
  const re = /(\d[\d/,.]*)\s*(?:kgs?|grs?|g)\b\.?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(name)) !== null) {
    for (const part of m[1].split("/")) {
      const n = parseFloat(part.replace(",", "."));
      if (Number.isFinite(n) && !out.includes(n)) out.push(n);
    }
  }
  return out;
}

/**
 * Clave interna de RECETA para agrupar duplicados. Remueve la marca, remueve la
 * presentación/peso y normaliza la puntuación (para que "MEDIUM & LARGE BREED"
 * y "MEDIUM LARGE BREED" queden iguales). Esta clave NUNCA se escribe en la BD.
 */
function recipeKey(name: string): string {
  let s = name.toUpperCase().replace(/\s+/g, " ").trim();
  for (const prefix of BRAND_PREFIXES) {
    s = s.replace(new RegExp(`^${prefix}\\s+`), "");
  }
  // Remover la presentación al final: "X 3 KG.", "1/3/15 kg.", "7,5 gr." etc.
  s = s.replace(/(?:\s*x\s*|\s*)\d[\d/,.]*\s*(?:kgs?|grs?|g)\b\.?\s*$/i, " ");
  // Normalizar puntuación (comas, puntos, &, etc.) para emparejar variantes.
  s = s.replace(/[&.,;:/]/g, " ").replace(/\s+/g, " ").trim();
  return s;
}

/** Elige el canónico (con code) para un producto sin-code dentro de un grupo. */
function pickKeep(
  uncoded: ProductRow,
  coded: ProductRow[],
): ProductRow {
  if (coded.length === 1) return coded[0];
  const uw = weightsOf(uncoded.name);
  let best: ProductRow | null = null;
  let bestOverlap = -1;
  for (const c of coded) {
    const cw = weightsOf(c.name);
    const overlap = uw.filter((w) => cw.includes(w)).length;
    if (overlap > bestOverlap || (overlap === bestOverlap && c.id < (best?.id ?? ""))) {
      best = c;
      bestOverlap = overlap;
    }
  }
  return best!;
}

async function fetchProducts(): Promise<ProductRow[]> {
  return db.product.findMany({
    where: {
      OR: [
        { name: { startsWith: "SIEGER" } },
        { name: { startsWith: "Sieger" } },
        { name: { startsWith: "KATZE" } },
        { name: { startsWith: "Katze" } },
      ],
    },
    select: {
      id: true,
      name: true,
      code: true,
      price: true,
      image: true,
      organizationId: true,
      _count: { select: { stocks: true, saleItems: true, orderItems: true } },
      stocks: { select: { branchId: true, quantity: true } },
    },
    orderBy: { name: "asc" },
  });
}

function buildPlan(products: ProductRow[]): Plan {
  const renames: RenamePlan[] = [];
  const merges: MergePlan[] = [];
  const mergedIds = new Set<string>();

  // Agrupar por receta (clave interna).
  const groups = new Map<string, ProductRow[]>();
  for (const p of products) {
    const key = recipeKey(p.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  for (const group of groups.values()) {
    const coded = group.filter((p) => p.code && p.code.trim().length > 0);
    const uncoded = group.filter((p) => !p.code || p.code.trim().length === 0);
    if (coded.length === 0 || uncoded.length === 0) continue;

    for (const u of uncoded) {
      const keep = pickKeep(u, coded);
      const dropHasSales = u._count.saleItems > 0 || u._count.orderItems > 0;
      merges.push({
        keepId: keep.id,
        keepName: keep.name,
        dropId: u.id,
        dropName: u.name,
        dropStockRows: u.stocks.map((s) => ({ branchId: s.branchId, quantity: s.quantity })),
        dropHasSales,
      });
      mergedIds.add(u.id);
    }
  }

  // Renames para TODOS los productos (tengan o no merge).
  for (const p of products) {
    const newName = normalizeName(p.name);
    if (newName !== p.name) renames.push({ id: p.id, oldName: p.name, newName });
  }

  const uniqueNormalized = products.filter(
    (p) => (!p.code || p.code.trim().length === 0) && !mergedIds.has(p.id),
  ).length;

  return {
    generatedAt: new Date().toISOString(),
    mode: "DRY",
    totalProducts: products.length,
    renames,
    merges,
    uniqueNormalized,
  };
}

function printSummary(plan: Plan): void {
  const withSales = plan.merges.filter((m) => m.dropHasSales).length;
  console.log(`📦 Productos Sieger/Katze encontrados: ${plan.totalProducts}`);
  console.log(`✏️  Re-nombres (mayúsculas + espaciado): ${plan.renames.length}`);
  console.log(`🔀 Grupos de merge detectados: ${plan.merges.length}`);
  console.log(`🪪  Solo-renombre sin duplicado (sin code, únicos): ${plan.uniqueNormalized}`);
  console.log(`⚠️  Merges con historial (salteados por riesgo): ${withSales}`);
  console.log();

  if (plan.merges.length === 0) {
    console.log("Sin merges a aplicar.");
  } else {
    console.log("🔀 DETALLE DE MERGES (keep → drop, stock a mover):");
    for (const m of plan.merges) {
      console.log(`   KEEP ${m.keepId}: ${m.keepName}`);
      console.log(`   DROP ${m.dropId}: ${m.dropName}  ${m.dropHasSales ? "⚠️ TIENE VENTAS/ÓRDENES" : "(sin ventas/órdenes)"}`);
      if (m.dropStockRows.length === 0) {
        console.log("        stock: (sin filas)");
      } else {
        for (const r of m.dropStockRows) {
          console.log(`        branch ${r.branchId}: ${r.quantity}`);
        }
      }
      console.log();
    }
  }

  if (plan.renames.length > 0) {
    console.log("✏️  EJEMPLOS DE RENOMBRE:");
    for (const r of plan.renames.slice(0, 5)) {
      console.log(`   · ${r.oldName}`);
      console.log(`     → ${r.newName}`);
    }
    if (plan.renames.length > 5) console.log(`     … (+${plan.renames.length - 5} más)`);
    console.log();
  }
}

async function applyPlan(plan: Plan): Promise<void> {
  let renamed = 0;
  let merged = 0;
  let skippedRisk = 0;
  let skippedMissing = 0;

  // 1) Re-nombres.
  for (const r of plan.renames) {
    try {
      await db.product.update({ where: { id: r.id }, data: { name: r.newName } });
      renamed++;
    } catch (e) {
      console.error(`   ⚠️ rename ${r.id}: ${(e as Error).message}`);
    }
  }

  // 2) Merges: mover stock y borrar el drop seguro.
  for (const m of plan.merges) {
    if (m.dropHasSales) {
      skippedRisk++;
      console.log(`   ⚠️ salteado por riesgo (drop tiene historial): ${m.dropName}`);
      continue;
    }
    try {
      await db.$transaction(async (tx) => {
        const keep = await tx.product.findFirst({ where: { id: m.keepId }, select: { id: true, organizationId: true } });
        const drop = await tx.product.findFirst({ where: { id: m.dropId }, select: { id: true, organizationId: true } });
        if (!keep || !drop) {
          // Idempotente: si el drop (o keep) ya no existe, skip.
          skippedMissing++;
          return;
        }
        for (const sr of m.dropStockRows) {
          const existing = await tx.productStock.findFirst({
            where: { productId: keep.id, branchId: sr.branchId },
            select: { id: true },
          });
          if (existing) {
            await tx.productStock.updateMany({
              where: { productId: keep.id, branchId: sr.branchId },
              data: { quantity: { increment: sr.quantity } },
            });
          } else {
            await tx.productStock.create({
              data: {
                productId: keep.id,
                branchId: sr.branchId,
                quantity: sr.quantity,
                organizationId: keep.organizationId,
              },
            });
          }
        }
        // El delete hace onDelete Cascade sobre product_stocks del drop.
        await tx.product.delete({ where: { id: drop.id } });
        merged++;
      });
    } catch (e) {
      console.error(`   ⚠️ merge ${m.dropId} → ${m.keepId}: ${(e as Error).message}`);
    }
  }

  // Resumen de apply.
  const summary = {
    generatedAt: new Date().toISOString(),
    mode: "APPLY",
    totalProducts: plan.totalProducts,
    renamed,
    merged,
    skippedMissing,
    skippedRisk,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2), "utf8");
  console.log(`💾 Resumen de apply escrito: ${SUMMARY_PATH}`);
  console.log();
  console.log(`✏️  Renombrados: ${renamed}/${plan.renames.length}`);
  console.log(`🔀 Merges aplicados (stock movido + drop borrado): ${merged}/${plan.merges.length}`);
  console.log(`🕳️  Drops ya inexistentes (skip, idempotente): ${skippedMissing}`);
  console.log(`⚠️  Merges salteados por riesgo (con historial): ${skippedRisk}`);
}

async function main() {
  const apply = process.argv.includes("--apply");

  console.log(`🔍 Normalizar nombres Sieger/Katze. Mode: ${apply ? "APPLY (writes)" : "DRY-RUN (preview only)"}`);
  console.log();

  const products = await fetchProducts();
  const plan = buildPlan(products);
  plan.mode = apply ? "APPLY" : "DRY";

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(PLAN_PATH, JSON.stringify(plan, null, 2), "utf8");
  console.log(`💾 Plan escrito: ${PLAN_PATH}`);
  printSummary(plan);

  if (!apply) {
    console.log("🔒 DRY-RUN: no se tocó la BD. Correr con --apply para escribir.");
    console.log(`   npx ts-node scripts/normalize-sieger-names.ts --apply`);
    await db.$disconnect();
    return;
  }

  console.log("✍️  APPLYING...");
  await applyPlan(plan);
  await db.$disconnect();
}

main().catch((e) => {
  console.error("❌ Fatal error:", e);
  process.exit(1);
});

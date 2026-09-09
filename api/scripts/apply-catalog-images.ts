/**
 * apply-catalog-images — aplica el reporte de mapeo (mapping-report.json):
 * descarga las imágenes de catálogo, las optimiza a webp / sube a Cloudflare R2,
 * y setea `Product.image` en la BD con la URL pública de R2.
 *
 *   - Herramienta de data: solo este script. No toca el resto del repo.
 *   - Reutiliza `uploadImageToR2` de src/config/storage.ts (sharp 1920w, webp q82).
 *   - Dedupe por imageUrl: varios productos comparten la misma foto de receta →
 *     se descarga/sube UNA sola vez y se reutiliza la URL de R2 (Map imageUrl→r2Url).
 *   - Concurrencia limitada (descargas CDN + updates BD) y delay entre descargas.
 *
 * Correr EN EL VPS (Node 20), donde existe la BD y el reporte:
 *   npx ts-node scripts/apply-catalog-images.ts                 # DRY-RUN
 *   npx ts-node scripts/apply-catalog-images.ts --limit 2       # DRY-RUN, 2 items
 *   npx ts-node scripts/apply-catalog-images.ts --apply --limit 2
 *   npx ts-node scripts/apply-catalog-images.ts --apply
 *
 * Sin `--apply`: descarga + sube a R2 pero NO toca la BD (valida la parte R2 sin
 * datos). Con `--apply`: además escribe `Product.image` con la URL de R2.
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { uploadImageToR2 } from "../src/config/storage";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

type MatchResult = {
  productId: string;
  productName: string;
  catalogMarca: string;
  catalogNombre: string;
  imageUrl: string;
  score: number;
};

type Report = {
  generatedAt: string;
  totalProducts: number;
  matched: MatchResult[];
  unmatched: unknown[];
};

type ProcessError = {
  kind: "skip" | "download" | "upload" | "update";
  productId?: string;
  productName?: string;
  imageUrl?: string;
  message: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, "data");
const REPORT_PATH = path.join(DATA_DIR, "mapping-report.json");
const ERRORS_PATH = path.join(DATA_DIR, "apply-errors.json");
const SUMMARY_PATH = path.join(DATA_DIR, "apply-summary.json");

const CONCURRENCY = 4;
const CDN_DELAY_MS = 150;
const DOWNLOAD_TIMEOUT_MS = 30000;
const DOWNLOAD_UA = "Mozilla/5.0 (compatible; Pullstok-ERP/1.0)";

// ─────────────────────────────────────────────────────────────────────────────
// Parsing de args / reporte
// ─────────────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { apply: boolean; limit: number | null } {
  const apply = argv.includes("--apply");
  let limit: number | null = null;
  const i = argv.indexOf("--limit");
  if (i !== -1 && argv[i + 1]) {
    const n = parseInt(argv[i + 1], 10);
    if (!Number.isNaN(n) && n > 0) limit = n;
  }
  return { apply, limit };
}

function readReport(): Report {
  const raw = fs.readFileSync(REPORT_PATH, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.matched)) {
    throw new Error(`Report ${REPORT_PATH} missing 'matched' array`);
  }
  return parsed as Report;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function downloadBuffer(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": DOWNLOAD_UA },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const rawContentType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!rawContentType.startsWith("image/")) {
    throw new Error(`content-type no es imagen: "${rawContentType || "(vacío)"}"`);
  }
  return { buffer: Buffer.from(await res.arrayBuffer()), contentType: rawContentType };
}

async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const n = Math.min(limit, items.length);
  const lanes = Array.from({ length: Math.max(1, n) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      await worker(items[i], i);
    }
  });
  await Promise.all(lanes);
}

function progress(prefix: string, done: number, total: number, errors: number): void {
  if (done % 20 === 0 || done === total) {
    console.log(`   ${prefix} ${done}/${total} OK · errores: ${errors}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const { apply, limit } = parseArgs(process.argv.slice(2));
  const block = () => console.log("═".repeat(60));

  block();
  console.log("🖼️  apply-catalog-images");
  console.log(`   Modalidad: ${apply ? "APPLY (escribe BD)" : "DRY-RUN (no toca la BD)"}`);
  console.log(`   Reporte:   ${REPORT_PATH}`);
  block();
  console.log();

  const report = readReport();
  console.log(`📑 Total productos en reporte: ${report.totalProducts}`);
  console.log(`   Matcheados: ${report.matched.length}`);

  // Filtrar items sin imageUrl (REGLA DE ORO: skip + loguear, no romper).
  const noImage = report.matched.filter((m) => !m.imageUrl);
  if (noImage.length > 0) {
    console.log(`   Sin imageUrl (skip): ${noImage.length}`);
  }

  const withImage = report.matched.filter((m) => m.imageUrl);

  // Aplicar --limit sobre los productos a procesar.
  const selected = limit ? withImage.slice(0, limit) : withImage;
  const skippedByLimit = withImage.length - selected.length;

  // Dedupe: imágenes ÚNICAS referenciadas por los productos seleccionados.
  const uniqueImages = [...new Set(selected.map((m) => m.imageUrl))];

  console.log();
  console.log(`🎯 A procesar: ${selected.length} productos`);
  if (skippedByLimit > 0) console.log(`   (límite --limit ${limit}: ${skippedByLimit} producto(s) fuera del alcance)`);
  if (noImage.length > 0) {
    console.log(`⏭️  Productos sin imageUrl (saltados, NO se procesan): ${noImage.length}`);
    for (const m of noImage) {
      console.log(`   · ${m.productName}`);
    }
  }
  console.log(`🖼️  Imágenes ÚNICAS a descargar/subir (dedupe): ${uniqueImages.length}`);
  console.log();

  const errors: ProcessError[] = [];

  // ─────────────────────────────────────────────────────────────────────────
  // Fase 1: descargar + subir a R2 (dedupe con Map<imageUrl, r2Url>)
  // ─────────────────────────────────────────────────────────────────────────
  const r2ByImage = new Map<string, string>();
  let imagesUploaded = 0;
  let imagesFailed = 0;
  let imagesDone = 0;

  console.log("📡 Fase 1 — descarga + subida a R2:");
  if (uniqueImages.length === 0) {
    console.log("   (sin imágenes únicas, nada que hacer)");
  } else {
    await runPool(uniqueImages, CONCURRENCY, async (imageUrl) => {
      try {
        await sleep(CDN_DELAY_MS); // amabilidad con el CDN entre descargas
        const { buffer, contentType } = await downloadBuffer(imageUrl);

        const prefix = `catalog_${randomUUID()}`;
        const r2Url = await uploadImageToR2(
          { buffer, originalname: `${prefix}.jpg`, mimetype: contentType || "image/jpeg" },
          "products",
        );

        r2ByImage.set(imageUrl, r2Url);
        imagesUploaded++;
      } catch (e) {
        imagesFailed++;
        errors.push({
          kind: /content-type/.test(String((e as Error).message)) ? "skip" : "download",
          imageUrl,
          message: (e as Error).message,
        });
        console.log(`   ⚠️  Imagen falló: ${imageUrl} → ${(e as Error).message}`);
      } finally {
        imagesDone++;
        progress("Imágenes", imagesDone, uniqueImages.length, errors.length);
      }
    });
  }

  console.log();
  console.log(`   ✅ Imágenes subidas a R2: ${imagesUploaded}`);
  console.log(`   ❌ Imágenes fallidas: ${imagesFailed}`);
  console.log();

  // ─────────────────────────────────────────────────────────────────────────
  // Fase 2: actualizar Product.image en la BD (SOLO con --apply)
  // ─────────────────────────────────────────────────────────────────────────
  let productsUpdated = 0;
  let productsFailed = 0;

  if (!apply) {
    console.log("🔒 DRY-RUN: no se conecta a la BD ni se escribe.");
  } else {
    console.log("✍️  Fase 2 — actualizando Product.image en la BD:");
    const { PrismaClient } = await import("@prisma/client");
    const { PrismaPg } = await import("@prisma/adapter-pg");
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    const db = new PrismaClient({ adapter });

    let done = 0;
    await runPool(selected, CONCURRENCY, async (m) => {
      const r2Url = r2ByImage.get(m.imageUrl);
      if (!r2Url) {
        productsFailed++;
        errors.push({
          kind: "update",
          productId: m.productId,
          productName: m.productName,
          imageUrl: m.imageUrl,
          message: "imagen no subida a R2 (ver errores de download/upload)",
        });
        done++;
        progress("Productos", done, selected.length, errors.length);
        return;
      }
      try {
        await db.product.update({ where: { id: m.productId }, data: { image: r2Url } });
        productsUpdated++;
      } catch (e) {
        productsFailed++;
        errors.push({
          kind: "update",
          productId: m.productId,
          productName: m.productName,
          imageUrl: m.imageUrl,
          message: (e as Error).message,
        });
      } finally {
        done++;
        progress("Productos", done, selected.length, errors.length);
      }
    });

    await db.$disconnect();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Resumen
  // ─────────────────────────────────────────────────────────────────────────
  console.log();
  block();
  console.log("RESUMEN");
  block();

  console.log(`Productos en reporte: ${report.matched.length}`);
  console.log(`Productos sin imageUrl (skip): ${noImage.length}`);
  console.log(`Productos actualizados (BD): ${productsUpdated}`);
  console.log(`Productos que fallaron en update: ${productsFailed}`);
  console.log(`Imágenes subidas a R2: ${imagesUploaded}`);
  console.log(`Imágenes fallidas: ${imagesFailed}`);
  console.log(`Errores totales: ${errors.length}`);

  if (!apply) {
    console.log();
    console.log("⚠️  IMPORTANTE: no se tocó la BD (DRY-RUN). El proceso de descarga + subida a R2 quedó");
    console.log("   validado; para escribir en la BD correr con --apply.");
  } else {
    console.log();
    console.log("✅ BD actualizada.");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Archivos de salida
  // ─────────────────────────────────────────────────────────────────────────
  fs.writeFileSync(
    ERRORS_PATH,
    JSON.stringify({ generatedAt: new Date().toISOString(), mode: apply ? "APPLY" : "DRY", errors }, null, 2),
    "utf8",
  );

  if (apply) {
    fs.writeFileSync(
      SUMMARY_PATH,
      JSON.stringify(
        { generatedAt: new Date().toISOString(), updatedCount: productsUpdated, r2UploadedCount: imagesUploaded, errorsCount: errors.length },
        null,
        2,
      ),
      "utf8",
    );
    console.log(`💾 Resumen de apply escrito: ${SUMMARY_PATH}`);
  }

  console.log(`💾 Errores detallados escritos: ${ERRORS_PATH}`);
  console.log();

  if (errors.length > 0 && errors.length <= 15) {
    console.log("Detalle de errores (ver apply-errors.json para el resto):");
    for (const e of errors) {
      const label = e.kind.toUpperCase();
      const who = e.productName ? ` [${e.productName}]` : "";
      console.log(`   · (${label})${who} ${e.imageUrl ?? ""} → ${e.message}`);
    }
  } else if (errors.length > 15) {
    console.log(`Detalle de errores en: ${ERRORS_PATH} (${errors.length} totales)`);
  }

  if (apply) {
    console.log();
    console.log("✅ BD actualizada — fin.");
  } else {
    console.log();
    console.log("🔒 DRY-RUN completo. No se modificó la BD.");
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error("❌ Error fatal:", e);
    process.exit(1);
  });
}

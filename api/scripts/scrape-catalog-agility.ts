/**
 * Scrape del catálogo de la marca AGILITY desde la API JSON pública.
 *
 * Fuente: POST https://staging-central.alican.com.ar/fetch/getdata
 *   Headers: X-API-Key, Content-Type
 *   Body:    { type, method, accion, marca, page, limit }
 *
 * Misma fuente que el scraper de Sieger (scrape-catalog-sieger.ts).
 * Cada registro trae `name`, `presentacion` (string con TODAS las presentaciones,
 * ej "1,5 kg, 10 kg"), `especie` (Gatos/Perros) y una imagen `url_frente`
 * (una foto GENÉRICA por receta/linea).
 *
 * Salida: `scripts/data/catalog-agility.json` — array de CatalogItem normalizado.
 *
 * CLI flags:
 *   --dry        (default) solo escribe el JSON.
 *
 * Uso (cwd = api/):
 *   npx ts-node scripts/scrape-catalog-agility.ts
 */

import fs from "fs";
import path from "path";

const API_URL = "https://staging-central.alican.com.ar/fetch/getdata";
const API_KEY = "0f8fad5b-d9cb-469f-a165-70867728950e";
const PAGE_SIZE = 40;
const MARCA = "Agility";
const DELAY_MS = 250;

const OUT_DIR = path.resolve(process.cwd(), "./scripts/data");
const OUT_FILE = path.join(OUT_DIR, "catalog-agility.json");

interface ApiItem {
  name?: string;
  presentacion?: string;
  url_frente?: string;
  url_dorso?: string;
}

type CatalogItem = {
  marca: string;
  nombre: string;
  presentaciones: string[];
  imageUrl: string;
  fuenteUrl: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const splitPresentaciones = (raw?: string): string[] =>
  (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

/** Fetchea una página de la API con reintento único (no rompe el run). */
async function fetchPage(page: number): Promise<{ items: ApiItem[]; total: number } | null> {
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "X-API-Key": API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ type: "web", method: "articulos", accion: "filtrar", marca: MARCA, page, limit: PAGE_SIZE }),
    });
    if (!res.ok) {
      console.error(`  ⚠️  API devolvió ${res.status} en page=${page}`);
      return null;
    }
    const json = (await res.json()) as { status?: boolean; items?: ApiItem[]; pagination?: { total?: number }; total?: number };
    const total = json.pagination?.total ?? json.total ?? 0;
    return { items: json.items || [], total };
  } catch (e: any) {
    console.error(`  ⚠️  Error fetcheando page=${page}: ${e.message}`);
    return null;
  }
}

async function main() {
  // --flags (por ahora solo --dry; el default ya escribe) --
  const dry = process.argv.includes("--dry");
  void dry;

  const seen = new Set<string>();
  const items: CatalogItem[] = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;
  let errors = 0;
  let dupes = 0;

  console.log(`🔍 Scrapeando catálogo AGILITY via ${API_URL}`);
  console.log(`   Page size: ${PAGE_SIZE} | Delay: ${DELAY_MS}ms`);
  console.log();

  // Paginá hasta agotar (página vacía o cuando ya alcanzamos `total`).
  while (page <= 20) {
    const data = await fetchPage(page);
    if (!data) {
      errors++;
      page++;
      await sleep(DELAY_MS);
      continue;
    }
    total = data.total || total;

    for (const it of data.items) {
      const nombre = (it.name || "").trim();
      const imageUrl = (it.url_frente || "").trim();
      if (!nombre) continue;
      if (!imageUrl) {
        console.error(`  ⚠️  Item sin url_frente (se salta): ${nombre}`);
        continue;
      }
      const key = `${nombre}||${imageUrl}`;
      if (seen.has(key)) {
        dupes++;
        continue;
      }
      seen.add(key);
      items.push({
        marca: MARCA,
        nombre,
        presentaciones: splitPresentaciones(it.presentacion),
        imageUrl,
        fuenteUrl: API_URL,
      });
    }

    console.log(`   page=${page}: ${data.items.length} items | acumulado=${items.length}/${total || "?"}`);
    if (data.items.length === 0) break;
    if (items.length >= total) break;
    page++;
    await sleep(DELAY_MS);
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(items, null, 2), "utf8");

  console.log();
  console.log(`✅ Escrito: ${OUT_FILE}`);
  console.log(`   Items: ${items.length} | saltados por error: ${errors} | duplicados: ${dupes}`);
}

main().catch((e: any) => {
  console.error("❌ Fatal:", e);
  process.exit(1);
});

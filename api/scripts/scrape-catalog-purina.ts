/**
 * Scrape del catálogo de marcas PURINA (Ar) desde sitemaps + JSON-LD.
 *
 * Fuente:
 *   Index:  https://www.purina.com.ar/sitemaps/index/sitemap.xml
 *   Marca:  https://www.purina.com.ar/sitemaps/<marca>/sitemap.xml
 *
 * Cada sitemap lista <loc> páginas. Se filtran las que parecen fichas de producto
 * (excluyendo páginas informativas: términos, bases/condiciones, avisos, prensa,
 * reciclaje, "por el planeta", etc). Luego se fetchea cada ficha:
 *   - El nombre/brand/category salen del JSON-LD `@type: "Product"` (dentro de @graph).
 *   - Las imágenes van en <img src> con lazy-load; la ficha NO trae og:image ni imagen
 *     en el JSON-LD. Se prefiere la imagen bajo `/styles/webp/public/` (la "frente").
 *
 * Salida: `scripts/data/catalog-purina.json` — array de CatalogItem normalizado.
 *   Las presentaciones se dejan en [] (la fuente no las expone de forma confiable);
 *   no se inventan.
 *
 * CLI flags:
 *   --dry        (default) solo escribe el JSON.
 *
 * Uso (cwd = api/):
 *   npx ts-node scripts/scrape-catalog-purina.ts
 */

import fs from "fs";
import path from "path";

const INDEX_URL = "https://www.purina.com.ar/sitemaps/index/sitemap.xml";
const DELAY_MS = 250;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

// marca del sitemap → nombre legible de la marca (fallback si el JSON-LD no trae brand).
const BRANDS: Record<string, string> = {
  proplan_purina_latam_com: "Pro Plan",
  catchow_purina_latam_com: "Cat Chow",
  dogchow_purina_latam_com: "Dog Chow",
  excellent_purina_latam_com: "Excellent",
  felix_purina_latam_com: "Felix",
  fancy_feast_purina_latam_com: "Fancy Feast",
  bonelo_purina_latam_com: "Bonelo",
  dogui_purina_latam_com: "Dogui",
  gati_purina_latam_com_gati: "Gati",
  dentalife_purina_latam_com: "Dentalife",
  tidycats_purina_latam_com: "Tidy Cats",
  purina_one_purina_latam_com: "Purina One",
};

// Páginas informativas a descartar por URL.
const INFO_RE =
  /terminos|condiciones|aviso|privacidad|cookies|preguntas|registrate|recicla|planeta|sorteo|campana|juntos|calidad|visible|donde|adopta|nosotr|universo|noticia|estudio|longevidad|beneficios|inicio|comenzar|sobre-nos|nuestr|home$/i;

// Slugs "puramente listados" (agrupadores, no fichas).
const LISTING_SLUGS = new Set(["", "productos", "inicio", "home", "productos-tidycats"]);

const OUT_DIR = path.resolve(process.cwd(), "./scripts/data");
const OUT_FILE = path.join(OUT_DIR, "catalog-purina.json");

type CatalogItem = {
  marca: string;
  nombre: string;
  presentaciones: string[];
  imageUrl: string;
  fuenteUrl: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) {
      console.error(`  ⚠️  ${res.status} ${res.statusText} → ${url}`);
      return null;
    }
    return await res.text();
  } catch (e: any) {
    console.error(`  ⚠️  error fetch ${url}: ${e.message}`);
    return null;
  }
}

const getLocs = (xml: string): string[] =>
  [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

/** Filtra locs a candidatos a ficha de producto. */
function isCandidate(host: string, url: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }
  const segs = pathname.split("/").filter(Boolean);
  if (!pathname.startsWith(`/${host}`)) return false;
  if (segs.length < 2) return false; // brand root: /marca
  const last = segs[segs.length - 1];
  if (LISTING_SLUGS.has(last)) return false;
  if (INFO_RE.test(pathname)) return false;
  return true;
}

/** Busca el objecto Product dentro del JSON-LD (graph o array). */
function findProduct(html: string): Record<string, any> | null {
  const ldRe = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = ldRe.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      const flat = nodes.flatMap((n) => (n && n["@graph"] ? n["@graph"] : [n]));
      const prod = flat.find((x) => x && x["@type"] === "Product");
      if (prod && typeof prod.name === "string") return prod;
    } catch {
      // bloque JSON-LD no parseable: ignorar
    }
  }
  return null;
}

/** Extrae la imagen principal: og:image > JSON-LD image > img producto (styles/webp). */
function extractImage(html: string, pageUrl: string, product: Record<string, any> | null): string {
  // 1) og:image
  const og = /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i.exec(html);
  if (og && og[1]) {
    try {
      return new URL(og[1], pageUrl).href;
    } catch {
      /* ignore */
    }
  }

  // 2) imagen en el JSON-LD
  if (product) {
    const imgRaw = Array.isArray(product.image) ? product.image[0] : product.image;
    const imageVal = imgRaw && typeof imgRaw === "object" ? imgRaw.url : imgRaw;
    if (typeof imageVal === "string" && imageVal) return new URL(imageVal, pageUrl).href;
  }

  // 3) <img> — preferir la "frente" dentro de /styles/webp/public/
  const imgs = [...html.matchAll(/<img[^>]*src=["']([^"']+)["']/gi)].map((m) => m[1]);
  const abs = imgs
    .map((u) => {
      try {
        return new URL(u, pageUrl).href;
      } catch {
        return null;
      }
    })
    .filter((u): u is string => !!u);

  const webp = abs.filter((u) => /\/sites\/default\/files\/styles\/webp\/public\//i.test(u));
  const pickFrom = (arr: string[]) =>
    arr.find((u) => /frente|front|pack|principal|hero/i.test(u)) || arr[0];

  const heroWebp = pickFrom(webp);
  if (heroWebp) return heroWebp;

  // 4) fallback: cualquier imagen de /sites/default/files/ (prefiriendo "frente")
  const files = abs.filter((u) => /\/sites\/default\/files\//i.test(u) && !/styles\/webp\/public\//i.test(u));
  const heroFile = pickFrom(files);
  if (heroFile) return heroFile;

  return "";
}

/** Resuelve la marca canónica: el JSON-LD a veces da nombres cortos ("One")
 * o compuestos ("Purina Dentalife"); se mapea contra las marcas conocidas del
 * sitemap y, si no matchea, se usa la marca del sitemap. */
function resolveMarca(brandName: string | undefined | null, sitemapDisplay: string): string {
  if (!brandName) return sitemapDisplay;
  const low = brandName.toLowerCase();
  const known = Object.values(BRANDS);
  const hit = known.find((b) => low.includes(b.toLowerCase()));
  return hit || sitemapDisplay;
}

/** Fetchea un sitemap de marca y devuelve sus locs como candidatos. */
async function getBrandCandidates(brand: string): Promise<string[]> {
  const url = `https://www.purina.com.ar/sitemaps/${brand}/sitemap.xml`;
  const xml = await fetchText(url);
  if (!xml) return [];
  const locs = getLocs(xml);
  return locs.filter((l) => isCandidate(brand.split("_")[0], l));
}

async function main() {
  const dry = process.argv.includes("--dry");
  void dry;

  const seen = new Set<string>();
  const items: CatalogItem[] = [];
  let fetched = 0;
  let skippedNoProduct = 0;
  let noImage = 0;
  let errors = 0;

  console.log(`🔍 Scrapeando catálogo PURINA via sitemaps (${Object.keys(BRANDS).length} marcas)`);
  console.log(`   Delay: ${DELAY_MS}ms | UA: ${USER_AGENT.slice(0, 30)}...`);
  console.log();

  for (const [brand, displayName] of Object.entries(BRANDS)) {
    const candidates = await getBrandCandidates(brand);
    console.log(`\n[${displayName}] ${candidates.length} candidatos a ficha`);
    for (const url of candidates) {
      const html = await fetchText(url);
      fetched++;
      if (html === null) {
        errors++;
        await sleep(DELAY_MS);
        continue;
      }

      const product = findProduct(html);
      if (!product) {
        skippedNoProduct++;
        await sleep(DELAY_MS);
        continue;
      }

      const nombre = (product.name || "").trim();
      if (!nombre) {
        skippedNoProduct++;
        await sleep(DELAY_MS);
        continue;
      }

      const imageUrl = extractImage(html, url, product);
      if (!imageUrl) noImage++;

      const marca = resolveMarca(product.brand && product.brand.name, displayName);
      const fuenteUrl =
        (typeof product.url === "string" && product.url) || url;

      const key = `${nombre}||${imageUrl}`;
      if (seen.has(key)) {
        await sleep(DELAY_MS);
        continue;
      }
      seen.add(key);
      items.push({
        marca,
        nombre,
        presentaciones: [],
        imageUrl,
        fuenteUrl,
      });
      if (!imageUrl) console.error(`  ⚠️  sin imagen: ${nombre}`);
      await sleep(DELAY_MS);
    }
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(items, null, 2), "utf8");

  console.log();
  console.log(`✅ Escrito: ${OUT_FILE}`);
  console.log(`   Items: ${items.length} | paginas fetcheadas: ${fetched}`);
  console.log(`   sin JSON-LD Product: ${skippedNoProduct} | sin imagen: ${noImage} | errores: ${errors}`);
}

main().catch((e: any) => {
  console.error("❌ Fatal:", e);
  process.exit(1);
});

/**
 * Map-image: correlaciona productos PET-FOOD (grupos Purina / Sieger) de la BD
 * con un catálogo externo de imágenes de recetas, y produce un reporte dry-run.
 *
 *   - NO modifica la BD ni código de la app.
 *   - Por defecto DRY-RUN; `--apply` es un no-op preparado (no escribe).
 *
 * Correr EN EL VPS (Node 20), donde existe la BD:
 *   npx ts-node scripts/map-catalog-images.ts
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

type CatalogItem = {
  marca: string;
  nombre: string;
  presentaciones: string[];
  imageUrl: string;
  fuenteUrl: string;
};

type ProductRow = {
  id: string;
  name: string;
  price: number;
  code: string | null;
  image: string | null;
};

type MatchResult = {
  productId: string;
  productName: string;
  catalogMarca: string;
  catalogNombre: string;
  imageUrl: string;
  score: number;
};

type UnmatchedResult = {
  productId: string;
  productName: string;
};

type Report = {
  generatedAt: string;
  totalProducts: number;
  matched: MatchResult[];
  unmatched: UnmatchedResult[];
  alreadyImage: UnmatchedResult[];
};

type PrecomputedItem = {
  item: CatalogItem;
  tokens: Map<string, number>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const THRESHOLD = 0.35;
const DATA_DIR = path.join(__dirname, "data");

const CATALOG_FILES: Array<{ file: string; label: string }> = [
  { file: "catalog-purina.json", label: "Purina" },
  { file: "catalog-sieger.json", label: "Sieger" },
  { file: "catalog-agility.json", label: "Agility" },
];

// Prefijo de nombre del ERP → marca del catálogo. `marca: null` = prefijo
// conocido pero SIN catálogo de imágenes (siempre sin-match).
const BRAND_PREFIXES: Array<{ prefix: string; marca: string | null }> = [
  { prefix: "PRO PLAN", marca: "Pro Plan" },
  { prefix: "PROPLAN", marca: "Pro Plan" },
  { prefix: "PURINA ONE", marca: "Purina One" },
  { prefix: "CAT CHOW", marca: "Cat Chow" },
  { prefix: "DOG CHOW", marca: "Dog Chow" },
  { prefix: "EXCELLENT", marca: "Excellent" },
  { prefix: "DENTALIFE", marca: "Dentalife" },
  { prefix: "FELIX", marca: "Felix" },
  { prefix: "BONELO", marca: null },
  { prefix: "FANCY", marca: null },
  { prefix: "DOGUI", marca: "Dogui" },
  { prefix: "GATI", marca: "Gati" },
  { prefix: "TIDY", marca: "Tidy Cats" },
  { prefix: "SIEGER", marca: "Sieger" },
  // Variantes capitalizadas y línea felina de Sieger (case-sensitive startsWith):
  { prefix: "Sieger", marca: "Sieger" },
  { prefix: "KATZE", marca: "Sieger" },
  { prefix: "Katze", marca: "Sieger" },
  { prefix: "AGILITY", marca: "Agility" },
  { prefix: "Agility", marca: "Agility" },
].sort((a, b) => b.prefix.length - a.prefix.length);

// Especie que se puede inferir de forma inequívoca según la marca.
const BRAND_SPECIES: Record<string, string> = {
  "Dog Chow": "DOG",
  "Cat Chow": "CAT",
};

const CATEGORY_WEIGHT: Record<string, number> = {
  DOG: 1.2,
  CAT: 1.2,
  PUPPY: 1.0,
  KITTEN: 1.0,
  ADULT: 1.0,
  SENIOR: 1.0,
  STERILIZED: 0.95,
  CHICKEN: 0.9,
  SALMON: 0.9,
  TUNA: 0.85,
  TURKEY: 0.9,
  FISH: 0.9,
  LAMB: 0.9,
  BEEF: 0.9,
  LIVER: 0.8,
  SMALL: 0.8,
  MEDIUM: 0.8,
  LARGE: 0.8,
  URINARY: 0.9,
  RENAL: 0.9,
  GASTRO: 0.9,
  HEPATIC: 0.9,
  DERMA: 0.85,
  SENSITIVE: 0.8,
  HAIRBALL: 0.85,
  LIGHT: 0.85,
  PROTEIN: 0.7,
  ACTIVE: 0.7,
  WET: 0.5,
  DRY: 0.5,
  VET: 0.4,
  BREED: 0.3,
};

// Token superficial (normalizado) → token canónico.
const SYNONYMS: Record<string, string> = {
  PERRO: "DOG",
  PERROS: "DOG",
  PERRA: "DOG",
  PERRAS: "DOG",
  DOG: "DOG",
  DOGS: "DOG",
  CANINO: "DOG",
  CANINOS: "DOG",
  GATO: "CAT",
  GATOS: "CAT",
  GATA: "CAT",
  GATAS: "CAT",
  CAT: "CAT",
  CATS: "CAT",
  FELINO: "CAT",
  FELINOS: "CAT",
  KATZE: "CAT",
  FELINE: "CAT",
  PUPPY: "PUPPY",
  PUPPIES: "PUPPY",
  CACHORRO: "PUPPY",
  CACHORROS: "PUPPY",
  CACHORRA: "PUPPY",
  CACHORRAS: "PUPPY",
  CRIA: "PUPPY",
  KITTEN: "KITTEN",
  GATITO: "KITTEN",
  GATITOS: "KITTEN",
  KITTY: "KITTEN",
  ADULT: "ADULT",
  ADULTO: "ADULT",
  ADULTOS: "ADULT",
  ADULTA: "ADULT",
  ADULTAS: "ADULT",
  ADULTS: "ADULT",
  SENIOR: "SENIOR",
  MAYOR: "SENIOR",
  MAYORES: "SENIOR",
  LONGEVIDAD: "SENIOR",
  ANOS: "SENIOR",
  AÑOS: "SENIOR",
  STERILIZED: "STERILIZED",
  ESTERILIZADO: "STERILIZED",
  ESTERILIZADOS: "STERILIZED",
  CASTRADO: "STERILIZED",
  CASTRADOS: "STERILIZED",
  CHICKEN: "CHICKEN",
  POLLO: "CHICKEN",
  POLLA: "CHICKEN",
  SALMON: "SALMON",
  SALMN: "SALMON",
  TUNA: "TUNA",
  ATUN: "TUNA",
  TURKEY: "TURKEY",
  PAVO: "TURKEY",
  FISH: "FISH",
  PESCADO: "FISH",
  PEZ: "FISH",
  PECES: "FISH",
  LAMB: "LAMB",
  CORDERO: "LAMB",
  BEEF: "BEEF",
  CARNE: "BEEF",
  VACUNO: "BEEF",
  RES: "BEEF",
  LIVER: "LIVER",
  HIGADO: "LIVER",
  SMALL: "SMALL",
  MINI: "SMALL",
  MINIS: "SMALL",
  PEQUENO: "SMALL",
  PEQUENOS: "SMALL",
  PEQUENA: "SMALL",
  PEQUENAS: "SMALL",
  CHICO: "SMALL",
  CHICOS: "SMALL",
  MEDIUM: "MEDIUM",
  MEDIANO: "MEDIUM",
  MEDIANOS: "MEDIUM",
  MEDIANA: "MEDIUM",
  MEDIANAS: "MEDIUM",
  MEDIO: "MEDIUM",
  LARGE: "LARGE",
  GRANDE: "LARGE",
  GRANDES: "LARGE",
  GRAN: "LARGE",
  URINARY: "URINARY",
  URINARIO: "URINARY",
  URINARIOS: "URINARY",
  RENAL: "RENAL",
  RINON: "RENAL",
  RIÑON: "RENAL",
  RINONES: "RENAL",
  GASTROINTESTINAL: "GASTRO",
  GASTRO: "GASTRO",
  GASTROENTERICO: "GASTRO",
  GASTRIC: "GASTRO",
  DIGESTIVE: "GASTRO",
  HEPATIC: "HEPATIC",
  HEPATICO: "HEPATIC",
  HEPATICA: "HEPATIC",
  DERMA: "DERMA",
  PIEL: "DERMA",
  SKIN: "DERMA",
  DERMAPROTECT: "DERMA",
  SKINCARE: "DERMA",
  SENSITIVE: "SENSITIVE",
  SENSIBLE: "SENSITIVE",
  HAIRBALL: "HAIRBALL",
  HAIR: "HAIRBALL",
  CALORIE: "LIGHT",
  CALORIAS: "LIGHT",
  REDUCED: "LIGHT",
  REDUCIDAS: "LIGHT",
  SOBREPESO: "LIGHT",
  OBESITY: "LIGHT",
  OBESIDAD: "LIGHT",
  OBESOS: "LIGHT",
  WEIGHT: "LIGHT",
  CONTROL: "LIGHT",
  PESO: "LIGHT",
  LIGHT: "LIGHT",
  PROTEIN: "PROTEIN",
  PROTEINA: "PROTEIN",
  PROTEINAS: "PROTEIN",
  ACTIVE: "ACTIVE",
  MENTE: "ACTIVE",
  ACTIVA: "ACTIVE",
  BREEDS: "BREED",
  BREED: "BREED",
  VET: "VET",
  VETERINARIA: "VET",
  VETERINARIAS: "VET",
  VETERINARY: "VET",
  WET: "WET",
  HUMEDO: "WET",
  HUMEDA: "WET",
  DRY: "DRY",
  SECO: "DRY",
  SECA: "DRY",
};

const STOPWORDS = new Set([
  "ALIMENTO",
  "ALIMENTOS",
  "PARA",
  "CON",
  "Y",
  "E",
  "O",
  "A",
  "DE",
  "LA",
  "EL",
  "LAS",
  "LOS",
  "EN",
  "AL",
  "UN",
  "UNA",
  "UNO",
  "SU",
  "SABOR",
  "S",
  "COMO",
  "AND",
  "THE",
  "DOBLE",
  "PRODUCTO",
  "RAZA",
  "RAZAS",
  "TAMANO",
  "TAMANOS",
  "TODOS",
  "TODAS",
  "TODO",
  "ALL",
  "DEFENSE",
  "HYDRO",
  "PLUS",
  "MIX",
  "MEGA",
  "EXIGENTE",
]);

// Token que representa la presentación (peso/unidades) → se descarta en el naming.
const PRESENTATION_RE =
  /^x?\d+[.,]?\d*kg$|^x?\d+[.,]?\d*$|^\d+[.,]?\d*x\d+[.,]?\d*[gk]$|^(g|gr|kg|uni|unid|unidades|u)$/i;

// ─────────────────────────────────────────────────────────────────────────────
// Normalización y tokenización
// ─────────────────────────────────────────────────────────────────────────────

/** A mayúsculas, sin acentos (NFD), sin puntuación (se conservan + , . y dígitos). */
function normalize(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w+.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function tokens(s: string): string[] {
  return normalize(s).split(" ").filter((t) => t.length > 0);
}

function stripPresentations(toks: string[]): string[] {
  return toks.filter((t) => !PRESENTATION_RE.test(t));
}

/** Índice de marca a partir del nombre del producto; devuelve marca y receta (sin marca). */
function brandInfo(name: string): { marca: string | null; recipe: string } {
  const n = normalize(name);
  for (const { prefix, marca } of BRAND_PREFIXES) {
    if (n.startsWith(prefix)) {
      return { marca, recipe: n.slice(prefix.length).trim() };
    }
  }
  return { marca: null, recipe: n };
}

/** Convierte un texto en un Map<token canónico, peso>. */
function canonicalize(text: string): Map<string, number> {
  const result = new Map<string, number>();
  let rawToks: string[] = [];
  if (text) rawToks = stripPresentations(tokens(text));
  for (const tok of rawToks) {
    let canonical: string | null = null;
    if (STOPWORDS.has(tok)) continue;

    const syn = SYNONYMS[tok];
    if (syn) canonical = syn;
    else if (/^\+?\d{1,2}\+?$/.test(tok)) {
      const n = parseInt(tok.replace(/\D/g, ""), 10);
      if (n >= 7) canonical = "SENIOR";
      else continue; // números chicos = ruido de presentación
    } else {
      canonical = tok; // token desconocido (ej. POUCH, LIVER, OPTIRENAL)
    }
    result.set(canonical, CATEGORY_WEIGHT[canonical] ?? 0.4);
  }
  return result;
}

/** Inyecta especie inferida por marca si la receta no la menciona. */
function injectSpecies(tokens: Map<string, number>, marca: string): Map<string, number> {
  const t = new Map(tokens);
  if (t.has("DOG") || t.has("CAT")) return t;
  const sp = BRAND_SPECIES[marca];
  if (sp) t.set(sp, CATEGORY_WEIGHT[sp]);
  return t;
}

/** Similitud ponderada por categoría: matchedWeight / unionWeight (0..1). */
function scoreTokens(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let matched = 0;
  let union = 0;
  const keys = new Set<string>([...a.keys(), ...b.keys()]);
  for (const k of keys) {
    const wA = a.get(k) ?? 0;
    const wB = b.get(k) ?? 0;
    union += Math.max(wA, wB);
    if (wA > 0 && wB > 0) matched += Math.min(wA, wB);
  }
  return union > 0 ? matched / union : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Matcher
// ─────────────────────────────────────────────────────────────────────────────

/** Pre-canonicaliza los items del catálogo (una vez). */
function precomputeCatalog(items: CatalogItem[]): PrecomputedItem[] {
  return items.map((item) => ({
    item,
    tokens: canonicalize(item.nombre.replace(new RegExp(normalize(item.marca), "i"), " ")),
  }));
}

/** Devuelve el mejor item del catálogo de la marca, o null si bajo el umbral. */
function bestMatch(
  productTokens: Map<string, number>,
  catalog: PrecomputedItem[],
): { item: CatalogItem; score: number } | null {
  let best: CatalogItem | null = null;
  let bestScore = 0;
  for (const c of catalog) {
    const sc = scoreTokens(productTokens, c.tokens);
    if (sc > bestScore) {
      bestScore = sc;
      best = c.item;
    }
  }
  if (!best || bestScore < THRESHOLD) return null;
  return { item: best, score: bestScore };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lectura de catálogo
// ─────────────────────────────────────────────────────────────────────────────

function readCatalog(fileName: string): CatalogItem[] {
  const full = path.join(DATA_DIR, fileName);
  const raw = fs.readFileSync(full, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Catalog ${fileName} is not an array`);
  }
  return parsed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const apply = process.argv.includes("--apply");

  console.log("🧠 map-catalog-images — modalidad:", apply ? "APPLY (no-op)" : "DRY-RUN");
  console.log();

  const catalogs: Array<{ label: string; items: PrecomputedItem[] }> = [];
  for (const { file, label } of CATALOG_FILES) {
    const items = precomputeCatalog(readCatalog(file));
    catalogs.push({ label, items });
    console.log(`📖 Catálogo ${label}: ${items.length} items`);
  }
  console.log();

  const byMarca = new Map<string, PrecomputedItem[]>();
  const availableBrands = new Set<string>();
  for (const cat of catalogs) {
    for (const it of cat.items) {
      availableBrands.add(it.item.marca);
      const arr = byMarca.get(it.item.marca) ?? [];
      arr.push(it);
      byMarca.set(it.item.marca, arr);
    }
  }

  const prefixes = BRAND_PREFIXES.filter((p) => p.marca !== null).map((p) => p.prefix);
  const knownNoCatalog = BRAND_PREFIXES.filter((p) => p.marca === null).map((p) => p.prefix);

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const db = new PrismaClient({ adapter });

  let products: ProductRow[] = [];
  try {
    products = await db.product.findMany({
      where: {
        OR: prefixes.map((prefix) => ({ name: { startsWith: prefix } })),
      },
      select: { id: true, name: true, price: true, code: true, image: true },
      orderBy: { name: "asc" },
    });
  } catch (e) {
    console.error("❌ No se pudo consultar la BD (productos).", e);
    console.error("   La BD solo existe en el VPS. Validá el script localmente con tsc/ts-node.");
    await db.$disconnect();
    process.exit(1);
  }

  console.log(`🛒 Productos PET-FOOD encontrados: ${products.length}`);
  console.log();

  const matched: MatchResult[] = [];
  const unmatched: UnmatchedResult[] = [];
  const alreadyImage: UnmatchedResult[] = [];

  for (const p of products) {
    // Saltar productos que ya tienen imagen (corridas incrementales / re-runs).
    if (p.image) {
      alreadyImage.push({ productId: p.id, productName: p.name });
      continue;
    }

    const { marca, recipe } = brandInfo(p.name);
    const prodTokens = injectSpecies(canonicalize(recipe), marca ?? "");

    if (!marca || !byMarca.has(marca)) {
      unmatched.push({ productId: p.id, productName: p.name });
      continue;
    }

    const best = bestMatch(prodTokens, byMarca.get(marca)!);
    if (!best) {
      unmatched.push({ productId: p.id, productName: p.name });
    } else {
      matched.push({
        productId: p.id,
        productName: p.name,
        catalogMarca: best.item.marca,
        catalogNombre: best.item.nombre,
        imageUrl: best.item.imageUrl,
        score: best.score,
      });
    }
  }

  const report: Report = {
    generatedAt: new Date().toISOString(),
    totalProducts: products.length,
    matched,
    unmatched,
    alreadyImage,
  };

  const outputPath = path.join(DATA_DIR, "mapping-report.json");
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`💾 Reporte escrito: ${outputPath}`);
  console.log();

  // Resumen
  console.log("═".repeat(60));
  console.log("RESUMEN");
  console.log("═".repeat(60));
  console.log(`Total: ${report.totalProducts}`);
  console.log(`Matcheados: ${matched.length} (${report.totalProducts ? Math.round((matched.length / report.totalProducts) * 100) : 0}%)`);
  console.log(`Sin-match: ${unmatched.length}`);
  console.log();

  const byMarcaMatched = new Map<string, MatchResult[]>();
  for (const m of matched) {
    const arr = byMarcaMatched.get(m.catalogMarca) ?? [];
    arr.push(m);
    byMarcaMatched.set(m.catalogMarca, arr);
  }
  console.log("📦 Por marca (matcheados):");
  for (const [marca, arr] of [...byMarcaMatched.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`   ${marca}: ${arr.length}`);
    for (const m of arr.slice(0, 2)) {
      console.log(`      ✔ (${m.score.toFixed(2)}) ${m.productName} → ${m.catalogNombre}`);
    }
    if (arr.length > 2) console.log(`      … y ${arr.length - 2} más`);
  }
  if (byMarcaMatched.size === 0) console.log("   (ninguno)");

  console.log();
  console.log("🚫 SIN MATCH (filas completas):");
  if (unmatched.length === 0) {
    console.log("   (ninguno)");
  } else {
    for (const u of unmatched) {
      console.log(`   · ${u.productName}`);
    }
  }

  console.log();
  console.log("⚠️  Notas:");
  console.log(`   · Prefijos SIN catálogo de imágenes (siempre sin-match): ${knownNoCatalog.join(", ") || "(none)"}`);
  console.log(`   · Marcas presentes en el catálogo: ${[...availableBrands].sort().join(", ")}`);
  if (apply) {
    console.log("   · `--apply`: no-op preparado. Aún NO se escribe en la BD (requiere implementación).");
  }

  await db.$disconnect();
  console.log();
  console.log("🔒 DRY-RUN completo. No se modificó la BD.");
}

if (require.main === module) {
  main().catch((e) => {
    console.error("❌ Error fatal:", e);
    process.exit(1);
  });
}

export { normalize, brandInfo, canonicalize, injectSpecies, scoreTokens, precomputeCatalog, bestMatch, THRESHOLD };

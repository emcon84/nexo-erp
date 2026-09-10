/**
 * Alican provider price-list parser and normalization (sdd/alican-wholesale-price-list).
 *
 * Pure functions: NO Prisma imports in this module (WU1 constraint). The
 * catalog-matching and persistence layers (WU3/WU4) live in the same file
 * below this pure section, matching the codebase pattern of exporting pure
 * helpers from a service/controller module (see productController.ts).
 *
 * The real pdf-parse output (v2.4.5) produces ONE LINE per product row:
 *   SECO: "SIEGER Puppy Mini x 1 Kg. $ 8.795 $ 10.642 $ 14.190"
 *   WET : "Sieger Puppy Salmon y Pollo WET x 100 gr. SIEGER 12 pouches x 100 gr $ 2.125,4 $ 2.571,7 $ 3.429,1"
 * Hierarchy lines (brand / LÍNEA / subline) and header/footer noise are on
 * their own lines. See api/tests/fixtures/pdfs/README.md for the fixture origin.
 */

import { round2 } from "../utils/money";

// ── Types ──────────────────────────────────────────────────────────────────

// Layout types: existing Alican + new multi-brand providers
export type Layout = "SECO" | "WET";
export type ProviderLayout = Layout | "eukanuba" | "royal-canin" | "page7-multi";

export interface ParsedRow {
  nombre: string;
  marca: string | null;
  linea: string | null;
  sublinea: string | null;
  // New optional fields for multi-brand providers
  gama?: string | null;
  tipo?: string | null;
  codigo?: string | null;
  unidadEmpaque: string | null;
  precioSinIva: number | null;
  precioConIva: number | null;
}

export interface ParsedPriceList {
  period: string | null;
  rows: ParsedRow[];
}

export class LayoutNotSupportedError extends Error {
  constructor(message = "Formato de planilla no reconocido") {
    super(message);
    this.name = "LayoutNotSupportedError";
  }
}

// ── Shared helpers ─────────────────────────────────────────────────────────

/** Known Alican brands in the SECO hierarchy (from the real 08/2026 PDF). */
const BRANDS_ALICAN = new Set([
  "SIEGER",
  "SIEGER KATZE",
  "SIEGERVET",
  "MAXXIUM PERROS",
  "MAXXIUM CATS",
  "BENTONITA HOMEBRAND",
  "AGILITY",
  "7 VIDAS",
  "GOOSTER",
  "SULTAN",
]);

/**
 * Layout fingerprint (structural signals, never silent): the header + the
 * WET-only "UNIDAD DE EMPAQUE" column, or SECO price columns + hierarchy lines.
 * NOTE (deviation from design §3.2): the real PDF text does NOT contain the
 * word "SECO" and the column headers are split across lines ("PRECIOS SIN" /
 * "IVA"), so the fingerprint relies on the signals that actually appear.
 */
export function detectLayout(text: string): Layout {
  const hasHeader = /LISTA DE PRECIOS ALICAN/i.test(text);
  if (!hasHeader) throw new LayoutNotSupportedError();
  if (/UNIDAD DE EMPAQUE/i.test(text)) return "WET";
  if (/PRECIOS\s+SIN\s+IVA/i.test(text) && /LÍNEA\s+/i.test(text)) return "SECO";
  throw new LayoutNotSupportedError();
}

/** VIGENCIA dd/mm/aaaa → ISO "YYYY-MM-DD"; null when absent or unparseable.
 * Also supports "dd de Mes yyyy" format (e.g., "07 de Septiembre 2026").
 * Handles "VIGENCIA: " with colon. */
export function capturePeriod(text: string): string | null {
  // Try dd/mm/yyyy first (handles "VIGENCIA:" with or without colon)
  let m = /VIGENCIA\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(text);
  if (m) {
    const [, dd, mm, yyyy] = m;
    return `${yyyy}-${mm}-${dd}`;
  }
  // Try "dd de Mes yyyy" (Spanish month names)
  const monthMap: Record<string, string> = {
    enero: "01", febrero: "02", marzo: "03", abril: "04",
    mayo: "05", junio: "06", julio: "07", agosto: "08",
    septiembre: "09", octubre: "10", noviembre: "11", diciembre: "12",
  };
  m = /VIGENCIA\s*:?\s*(\d{1,2})\s+de\s+([a-záéíóú]+)\s+(\d{4})/i.exec(text);
  if (m) {
    const [, dd, mes, yyyy] = m;
    const mm = monthMap[mes.toLowerCase()];
    if (mm) return `${yyyy}-${mm}-${dd.padStart(2, "0")}`;
  }
  return null;
}

/**
 * AR price normalization (spec REQ-3). Own algorithm — the existing
 * parsePrice() in scripts/load-distributor-pdfs.ts is buggy for integer
 * thousands ("8.795" → 8.795 instead of 8795) and must NOT be reused.
 * Now handles formats like "$ 7 .600,11" (spaces around thousands separator).
 */
export function normalizePrice(raw: string): number | null {
  // Remove $, spaces, non-breaking spaces — but keep dots and commas for now
  const s = String(raw).trim().replace(/\$/g, "").replace(/[\s\u00A0]/g, "");
  if (!/^[0-9.,]+$/.test(s)) return null;
  // Duplicated/inconsistent adjacent separators ("1..2", "1,.5") → null.
  if (/[.,][.,]/.test(s)) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let normalized = s;
  if (lastComma > -1 && lastDot > -1) {
    // Both separators → the LAST one is the decimal separator, the other thousands.
    normalized = lastComma > lastDot
      ? s.replace(/\./g, "").replace(",", ".")
      : s.replace(/,/g, "");
  } else if (lastComma > -1) {
    // Single comma → decimal if 1-2 digits follow, thousands otherwise.
    normalized = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  } else if (lastDot > -1) {
    // Single dot → decimal if 1-2 digits follow, thousands otherwise.
    normalized = /\.\d{1,2}$/.test(s) ? s : s.replace(/\./g, "");
  }
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

/**
 * Name normalization for EXACT post-normalization matching (spec REQ-4).
 * "SIEGER Puppy Mini x 1 Kg." ≡ "sieger puppy mini 1kg". Pack-format words
 * ("bolsa", "sobre", "lata", ...) and a standalone pack "x" before a quantity
 * are dropped so the same product with a different pack wording still matches
 * ("SIEGER Ultra Vita Plus - bolsa x 1,5 Kg." ≡ "SIEGER ULTRA VITA PLUS 1.5 KG").
 */
export function normalizeName(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // diacritics
    .toLowerCase()
    .replace(/[×✕]/g, "x") // only the multiplication sign → "x"
    .replace(/(\d)[,.](\d)/g, "$1.$2") // comma-decimal quantities: "1,5" → "1.5"
    .replace(/\b(kilos?|kgs?|kilogramos?)\b/g, "kg")
    .replace(/\b(grs?|gramos?)\b/g, "g")
    .replace(/(\d)(grs?|gramos?)\b/g, "$1g") // pegada al dígito: "100gr" → "100g"
    .replace(/\b(litros?|lts?)\b/g, "l")
    .replace(/\b(unidades?|unids?)\b/g, "un")
    .replace(/(\d)\s+(kg|g|l|ml|un)\b/g, "$1$2") // "1 kg" → "1kg"
    .replace(/\b(?:bolsas?|sobres?|latas?|envases?|paquetes?|sachets?|tarros?|bidones?|presentaciones?)\b\s*x?(?!\w)\s*/g, " ") // pack words: "bolsa x 1,5" → "1.5"
    .replace(/\bx\s+(?=\d)/g, "") // standalone pack "x" before a quantity: "x 1.5" → "1.5"
    .replace(/[()[\]{}]/g, " ") // parentheses → space
    .replace(/[—-]/g, " ") // hyphens/dashes → space
    .replace(/\.(?=\s|$)/g, "") // residual dot before space/end: "340g. eo" → "340g eo"
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "") // trailing dots
    // "EO" (envase original) duplicado en la planilla WET: "WET EO x 340 gr. EO"
    // → deja UNA sola ocurrencia, igual que el catálogo ("WET EO 340 GR").
    // Elimina SOLO el último "eo" cuando hay 2+; un único "eo" intacto.
    // (puede dejar un espacio residual al final del string → trim final)
    .replace(/^(.*\beo\b.*)\beo\b$/, "$1")
    .trim();
}

/** Best-effort pack expression at the end of a product name ("x 1 Kg." → "1 Kg."). */
export function extractUnit(name: string): string | null {
  const m = /x\s+([\d.,]+\s*(?:kg|kgs?|g|gr|grs?|kilo|kilos?|l|lt|lts?|ml|un|unid|unids?|sobre|sobres|bolsa|bolsas|latas?)[\w\s.]*)$/i.exec(
    name.trim(),
  );
  return m ? m[1].trim() : null;
}

/**
 * Header/footer/page-marker lines that carry no product data. Note: a "-"
 * price placeholder is NOT noise here — it is consumed as a null price so
 * rows priced with dashes become error rows instead of misaligning prices.
 */
export function isNoiseLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (/^[|•·]/.test(t)) return true;
  if (/^(HOJA|VIGENCIA|PÁGINA|PAGINA)\b/i.test(t)) return true;
  if (/^--\s*\d+\s+of\s+\d+\s*--$/.test(t)) return true;
  if (/LA RED COMERCIAL/i.test(t)) return true;
  if (/LISTA DE PRECIOS/i.test(t)) return true;
  if (/MODALIDAD DE VENTA/i.test(t)) return true;
  if (/%/.test(t)) return true;
  if (/^PRECIOS\b/i.test(t)) return true;
  if (/^(SIN IVA|CON IVA)$/i.test(t)) return true;
  if (/^SUGERIDO/i.test(t) || /^PÚBLICO/i.test(t) || /^PUBLICO/i.test(t)) return true;
  if (/^(IVA|EMPAQUE|UNIDAD DE)\s*$/i.test(t)) return true;
  if (/^DESCRIPCIÓN|^DESCRIPCION/i.test(t)) return true;
  if (/^LÍNEA DE ALIMENTOS/i.test(t)) return true;
  return false;
}

function cleanLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !isNoiseLine(l));
}

// ============================================================================
// MULTI-BRAND PROVIDER PARSER (generic column-based)
// ============================================================================

/** Provider configuration for column-based parsing. */
export interface ProviderConfig {
  provider: string;
  layout: "hierarchical-3lvl" | "hierarchical-2lvl" | "flat-multi";
  /** Header synonyms: internal field -> possible header texts in PDF. */
  headerSynonyms: Record<string, string[]>;
  /** Hierarchy inference rules. */
  hierarchyRules: {
    type: "hierarchical-3lvl" | "hierarchical-2lvl" | "flat-multi";
    impliedBrand?: string;           // for Eukanuba (brand not in rows)
    marcaColumn?: string;            // for Page7 (marca in each row)
    level1Source?: "gama-column" | "implied-brand" | "allcaps-line";
    level2Source?: "tipo-column" | "allcaps-sublinea" | "allcaps-line";
    level3Source?: "allcaps-sublinea";
  };
  /** How to infer brand for each row. */
  brandInference: "implied" | "gama-tipo" | "marca-column";
}

/** Detected layout info for dispatching to correct parser. */
export interface DetectedLayout {
  provider: "eukanuba" | "royal-canin" | "page7-multi" | "alican" | "unknown";
  layout: "hierarchical-3lvl" | "hierarchical-2lvl" | "flat-multi" | "seco" | "wet";
  sections: Array<{
    startLine: number;
    endLine: number;
    vigencia: string | null;
    headerLine: number;
    columnMap: Record<string, number>; // internal field -> column index
  }>;
}

/** Known provider configs. */
const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  "eukanuba": {
    provider: "eukanuba",
    layout: "hierarchical-3lvl",
    headerSynonyms: {
      codigo: ["CÓD.", "CÓDIGO", "CODIGO"],
      descripcion: ["DESCRIPCIÓN", "DESCRIPCION"],
      kg: ["KG x U.", "KG X U.", "KG"],
      precioSinIva: ["PRECIO UNITARIO (SIN IVA)", "PRECIO UNITARIO SIN IVA"],
      precioConIva: ["PRECIO SUGERIDO PUBLICO (CON IVA)", "PRECIO SUGERIDO (CON IVA)", "PRECIO SUGERIDO PUBLICO CON IVA"],
    },
    hierarchyRules: {
      type: "hierarchical-3lvl",
      impliedBrand: "EUKANUBA",
      level1Source: "implied-brand",
      level2Source: "allcaps-line",
      level3Source: "allcaps-sublinea",
    },
    brandInference: "implied",
  },
  "royal-canin": {
    provider: "royal-canin",
    layout: "hierarchical-2lvl",
    headerSynonyms: {
      gama: ["GAMA"],
      tipo: ["TIPO"],
      codigo: ["CÓDIGO", "CODIGO"],
      descripcion: ["Descripcion", "DESCRIPCIÓN", "DESCRIPCION"],
      kg: ["KG/GR", "KG / GR"],
      precioSinIva: ["PRECIO UNITARIO (SIN IVA)", "PRECIO UNITARIO SIN IVA"],
      precioConIva: ["PRECIO SUGERIDO AL PÚBLICO (con IVA)", "PRECIO SUGERIDO AL PUBLICO (CON IVA)", "PRECIO SUGERIDO AL PUBLICO CON IVA"],
    },
    hierarchyRules: {
      type: "hierarchical-2lvl",
      level1Source: "gama-column",
      level2Source: "tipo-column",
    },
    brandInference: "gama-tipo",
  },
  "page7-multi": {
    provider: "page7-multi",
    layout: "flat-multi",
    headerSynonyms: {
      codigo: ["CODIGO", "CÓDIGO"],
      marca: ["MARCA"],
      descripcion: ["DESCRIPCION", "DESCRIPCIÓN"],
      precioSinIva: ["PRECIO UNITARIO (SIN IVA)", "PRECIO UNITARIO SIN IVA"],
      precioConIva: ["PRECIO SUGERIDO AL PUBLICO (CON IVA)", "PRECIO SUGERIDO AL PUBLICO CON IVA"],
    },
    hierarchyRules: {
      type: "flat-multi",
      marcaColumn: "marca",
    },
    brandInference: "marca-column",
  },
};

/** Normalize header text for matching (remove accents, case, punctuation). */
function normalizeHeader(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/[—-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Find column index by trying synonyms against normalized headers. */
function findColumnIndex(headers: string[], synonyms: string[]): number {
  const normHeaders = headers.map(normalizeHeader);
  const normSynonyms = synonyms.map(normalizeHeader);
  for (const syn of normSynonyms) {
    const idx = normHeaders.indexOf(syn);
    if (idx >= 0) return idx;
    // Try partial match (header contains synonym or vice versa)
    for (let i = 0; i < normHeaders.length; i++) {
      if (normHeaders[i].includes(syn) || syn.includes(normHeaders[i])) return i;
    }
  }
  return -1;
}

/** Reconstruct multi-line headers (e.g., "PRECIO UNITARIO" + "(SIN IVA)" on next line). */
function reconstructHeaders(lines: string[], startIdx: number): { headers: string[]; nextIdx: number } {
  const headerLines: string[] = [];
  let idx = startIdx;
  // Collect consecutive lines that look like headers (no prices, short-ish)
  while (idx < lines.length) {
    const line = lines[idx].trim();
    if (!line) { idx++; continue; }
    // Stop if line looks like a data row (has numbers + $ or code pattern)
    if (/^\d{5,}/.test(line) || /\$\s*[\d.,]/.test(line)) break;
    // Stop if it's a known noise/header marker
    if (/^(VIGENCIA|LISTA DE PRECIOS|MODALIDAD|GAMA|TIPO)\b/i.test(line)) break;
    headerLines.push(line);
    idx++;
    // Heuristic: usually 1-3 lines for headers
    if (headerLines.length >= 3) break;
  }
  // Join multi-line headers and split by multiple spaces (column separator)
  const joined = headerLines.join(" ");
  // Split by 2+ spaces (typical column separator in pdf-parse output)
  const headers = joined.split(/\s{2,}/).map(h => h.trim()).filter(h => h.length > 0);
  return { headers, nextIdx: idx };
}

/** Detect provider and layout from full PDF text. */
export function detectProviderLayout(text: string): DetectedLayout {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

  // First check for Alican (existing logic)
  if (/LISTA DE PRECIOS ALICAN/i.test(text)) {
    const isWet = /UNIDAD DE EMPAQUE/i.test(text);
    return {
      provider: "alican",
      layout: isWet ? "wet" : "seco",
      sections: [{ startLine: 0, endLine: lines.length, vigencia: capturePeriod(text), headerLine: -1, columnMap: {} }],
    };
  }

  // Detect Eukanuba: page 1 has "EUKANUBA" brand lines + "PRECIO UNITARIO (SIN IVA)" + "KG x U."
  if (/EUKANUBA/i.test(text) && /PRECIO UNITARIO\s*\(?\s*SIN\s+IVA\)?/i.test(text) && /KG\s*x\s*U\./i.test(text)) {
    return detectEukanubaSections(lines, text);
  }

  // Detect Royal Canin: has "GAMA" + "TIPO" columns + "PRECIO UNITARIO (SIN IVA)"
  if (/GAMA\s*TIPO/i.test(text) || (/GAMA/i.test(text) && /TIPO/i.test(text) && /PRECIO UNITARIO\s*\(?\s*SIN\s+IVA\)?/i.test(text))) {
    return detectRoyalCaninSections(lines, text);
  }

  // Detect Page 7 multi-brand: multiple small sections with MARCA column
  if (/MARCA\s+DESCRIPCION/i.test(text) && /PRECIO UNITARIO\s*\(?\s*SIN\s+IVA\)?/i.test(text)) {
    return detectPage7Sections(lines, text);
  }

  // Unknown
  throw new LayoutNotSupportedError("Formato de planilla no reconocido (proveedor no soportado)");
}

/** Detect Eukanuba sections (page 1). */
function detectEukanubaSections(lines: string[], fullText: string): DetectedLayout {
  const sections: DetectedLayout["sections"] = [];
  const config = PROVIDER_CONFIGS["eukanuba"];
  let currentStart = 0;
  let currentVigencia: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Capture vigencia
    const vig = capturePeriod(line);
    if (vig) currentVigencia = vig;

    // Look for header line with our key columns
    if (/PRECIO UNITARIO\s*\(?\s*SIN\s+IVA\)?/i.test(line) && /KG\s*x\s*U\./i.test(line)) {
      const { headers, nextIdx } = reconstructHeaders(lines, i);
      const columnMap: Record<string, number> = {};
      for (const [field, synonyms] of Object.entries(config.headerSynonyms)) {
        columnMap[field] = findColumnIndex(headers, synonyms);
      }
      sections.push({
        startLine: currentStart,
        endLine: lines.length,
        vigencia: currentVigencia,
        headerLine: i,
        columnMap,
      });
      currentStart = nextIdx;
    }
  }

  if (sections.length === 0) {
    // Fallback: single section for whole page
    sections.push({
      startLine: 0,
      endLine: lines.length,
      vigencia: capturePeriod(fullText),
      headerLine: -1,
      columnMap: {},
    });
  }

  return { provider: "eukanuba", layout: "hierarchical-3lvl", sections };
}

/** Detect Royal Canin sections (pages 2-6). */
function detectRoyalCaninSections(lines: string[], fullText: string): DetectedLayout {
  const sections: DetectedLayout["sections"] = [];
  const config = PROVIDER_CONFIGS["royal-canin"];
  let currentStart = 0;
  let currentVigencia: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const vig = capturePeriod(line);
    if (vig) currentVigencia = vig;

    // Look for header with GAMA + TIPO + PRECIO UNITARIO
    if (/GAMA/i.test(line) && /TIPO/i.test(line) && /PRECIO UNITARIO\s*\(?\s*SIN\s+IVA\)?/i.test(line)) {
      const { headers, nextIdx } = reconstructHeaders(lines, i);
      const columnMap: Record<string, number> = {};
      for (const [field, synonyms] of Object.entries(config.headerSynonyms)) {
        columnMap[field] = findColumnIndex(headers, synonyms);
      }
      sections.push({
        startLine: currentStart,
        endLine: lines.length,
        vigencia: currentVigencia,
        headerLine: i,
        columnMap,
      });
      currentStart = nextIdx;
    }
  }

  if (sections.length === 0) {
    sections.push({
      startLine: 0,
      endLine: lines.length,
      vigencia: capturePeriod(fullText),
      headerLine: -1,
      columnMap: {},
    });
  }

  return { provider: "royal-canin", layout: "hierarchical-2lvl", sections };
}

/** Detect Page 7 multi-brand sections. */
function detectPage7Sections(lines: string[], fullText: string): DetectedLayout {
  const sections: DetectedLayout["sections"] = [];
  const config = PROVIDER_CONFIGS["page7-multi"];
  let currentStart = 0;
  let currentVigencia: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const vig = capturePeriod(line);
    if (vig) currentVigencia = vig;

    // Look for header with MARCA + DESCRIPCION + PRECIO UNITARIO
    if (/MARCA/i.test(line) && /DESCRIPCION/i.test(line) && /PRECIO UNITARIO\s*\(?\s*SIN\s+IVA\)?/i.test(line)) {
      const { headers, nextIdx } = reconstructHeaders(lines, i);
      const columnMap: Record<string, number> = {};
      for (const [field, synonyms] of Object.entries(config.headerSynonyms)) {
        columnMap[field] = findColumnIndex(headers, synonyms);
      }
      sections.push({
        startLine: currentStart,
        endLine: nextIdx,
        vigencia: currentVigencia,
        headerLine: i,
        columnMap,
      });
      currentStart = nextIdx;
    }
  }

  if (sections.length === 0) {
    sections.push({
      startLine: 0,
      endLine: lines.length,
      vigencia: capturePeriod(fullText),
      headerLine: -1,
      columnMap: {},
    });
  }

  return { provider: "page7-multi", layout: "flat-multi", sections };
}

/** Detect if a line is a table header (not a data row). */
function isHeaderLine(line: string): boolean {
  const t = line.trim();
  if (/^(TALLA|GAMA|TIPO)\s/i.test(t)) return true;
  if (/CÓD\.?\s+DESCRIPCIÓN/i.test(t)) return true;
  if (/Descripcion\s+Producto/i.test(t)) return true;
  if (/^\(?(SIN IVA|CON IVA)\)?$/i.test(t)) return true;
  if (/^PRECIO\b/i.test(t)) return true;
  if (/^(PUBLICO|PÚBLICO|AL\s+PÚBLICO)/i.test(t)) return true;
  if (/^KG\s*x\s*U\./i.test(t)) return true;
  if (/^KG\/GR/i.test(t)) return true;
  return false;
}

/** Extract prices from a data row (tab-separated: <sinIva>\t$ <conIva>\t$). */
function extractPrices(line: string): { sinIva: number | null; conIva: number | null } | null {
  const priceMatch = /([\d.,]+)\t\$\s*([\d.,]+)\t\$\s*$/.exec(line);
  if (!priceMatch) return null;
  return {
    sinIva: normalizePrice(priceMatch[1]),
    conIva: normalizePrice(priceMatch[2]),
  };
}

/** Normalize weight to the format used in the DB catalog: "1,0" → "1.0". */
function normalizeWeight(raw: string): string {
  // "1,0" → "1.0" ; "7,5" → "7.5"
  return raw.replace(",", ".").replace(/\.0+$/, (m) => m);
}

/** Check if a product name already carries its pack weight (e.g. "... 1KG", "... X 1.5 KG"). */
function nameHasWeight(nombre: string): boolean {
  return /\b\d+([.,]\d+)?\s*(kg|kgs?|g|grs?|gr|kilo|kilos?)\b/i.test(nombre) ||
    /\bx\s*\d+([.,]\d+)?\s*(kg|kgs?|g|grs?|gr|kilo|kilos?)\b/i.test(nombre);
}

/** Códigos de línea de Royal Canin que suelen aparecer pegados tras el SKU
 * (ej. "CW34H FCN HAIRBALL..." → "HAIRBALL..."). */
const ROYAL_CANIN_LINE_CODES = /^(?:FCN|FHN|FBN|CCN|CHN|CBN|VHN)\s+/i;

/** Limpieza de estructura del nombre parseado: quita el código de línea de
 * Royal Canin que sigue al SKU, separa palabras compuestas pegadas del
 * proveedor ("GATOADULTO" → "GATO ADULTO") y colapsa espacios. El case lo
 * normaliza después `normalizeProductName` (siempre mayúsculas). */
function cleanParseName(name: string): string {
  return name
    .replace(ROYAL_CANIN_LINE_CODES, "")
    .replace(/\bGATOADULTO\b/g, "GATO ADULTO")
    .replace(/\bGATOCACHORRO\b/g, "GATO CACHORRO")
    .replace(/\bPERROADULTO\b/g, "PERRO ADULTO")
    .replace(/\bPERROCACHORRO\b/g, "PERRO CACHORRO")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse a data row: code + description + kg + prices (regex-based, robust). */
function parseDataRow(
  line: string,
): { codigo: string | null; nombre: string; kg: string | null; marca: string | null; gama: string | null; tipo: string | null; precioSinIva: number | null; precioConIva: number | null } | null {
  const prices = extractPrices(line);
  if (!prices) return null;

  // Get text before the first price
  const priceMatch = /([\d.,]+)\t\$\s*([\d.,]+)\t\$\s*$/.exec(line);
  const beforePrice = line.slice(0, priceMatch!.index).trim();
  // La etiqueta de sección (HÚMEDO/SECO/WET) a veces encabeza la fila y no es
  // parte del producto → se quita antes de detectar el código, así el SKU que
  // viene después ("3390102") se corta y no queda pegado al nombre.
  const nameText = beforePrice.replace(/^(?:HÚMEDO|HUMEDO|SECO|WET)\s+/i, "");

  // Extract code: SKU alfanumérico de Royal Canin pegado al inicio (CW34H,
  // DA68F, DF10W...) o run de 5-8 dígitos puros al inicio del nombre. El
  // alfanumérico antes se escapaba y quedaba pegado al nombre del producto
  // (bug de nombres raros). El fallback se ancla al inicio para NO matchear el
  // precio como código cuando la fila no tiene SKU (ej. Eukanuba).
  const alphaSku = /^([A-Z]{2}\d{2,3}[A-Z]?)\b/.exec(nameText);
  const codeMatch = alphaSku ?? /^(\d{5,8})\b/.exec(nameText);
  const codigo = codeMatch ? codeMatch[1] : null;

  // Separate prefix (gama/hierarchy before code) from description+kg (after code)
  let prefix: string | null = null;
  let remaining = nameText;
  if (codeMatch) {
    const codeEnd = codeMatch.index + codeMatch[0].length;
    prefix = nameText.slice(0, codeMatch.index).trim() || null;
    remaining = nameText.slice(codeEnd).trim();
  }

  // Limpieza del nombre: quitar código de línea RC y palabras compuestas.
  remaining = cleanParseName(remaining);

  // Remove kg (last number) to get description
  const kgMatch = /([\d.,]+)$/.exec(remaining);
  const kg = kgMatch ? kgMatch[1] : null;
  let nombre = kgMatch ? remaining.slice(0, kgMatch.index).trim() : remaining;

  // Rebuild name with pack weight when it doesn't already carry it (e.g. gatos
  // where the kg is in a separate column). This prevents same-name duplicates
  // (KITTEN 1.0 / 3.0 / 7.5) from being flagged as "duplicado".
  if (kg && nombre && !nameHasWeight(nombre)) {
    const w = normalizeWeight(kg);
    nombre = `${nombre} X ${w} KG`;
  }

  return {
    codigo,
    nombre,
    kg,
    marca: null,
    gama: prefix,
    tipo: null,
    precioSinIva: prices.sinIva,
    precioConIva: prices.conIva,
  };
}

/** Infer the product line (etapa/gama) from its name, as the PRIMARY source of
 * the line (not a fallback) — robust against hierarchy-state leakage between
 * sections (Eukanuba page 1 then Royal Canin pages 2-7).
 *
 * Eukanuba: PUPPY / ADULT / SENIOR / FIT BODY / LAMB / KITTEN / GATO.
 * Royal Canin: FELINE / CANINE / SIZE (mini/medium/maxi/giant/x-small) /
 * VETERINARY (feline/canine). */
/** Marcas adicionales que trae la planilla (no Eukanuba/Royal Canin): piedras
 * sanitarias y accesorios que antes quedaban colgados de "ROYAL CANIN". */
const EXTRA_BRAND_REGEX = /\b(MONKCAT|WIPUP|ASADITOS)\b/i;

/** Devuelve la marca extra conocida si el nombre la contiene, sino null. */
function knownExtraBrand(nombre: string): string | null {
  const m = EXTRA_BRAND_REGEX.exec(nombre);
  return m ? m[1].toUpperCase() : null;
}

function inferLineaFromName(nombre: string): string | null {
  const upper = nombre.toUpperCase();

  // Royal Canin / otros proveedores (no Eukanuba)
  if (!/EUKANUBA/i.test(nombre)) {
    // MEDICADOS (VETERINARY HEALTH NUTRITION): keywords terapéuticos con
    // prioridad sobre FELINE/CANINE/SIZE. Son los productos "medicados" que
    // llevan una ganancia distinta (HYPOALLERGENIC, RENAL, GASTRO, URINARY, etc.)
    if (/HYPOALLERGENIC|ANALLERGENIC|GASTRO|HEPATIC|RENAL|DERMATO|URINARY|DIABETIC|MOBILITY|CARDIAC|CALM FELINE|CALM CANINE|SATIETY|RECOVERY|FIBRE|NEUTERED|MATURE|ALLERGENIC|WEIGHT CONTROL|VETERINARY/i.test(upper)) {
      return /CANINE/i.test(upper) ? "VETERINARY CANINE" : "VETERINARY FELINE";
    }
    // VETERINARY explícito
    if (/VETERINARY/i.test(upper)) return /CANINE/i.test(upper) ? "VETERINARY CANINE" : "VETERINARY FELINE";
    // Tamaño (SIZE) antes que gama, para "SIZE HEALTH NUTRITION" (mini/medio/maxi/giant)
    if (/\bMINI\b/i.test(upper)) return "SIZE MINI";
    if (/\bMEDIUM\b/i.test(upper)) return "SIZE MEDIUM";
    if (/\bMAXI\b/i.test(upper)) return "SIZE MAXI";
    if (/\bGIANT\b/i.test(upper)) return "SIZE GIANT";
    if (/X-SMALL/i.test(upper)) return "SIZE X-SMALL";
    // Palabras clave de gato (FELINE) — Babycat, Kitten, Indoor, Instinctive,
    // Sensory, Pouch, Lata, etc. son líneas Feline del Royal Canin.
    if (/FELINE/i.test(upper)) return "FELINE";
    if (/CANINE/i.test(upper)) return "CANINE";
    // Palabras clave de gato (FELINE) — líneas Feline del Royal Canin.
    if (/\b(BABYCAT|KITTEN|INSTINCTIVE|SENSORY|INDOOR|EXIGENT|SENSIBLE|PERSIAN|SIAMESE|LIGHT WEIGHT|DIGEST|APPETITE|HAIR|WEIGHT CARE|URINARY SO|SATIETY|RECOVERY|RENAL|HEPATIC|MOBILITY|CARDIAC|CALM|DIABETIC|ALLERGENIC|ANALLERGENIC|HYPOALLERGENIC|GASTRO|FIBRE|STARTER|MOTHER|FIT\b|ACTIVE|GC\b|MATURE CONSULT|NEUTERED BALANCE|HAIRBALL|URINARY CARE)\b/i.test(upper)) return "FELINE";
    // Palabras clave de perro (CANINE) — líneas Canine (razas, tamaño).
    if (/\b(PUPPY|ADULT|SENIOR|AGEING|CLUB|PROTECH|STARTER|DERMACOMFORT|CANINE|POODLE|YORKSHIRE|DACHSHUND|CHIHUAHUA|BULLDOG|JACK|OV|LABRADOR|BOXER|GOLDEN|CANICHE|SCHNAUZER|PUG|X-SMALL|X- SMALL|SIZE|MEDIUM|MAXI|GIANT)\b/i.test(upper)) return "CANINE";
    // Sin línea reconocible → null (producto de otra marca/categoría; NO se
    // fuerza "ROYAL CANIN" para no colgar limpiadores/piedra sanitaria de RC).
    return null;
  }

  // Eukanuba: etapa del nombre
  const m = upper.match(/\b(PUPPY|ADULT|ADULTO|SENIOR|FIT BODY|PREMIUM PERFORMANCE|LAMB|KITTEN|GATOADULTO)\b/);
  return m ? m[1] : "EUKANUBA";
}

/** Main entry: parse any supported provider's price list. */
export function parsePriceList(text: string, detected?: DetectedLayout): ParsedPriceList {
  const layoutInfo = detected ?? detectProviderLayout(text);

  if (layoutInfo.provider === "alican") {
    // Use existing Alican parsers
    if (layoutInfo.layout === "wet") return parseAlicanWet(text);
    return parseAlicanSeco(text);
  }

  const config = PROVIDER_CONFIGS[layoutInfo.provider];
  if (!config) throw new LayoutNotSupportedError(`Proveedor no soportado: ${layoutInfo.provider}`);

  const rawLines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const rows: ParsedRow[] = [];

  // Hierarchy state
  let currentMarca: string | null = config.hierarchyRules.impliedBrand ?? null;
  let currentGama: string | null = null;
  let currentTipo: string | null = null;
  let currentLinea: string | null = null;
  let currentSublinea: string | null = null;
  // Último nombre de producto no vacío (para heredar en filas de continuación,
  // patrón Royal Canin: "2544004 Mother & Babycat 0,4 ..." luego "2544015 1,5 ...").
  let lastNombre: string | null = null;

  for (const line of rawLines) {
    // Skip headers / noise
    if (isHeaderLine(line) || isNoiseLine(line)) continue;

    // Try to parse as data row (has prices)
    const parsed = parseDataRow(line);
    if (parsed) {
      // Si el nombre viene vacío (fila de continuación), heredar el del producto
      // base y reconstruir con el peso de esta fila. OJO: lastNombre YA trae el
      // peso de la fila anterior ("Medium Weight Care X 3 KG"); se hereda SOLO la
      // descripción base para no componer "X 3 KG X 10 KG".
      let nombre = parsed.nombre;
      if (!nombre && lastNombre && parsed.kg) {
        const base = lastNombre.replace(/\s*X\s*[\d.,]+\s*(?:kg|kgs?)\s*$/i, "");
        nombre = `${base} X ${normalizeWeight(parsed.kg)} KG`;
      }
      if (!nombre) continue; // sin nombre y sin herencia → no es fila utilizable
      if (nombre) lastNombre = nombre;

      // Inferir marca y línea RELES del nombre (el PDF mezcla Eukanuba, Royal
      // Canin y otras marcas: MONKCAT/WIPUP/ASADITOS...). Antes TODO lo que no
      // traía EUKANUBA se forzaba a "ROYAL CANIN" y productos de otras marcas
      // (limpieza, piedra sanitaria) quedaban colgados de ahí.
      const lineaInferida =
        inferLineaFromName(nombre) ??
        (currentLinea && !/^(ROYAL CANIN|EUKANUBA)$/i.test(currentLinea)
          ? currentLinea
          : null);
      // Es Royal Canin solo si la línea es una línea RC reconocida (FELINE,
      // CANINE, SIZE..., no el fallback). La marca EUKANUBA/marca extra va
      // primero por nombre.
      const esLineaRC =
        lineaInferida !== null && lineaInferida !== "ROYAL CANIN";
      const marcaInferida = /EUKANUBA/i.test(nombre)
        ? "EUKANUBA"
        : knownExtraBrand(nombre) || (esLineaRC ? "ROYAL CANIN" : null);

      rows.push({
        nombre,
        marca: parsed.marca ?? marcaInferida,
        linea: lineaInferida,
        sublinea: currentSublinea,
        gama: parsed.gama ?? currentGama,
        tipo: parsed.tipo ?? currentTipo,
        codigo: parsed.codigo,
        unidadEmpaque: extractUnit(nombre),
        precioSinIva: parsed.precioSinIva,
        precioConIva: parsed.precioConIva,
      });
      continue;
    }

    // Otherwise, treat as hierarchy / section marker (no prices, no code)
    if (line && !/^\d{5,}/.test(line)) {
      const upper = line.toUpperCase();
      // GAMAs del Royal Canin (FELINE/CANINE/SIZE/VETERINARY) → línea
      if (/(FELINE|CANINE|VETERINARY|SIZE HEALTH|HEALTH NUTRITION)/i.test(line) && !/^\d/.test(line)) {
        currentLinea = line;
        currentGama = line;
        currentSublinea = null;
        continue;
      }
      // Etapas de Eukanuba (PUPPY/ADULT/SENIOR/FIT BODY) → línea
      if (/^(PUPPY|ADULT|ADULTO|SENIOR|FIT BODY|PREMIUM PERFORMANCE|LAMB|KITTEN|GATO)/i.test(upper)) {
        currentLinea = line;
        currentSublinea = null;
        continue;
      }
      if (/^[A-ZÑ0-9][A-ZÑ0-9 &.()+'-]*$/.test(line) && /[A-ZÑ]/.test(line)) {
        // ALL-CAPS label → sublinea/tipo
        currentSublinea = line;
        currentTipo = line;
        continue;
      }
      // Mixed-case label (e.g. "Razas Pequeñas", "Adulto", "Kitten")
      currentSublinea = line;
      currentTipo = line;
      continue;
    }
  }

  return { period: capturePeriod(text), rows };
}

// ── Suggested price (spec REQ-7, design precision note) ────────────────────

/**
 * suggestedPrice = round2(Con IVA × 1.3334). When Con IVA is missing but
 * SIN IVA exists → Con IVA = round2(SIN IVA × 1.21) first. null when nothing
 * is derivable (row stays in "error" state).
 *
 * Precision finding: round2(10642 × 1.3334) = 14190.04, NOT 14190 — the PDF
 * truncates to an integer. The formula wins; the plan prints our values.
 */
export function computeSuggestedPrice(
  conIva: number | null,
  sinIva: number | null,
): number | null {
  if (conIva !== null && conIva !== undefined) return round2(conIva * 1.3334);
  if (sinIva !== null && sinIva !== undefined) {
    return round2(round2(sinIva * 1.21) * 1.3334);
  }
  return null;
}

// ── Parsers ────────────────────────────────────────────────────────────────

/** One product row: "NAME $ SIN $ CON $ SUG" (SUG from the PDF is discarded). */
const SECO_ROW = /^(.*?)\s+\$?\s*([\d.,\s]+)\s+\$?\s*([\d.,\s]+)\s+\$?\s*([\d.,\s]+)\s*$/;

/** SECO layout: brand → LÍNEA → subline → product rows (state machine). */
export function parseAlicanSeco(text: string): ParsedPriceList {
  const lines = cleanLines(text);
  const rows: ParsedRow[] = [];
  let marca: string | null = null;
  let linea: string | null = null;
  let sublinea: string | null = null;

  for (const line of lines) {
    if (BRANDS_ALICAN.has(line)) {
      marca = line;
      linea = null;
      sublinea = null;
      continue;
    }
    const lineMatch = /^LÍNEA\s+(.+)$/i.exec(line);
    if (lineMatch) {
      linea = lineMatch[1].trim();
      sublinea = null;
      continue;
    }
    const row = SECO_ROW.exec(line);
    if (row) {
      rows.push({
        nombre: row[1].trim(),
        marca,
        linea,
        sublinea,
        unidadEmpaque: extractUnit(row[1].trim()),
        precioSinIva: normalizePrice(row[2]),
        precioConIva: normalizePrice(row[3]),
      });
      continue;
    }
    if (/^[A-ZÑ0-9][A-ZÑ0-9 &.()+'-]*$/.test(line) && /[A-ZÑ]/.test(line)) {
      // ALL-CAPS-ish line without prices → subline (e.g. "SIEGER PUPPY").
      sublinea = line;
      continue;
    }
    // Name without prices (e.g. "STARTER Kit" or a row priced with dashes) →
    // error row, never a batch failure. Trailing "-" placeholders are stripped
    // from the display name.
    rows.push({
      nombre: line.replace(/[\s-]+$/g, ""),
      marca,
      linea,
      sublinea,
      unidadEmpaque: null,
      precioSinIva: null,
      precioConIva: null,
    });
  }

  return { period: capturePeriod(text), rows };
}

/**
 * WET layout: flat rows "NAME BRAND UNIT $ SIN $ CON $ SUG". Flat per design
 * D9: brand/line/subline are null (the WET section is a single flat list); the
 * unit is extracted from the separate UNIDAD DE EMPAQUE column.
 */
const WET_ROW =
  /^(.*?)\s+(\d+\s*(?:pouches|latas)\s*x\s*[\d.,]+\s*(?:gr|kg))\s+\$\s*([\d.,]+)\s+\$\s*([\d.,]+)\s+\$\s*([\d.,]+)\s*$/i;

/** Known Alican WET brands (inline column in the flat WET rows). */
const WET_BRANDS = new Set([
  "SIEGER",
  "KATZE",
  "MAXXIUM",
  "AGILITY P.",
  "AGILITY G.",
  "7 VIDAS",
  "GOOSTER",
]);

/**
 * Strips the trailing WET brand token from the row prefix when it matches a
 * known WET brand (design D9: the brand is NOT persisted as hierarchy; it is
 * only removed so the product name stays clean).
 */
function wetRowName(prefix: string): string {
  for (const brand of WET_BRANDS) {
    if (prefix.endsWith(` ${brand}`)) {
      return prefix.slice(0, prefix.length - brand.length - 1).trim();
    }
  }
  return prefix.trim();
}

export function parseAlicanWet(text: string): ParsedPriceList {
  const lines = cleanLines(text);
  const rows: ParsedRow[] = [];

  for (const line of lines) {
    const row = WET_ROW.exec(line);
    if (row) {
      rows.push({
        nombre: wetRowName(row[1]),
        // D9: flat layout — the brand present in the text is NOT persisted as
        // hierarchy (the WET plan is a plain list).
        marca: null,
        linea: null,
        sublinea: null,
        unidadEmpaque: row[2].trim(),
        precioSinIva: normalizePrice(row[3]),
        precioConIva: normalizePrice(row[4]),
      });
      continue;
    }
    // Anomalous non-noise line without the unit+prices shape → error row.
    rows.push({
      nombre: line,
      marca: null,
      linea: null,
      sublinea: null,
      unidadEmpaque: null,
      precioSinIva: null,
      precioConIva: null,
    });
  }

  return { period: capturePeriod(text), rows };
}

// ── Matching (spec REQ-5/REQ-6, design §5) ─────────────────────────────────

export type MatchState = "matched" | "unmatched" | "multi-match" | "duplicado" | "error";

export interface MatchResult {
  estado: MatchState;
  productId?: string;
  productIds?: string[];
  matchName?: string | null;
}

export interface PreviewRow {
  position: number; // idTemporal para el apply (determinista entre preview y apply)
  nombre: string; // nombre ORIGINAL del PDF
  unidadEmpaque: string | null;
  marca: string | null;
  linea: string | null;
  sublinea: string | null;
  precioSinIva: number | null;
  precioConIva: number | null;
  sugerido: number | null; // round2(conIva × 1.3334); fallback 1.21; null si nada
  estado: MatchState;
  productId: string | null;
  productIds?: string[];
  matchName?: string | null; // nombre del producto en catálogo (UX)
}

/**
 * Índice del catálogo de UNA org, claveado por nombre/código normalizados →
 * ids (multi-match = duplicados del catálogo). DEVIATION del design §5: no se
 * indexa por marca (byBrand): con matcheo por igualdad EXACTA post-normalización
 * (decisión cerrada #5) una fila jamás equivale al nombre de una marca, e
 * indexar marcas generaría multi-match spam. El scope org se aplica en el
 * findMany (where.organizationId) → lo que no está en la org no matchea.
 */
export interface CatalogIndex {
  byName: Map<string, string[]>;
  byCode: Map<string, string[]>;
  names: Map<string, string>; // productId → nombre en catálogo (matchName UX)
}

type DbLike = {
  product: {
    findMany: (args: {
      where: { organizationId: string };
      select: {
        id: true;
        name: true;
        code: true;
        variantAssignments: {
          select: {
            option: { select: { value: true; variant: { select: { name: true } } } };
          };
        };
      };
    }) => Promise<
      {
        id: string;
        name: string;
        code: string | null;
        variantAssignments: {
          option: { value: string; variant: { name: string } };
        }[];
      }[]
    >;
  };
};

export async function buildCatalogIndex(
  db: DbLike,
  organizationId: string,
): Promise<CatalogIndex> {
  const products = await db.product.findMany({
    where: { organizationId },
    select: {
      id: true,
      name: true,
      code: true,
      variantAssignments: {
        select: {
          option: { select: { value: true, variant: { select: { name: true } } } },
        },
      },
    },
  });

  const byName = new Map<string, string[]>();
  const byCode = new Map<string, string[]>();
  const names = new Map<string, string>();
  const add = (map: Map<string, string[]>, key: string, id: string) => {
    if (!key) return;
    const arr = map.get(key);
    if (arr) arr.push(id);
    else map.set(key, [id]);
  };

  for (const p of products) {
    names.set(p.id, p.name);
    add(byName, normalizeName(p.name), p.id);
    if (p.code) add(byCode, normalizeName(p.code), p.id);
  }
  return { byName, byCode, names };
}

function resultFor(ids: string[], index: CatalogIndex): MatchResult {
  if (ids.length === 1) {
    return {
      estado: "matched",
      productId: ids[0],
      productIds: ids,
      matchName: index.names.get(ids[0]) ?? null,
    };
  }
  return {
    estado: "multi-match",
    productId: ids[0], // default = primer id
    productIds: ids,
    matchName: index.names.get(ids[0]) ?? null,
  };
}

/** Match por igualdad EXACTA post-normalización; fallback por código. */
export function matchByName(
  nombreNormalizado: string,
  index: CatalogIndex,
): MatchResult {
  const ids = index.byName.get(nombreNormalizado);
  if (ids && ids.length > 0) return resultFor(ids, index);
  const codeIds = index.byCode.get(nombreNormalizado);
  if (codeIds && codeIds.length > 0) return resultFor(codeIds, index);
  return { estado: "unmatched" };
}

/** Match por código de producto (fallback cuando el nombre no coincide). */
export function matchByCode(codigo: string | null, index: CatalogIndex): MatchResult {
  if (!codigo) return { estado: "unmatched" };
  const ids = index.byCode.get(normalizeName(codigo));
  if (ids && ids.length > 0) return resultFor(ids, index);
  return { estado: "unmatched" };
}

/**
 * Convierte filas parseadas en filas de preview. Reglas (REQ-5/REQ-6):
 * - Sin precios → estado error (no importable hasta omitir/asignar).
 * - 1 id → matched; 0 → unmatched; 2+ → multi-match (default primer id).
 * - Mismo nombre normalizado en 2+ filas del PDF → TODAS quedan duplicado
 *   (el apply valida a lo sumo UNA importación por grupo).
 * - Prioridad: error > duplicado > multi-match > matched > unmatched.
 * - El nombre ORIGINAL del PDF se conserva siempre.
 */
export function matchRows(rows: ParsedRow[], index: CatalogIndex): PreviewRow[] {
  const previews: PreviewRow[] = rows.map((row, position) => {
    const isError = row.precioSinIva === null && row.precioConIva === null;
    // Primero por nombre; si no matchea, fallback por código del PDF (más
    // confiable cuando el formato del nombre difiere, ej. peso en columna aparte).
    let m: MatchResult = { estado: "unmatched" };
    if (!isError) {
      m = matchByName(normalizeName(row.nombre), index);
      if (m.estado === "unmatched" && row.codigo) {
        m = matchByCode(row.codigo, index);
      }
    } else {
      m = { estado: "error" };
    }
    return {
      position,
      nombre: row.nombre,
      unidadEmpaque: row.unidadEmpaque,
      marca: row.marca,
      linea: row.linea,
      sublinea: row.sublinea,
      precioSinIva: row.precioSinIva,
      precioConIva: row.precioConIva,
      sugerido: computeSuggestedPrice(row.precioConIva, row.precioSinIva),
      estado: m.estado,
      productId: m.productId ?? null,
      productIds: m.productIds,
      matchName: m.matchName ?? null,
    };
  });

  // Grupos de duplicados del PDF (por nombre normalizado).
  const counts = new Map<string, number>();
  for (const p of previews) {
    const key = normalizeName(p.nombre);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const p of previews) {
    if (p.estado === "error") continue; // error > duplicado
    const key = normalizeName(p.nombre);
    if ((counts.get(key) ?? 0) > 1) p.estado = "duplicado";
  }

  return previews;
}

/**
 * Import de planillas de precios Alican (sdd/alican-wholesale-price-list).
 *
 * importPriceList (preview): multer → pdf-parse getText → detectLayout →
 * parseAlicanSeco|Wet → capturePeriod → buildCatalogIndex(org) → matchRows →
 * fs.unlink del temporal (D5) → 200 con rows + estados + sugerido. Con
 * ?dryRun=false aplica decisiones DEFAULT (D10: matched/multi-match[0] se
 * importan; el resto se omite) SIN aplicar precios (applyPrices false).
 *
 * applyPriceList: transacción idempotente (D1/D2) — findFirst PriceList
 * (org, type, period) → deleteMany (recrear) → create PriceList + sections
 * (jerarquía del PDF) + entries → updateMany Product.suggestedPrice UNA vez
 * por producto. Fila omitida: no se persiste ni toca nada.
 *
 * applyPrices=true (check "Aplicar precios al catálogo", default ON en la UI,
 * sdd/alican-wholesale-price-list/apply-prices): el precio Con IVA de cada fila
 * va a product.price de los productos vinculados, y las filas sin match se
 * CREAN (name = fila, price = Con IVA, sin categoría, marca asociada si existe
 * una equivalente como variante "Marca"). Filas con precioConIva null: no
 * aplican precio ni se crean. applyPrices ausente/false = comportamiento
 * ORIGINAL (product.price NUNCA se toca, nada se crea).
 */

import fs from "fs";
import { Request, Response } from "express";
import { InvalidPDFException, PDFParse } from "pdf-parse";
import { runWithTenant, requireOrganizationId } from "../config/tenantContext";
import type { AuthedRequest } from "../middlewares/authMiddleware";
import { prisma } from "../config/db";
import { round2, roundBolsaPriceIfHigh } from "../utils/money";
import { normalizeProductName } from "../utils/productName";
import {
  buildCatalogIndex,
  computeSuggestedPrice,
  detectLayout,
  detectProviderLayout,
  LayoutNotSupportedError,
  matchRows,
  normalizeName,
  parseAlicanSeco,
  parseAlicanWet,
  parsePriceList,
  type Layout,
  type ProviderLayout,
  type PreviewRow,
} from "../services/providerPriceListService";

/** Error de negocio del apply → 400 con mensaje al usuario. */
export class ApplyPriceListError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplyPriceListError";
  }
}

export interface ApplyDecision {
  position: number;
  accion: "import" | "omit";
  productId?: string;
  nombre: string;
  marca?: string | null;
  linea?: string | null;
  sublinea?: string | null;
  // New fields for multi-brand support
  gama?: string | null;
  tipo?: string | null;
  codigo?: string | null;
  /** Proveedor específico de esta fila (opcional). Si no se provee, se infiere de marca/gama/tipo. */
  providerName?: string | null;
  unidadEmpaque?: string | null;
  precioSinIva?: number | null;
  precioConIva?: number | null;
}

interface SectionGroup {
  brand: string | null;
  line: string | null;
  subline: string | null;
  entries: ApplyDecision[];
}

/**
 * Agrupa las filas a importar por jerarquía DEL PDF (marca → línea → sublínea)
 * en orden de aparición: cada grupo es una PriceListSection. Sin jerarquía
 * (WET, D9) → una sola sección plana.
 */
export function buildSections(rows: ApplyDecision[]): SectionGroup[] {
  const sections: SectionGroup[] = [];
  let current: SectionGroup | null = null;
  let currentKey = "";
  for (const r of rows) {
    const key = `${r.marca ?? ""}\u0000${r.linea ?? ""}\u0000${r.sublinea ?? ""}`;
    if (!current || key !== currentKey) {
      current = {
        brand: r.marca ?? null,
        line: r.linea ?? null,
        subline: r.sublinea ?? null,
        entries: [],
      };
      sections.push(current);
      currentKey = key;
    }
    current.entries.push(r);
  }
  return sections;
}

/**
 * Plan de aplicación de precios (sdd/alican-wholesale-price-list/apply-prices).
 * Puro y determinista: dado el payload de decisiones, cuántos productos se van
 * a ACTUALIZAR (filas con productId y precio Con IVA) y cuáles se van a CREAR
 * (filas sin productId con precio Con IVA). Las filas con precioConIva null NO
 * pueden aplicar precio ni crearse (se mantienen planilla-only, decisión 5).
 * El front lo usa para el preview de confirmación; el apply lo re-deriva
 * server-side (autoritativo).
 */
export function buildPriceApplyPlan(rows: ApplyDecision[]): {
  priceUpdates: number;
  creates: { name: string; marca: string | null }[];
} {
  const creates: { name: string; marca: string | null }[] = [];
  let priceUpdates = 0;
  for (const r of rows) {
    if (r.accion !== "import") continue;
    if (r.precioConIva == null) continue; // sin precio no se aplica ni se crea
    if (r.productId) priceUpdates++;
    else creates.push({ name: r.nombre, marca: r.marca ?? null });
  }
  return { priceUpdates, creates };
}

/**
 * Índice de marcas del sistema → optionId de la variante "Marca". Puro:
 * recibe las opciones ya scopeadas a la org y normaliza los valores con
 * normalizeName (mismo criterio que el matcheo del catálogo).
 */
export function buildBrandOptionIndex(options: { id: string; value: string }[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const o of options) {
    const key = normalizeName(o.value);
    if (key && !index.has(key)) index.set(key, o.id); // primer match gana
  }
  return index;
}

/** Decisiones default para ?dryRun=false (D10). */
function defaultDecisions(preview: PreviewRow[]): ApplyDecision[] {
  return preview.map((r) => ({
    position: r.position,
    accion:
      r.estado === "matched" || r.estado === "multi-match" ? "import" : "omit",
    productId: r.productId ?? undefined,
    nombre: r.nombre,
    marca: r.marca,
    linea: r.linea,
    sublinea: r.sublinea,
    unidadEmpaque: r.unidadEmpaque,
    precioSinIva: r.precioSinIva,
    precioConIva: r.precioConIva,
  }));
}

/**
 * Regla de re-import del suggestedPrice: si el producto YA tiene un valor
 * actual y difiere del que recalcularía el PDF (comparación round2 vs round2,
 * robusta ante drift de floats), fue ajustado a mano (BulkPriceUpdate /
 * adjustPriceList) → se CONSERVA el valor actual. Si coincide o es null → se
 * recalcula. Los null que devuelve computed (fila sin precios) se propagan.
 */
function resolveReimportSuggested(
  computed: number | null,
  current: number | null | undefined,
): number | null {
  if (computed === null) return null;
  if (current === null || current === undefined) return computed;
  const preserved = round2(Number(current));
  return preserved === computed ? computed : preserved;
}

async function extractPdfText(filePath: string): Promise<string> {
  const buf = await fs.promises.readFile(filePath);
  const parser = new PDFParse({ data: buf });
  const res = await parser.getText();
  return res.text;
}

/** Preview con el catálogo de la org (puro de DB: recibe el cliente db). */
export async function buildPreview(
  db: { product: { findMany: (args: any) => Promise<any[]> } },
  organizationId: string,
  text: string,
): Promise<{ layout: string; period: string | null; rows: PreviewRow[] }> {
  // Use new multi-brand parser (falls back to Alican parsers for alican)
  const { detectProviderLayout, parsePriceList } = await import("../services/providerPriceListService");
  const detected = detectProviderLayout(text);
  const { period, rows: parsedRows } = parsePriceList(text, detected);
  const index = await buildCatalogIndex(db, organizationId);
  const matchedRows = matchRows(parsedRows, index);
  return { layout: detected.layout, period, rows: matchedRows };
}

export const importPriceList = async (req: Request, res: Response) => {
  // Fix round 2 (verify obs #213 finding C): multer (busboy) puede PERDER el
  // contexto ALS de authenticateJWT durante el parseo multipart — los
  // callbacks del stream del request corren fuera del scope de runWithTenant
  // (fallo INTERMITENTE, race entre completar el archivo y el 'end' del
  // request). req.user se setea ANTES de multer, así que re-establecemos el
  // contexto de tenant desde ahí para que requireOrganizationId() y la
  // extensión anti-fuga de Prisma funcionen aunque el ALS se haya perdido.
  const user = (req as AuthedRequest).user;
  if (user?.organizationId) {
    return runWithTenant(
      { userId: user.id, role: user.role, organizationId: user.organizationId },
      () => importPriceListCore(req, res),
    );
  }
  return importPriceListCore(req, res);
};

/** Cuerpo del preview (envuelto en el contexto restaurado por importPriceList). */
async function importPriceListCore(req: Request, res: Response) {
  let filePath: string | null = null;
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No se recibió el archivo" });
    }
    filePath = req.file.path;
    const organizationId = requireOrganizationId();

    const text = await extractPdfText(filePath);
    const { layout, period, rows } = await buildPreview(prisma, organizationId, text);

    // D5: el PDF temporal se borra apenas se parsea; sourceFilename conserva
    // el nombre original como metadata.
    await fs.promises.unlink(filePath).catch(() => undefined);
    filePath = null;

    const sourceFilename = req.file.originalname;
    const dryRun = req.query.dryRun !== "false"; // default true

    if (dryRun) {
      return res.status(200).json({
        layout,
        period,
        sourceFilename,
        total: rows.length,
        rows,
      });
    }

    // D10: apply con decisiones default (matched + multi-match[0] importados;
    // unmatched / duplicado-extra / error omitidos).
    const result = await applyPriceListCore(organizationId, {
      layout: layout as Layout | "eukanuba" | "royal-canin" | "page7-multi" | "hierarchical-3lvl" | "hierarchical-2lvl" | "flat-multi",
      period,
      sourceFilename,
      rows: defaultDecisions(rows),
    });
    return res.status(200).json(result);
  } catch (error: any) {
    if (filePath) {
      await fs.promises.unlink(filePath).catch(() => undefined);
    }
    if (error instanceof LayoutNotSupportedError) {
      return res.status(400).json({ message: "Formato de planilla no reconocido" });
    }
    // Archivo no-PDF / PDF corrupto: pdf-parse lanza InvalidPDFException (y
    // FormatError/PasswordException en variantes). Mismo semántica 400 que el
    // layout no reconocido (spec REQ-1 "fallo explícito, nunca silencioso").
    const isPdfParseError =
      error instanceof InvalidPDFException ||
      (typeof error?.name === "string" &&
        /^(InvalidPDFException|FormatError|PasswordException)$/.test(error.name));
    if (isPdfParseError) {
      return res.status(400).json({ message: "Formato de planilla no reconocido" });
    }
    console.error("Error importando planilla:", error);
    return res.status(500).json({ message: "Error al procesar la planilla" });
  }
};

export const applyPriceList = async (req: Request, res: Response) => {
  try {
    const organizationId = requireOrganizationId();
    const body = req.body as {
      layout: Layout;
      period: string | null;
      sourceFilename: string;
      applyPrices?: boolean;
      providerName?: string;
      rows: ApplyDecision[];
    };
    const result = await applyPriceListCore(organizationId, body);
    return res.status(200).json(result);
  } catch (error: any) {
    if (error instanceof ApplyPriceListError) {
      return res.status(400).json({ message: error.message });
    }
    console.error("Error aplicando planilla:", error);
    return res.status(500).json({ message: "Error al aplicar la planilla" });
  }
};

/**
 * Espejo de syncHqStock (stockService) inline en el tx del apply: crea/actualiza
 * el ProductStock(HQ) y refleja Product.quantity. No se reutiliza syncHqStock
 * porque éste abre su PROPIO $transaction y no se puede anidar dentro del
 * transaction interactivo del apply.
 */
async function syncHqStockInline(
  tx: any,
  organizationId: string,
  productId: string,
): Promise<void> {
  const hq = await tx.branch.findFirst({
    where: { organizationId, isHeadquarters: true },
    select: { id: true },
  });
  if (!hq) return;
  const existing = await tx.productStock.findFirst({
    where: { productId, branchId: hq.id, organizationId },
  });
  if (existing) {
    await tx.productStock.updateMany({
      where: { productId, branchId: hq.id, organizationId },
      data: { quantity: 0 },
    });
  } else {
    await tx.productStock.create({
      data: { productId, branchId: hq.id, quantity: 0, organizationId },
    });
  }
}

/**
 * Núcleo transaccional del apply (compartido por /apply y ?dryRun=false).
 *
 * Con applyPrices=true (check "Aplicar precios al catálogo", default ON en la
 * UI): el precio Con IVA de cada fila importada va a product.price de los
 * productos vinculados, y las filas sin match se CREAN automáticamente (name =
 * nombre de la fila, price = Con IVA, sin categoría) con la marca de la fila
 * asociada SI existe una marca equivalente (variante "Marca") en el sistema.
 * Filas con precioConIva null: no aplican precio ni se crean (planilla-only).
 * Con applyPrices=false (ausente): comportamiento ORIGINAL — solo
 * suggestedPrice, NUNCA product.price, NUNCA crea productos.
 *
 * Re-import (sdd/alican-wholesale-price-list/reimport): los productos
 * matcheados que YA tienen un suggestedPrice ajustado a mano (difiere del
 * recalculado por el PDF) lo CONSERVAN — tanto en Product.suggestedPrice como
 * en el PriceListEntry.suggestedPrice de la planilla recreada (así la planilla
 * impresa muestra el ajuste). Sin ajuste (coincide o null) → se recalcula.
 */
/**
 * Precio al público que se guarda en product.price al importar la planilla:
 * el precio UNITARIO SIN IVA del proveedor + 21% (IVA). Ese es el precio base
 * de venta al público; el BulkPriceUpdate luego aplica la ganancia y el % de
 * aumento por encima. Fallback a Con IVA directo solo si la planilla no trae
 * Sin IVA (algunas filas de página 7 solo tienen Con IVA).
 */
const resolveSalePrice = (sinIva: number | null | undefined, conIva: number | null | undefined): number | null => {
  if (sinIva != null) return round2(sinIva * 1.21);
  if (conIva != null) return round2(conIva);
  return null;
};

async function applyPriceListCore(
  organizationId: string,
  body: {
    layout: Layout | "eukanuba" | "royal-canin" | "page7-multi" | "hierarchical-3lvl" | "hierarchical-2lvl" | "flat-multi";
    period: string | null;
    sourceFilename: string;
    applyPrices?: boolean;
    providerName?: string;
    rows: ApplyDecision[];
  },
): Promise<{
  priceListId: string;
  imported: number;
  omitted: number;
  suggestedUpdated: number;
  priceUpdated: number;
  productsCreated: number;
}> {
  const { layout, period, sourceFilename, applyPrices = false, providerName, rows } = body;
  const providerNameTrimmed = providerName?.trim();
  const imports = rows.filter((r) => r.accion === "import");

  if (imports.length === 0) {
    throw new ApplyPriceListError("No hay filas para importar");
  }
  for (const r of imports) {
    if (r.precioSinIva == null && r.precioConIva == null) {
      throw new ApplyPriceListError(`La fila "${r.nombre}" no tiene precios para importar`);
    }
  }
  // A lo sumo UNA fila importada por grupo duplicado del PDF (mismo nombre
  // normalizado) ENTRE filas LINKED a producto: protege el doble-write del
  // suggestedPrice. Las filas planilla-only (sin productId) no compiten —
  // cada una es una entrada independiente aunque repitan nombre normalizado.
  const groupCounts = new Map<string, number>();
  for (const r of imports) {
    if (!r.productId) continue;
    const key = normalizeName(r.nombre);
    groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of groupCounts) {
    if (count > 1) {
      throw new ApplyPriceListError(
        `Hay más de una fila importada con el mismo nombre: "${key}"`,
      );
    }
  }

  // Map provider layouts to PriceList types (SECO/WET)
  const type = (() => {
    if (layout === "SECO" || layout === "eukanuba" || layout === "royal-canin" || layout === "hierarchical-3lvl" || layout === "hierarchical-2lvl") return "SECO";
    return "WET";
  })();

  return prisma.$transaction(async (tx) => {
    // Anti-fuga (REQ-12): los productId deben existir en la org. El cliente tx
    // hereda la extensión tenant → el findMany ya scopea por organizationId.
    // De paso se lee el suggestedPrice ACTUAL de cada producto: el re-import
    // conserva los ajustes manuales (resolveReimportSuggested más abajo).
    const currentSuggestedById = new Map<string, number | null>();
    const productIds = [
      ...new Set(imports.map((r) => r.productId).filter((id): id is string => Boolean(id))),
    ];
    if (productIds.length > 0) {
      const found = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, suggestedPrice: true },
      });
      if (found.length !== productIds.length) {
        throw new ApplyPriceListError("Producto manual fuera de la organización");
      }
      for (const p of found) {
        currentSuggestedById.set(p.id, p.suggestedPrice == null ? null : Number(p.suggestedPrice));
      }
    }

    // Idempotencia (D1/D2): mismo (org, type, period) → borra y recrea.
    const existing = await tx.priceList.findFirst({
      where: { organizationId, type, period: period ?? null },
    });
    if (existing) {
      await tx.priceList.deleteMany({ where: { id: existing.id } });
    }

    const created = await tx.priceList.create({
      data: {
        organizationId,
        provider: providerNameTrimmed ?? "ALICAN",
        type,
        period: period ?? null,
        sourceFilename,
      },
    });

    // ── Proveedor de la planilla (multi-brand support) ──
    // Resolvemos providerId por fila usando providerName de cada fila (o fallback global).
    // Cache para evitar consultas repetidas a la BD.
    const providerIdCache = new Map<string, string>();
    async function getProviderIdForRow(rowProviderName: string | null | undefined): Promise<string | null> {
      const name = (rowProviderName ?? providerNameTrimmed ?? "").trim();
      if (!name) return null;
      if (providerIdCache.has(name)) return providerIdCache.get(name)!;
      const existing = await tx.provider.findFirst({
        where: { organizationId, name: { equals: name, mode: "insensitive" } },
        select: { id: true },
      });
      let id: string | null = null;
      if (existing) {
        id = existing.id;
      } else {
        const provider = await tx.provider.create({ data: { name, organizationId } });
        id = provider.id;
      }
      providerIdCache.set(name, id);
      return id;
    }

    // Helper to determine if a row touches products (needs provider)
    function rowTouchesProducts(r: ApplyDecision): boolean {
      return !!r.productId || (applyPrices && r.precioConIva != null);
    }

    // ── Aplicar precios: crear los no matcheados (applyPrices ON) ──────────
    // Position → productId resuelto (existente, reutilizado o recién creado).
    const resolveByPosition = new Map<number, string>();
    const createdIds = new Set<string>();
    let brandIndex = new Map<string, string>();
    let existingByName = new Map<string, string>();

    if (applyPrices) {
      // Marcas del sistema = variante "Marca" (mismo criterio que bulkPriceUpdate).
      const brandDefs = await tx.categoryVariantDefinition.findMany({
        where: { organizationId, name: "Marca" },
        select: { options: { select: { id: true, value: true } } },
      });
      brandIndex = buildBrandOptionIndex(brandDefs.flatMap((d) => d.options));

      // Índice de productos existentes por nombre normalizado: si una fila sin
      // match apunta a un producto ya creado (re-import de un período previo o
      // payload stale), se REUTILIZA en vez de duplicar el catálogo.
      const existingProducts = await tx.product.findMany({
        where: { organizationId },
        select: { id: true, name: true, suggestedPrice: true },
      });
      for (const p of existingProducts) {
        const key = normalizeName(p.name);
        if (key && !existingByName.has(key)) existingByName.set(key, p.id);
        // Los reutilizados por nombre también conservan su ajuste manual.
        if (key) {
          currentSuggestedById.set(
            p.id,
            p.suggestedPrice == null ? null : Number(p.suggestedPrice),
          );
        }
      }

      for (const r of imports) {
        if (r.productId || r.precioConIva == null) continue;
        const key = normalizeName(r.nombre);
        const reusedId = existingByName.get(key);
        if (reusedId) {
          resolveByPosition.set(r.position, reusedId);
          continue;
        }
        const rowProviderId = rowTouchesProducts(r) ? await getProviderIdForRow(r.providerName) : null;
        const product = await tx.product.create({
          data: {
            name: normalizeProductName(r.nombre),
            price: roundBolsaPriceIfHigh(resolveSalePrice(r.precioSinIva, r.precioConIva) ?? 0),
            quantity: 0,
            categoryId: null,
            organizationId,
            suggestedPrice: computeSuggestedPrice(r.precioConIva, r.precioSinIva ?? null),
            ...(rowProviderId ? { providerId: rowProviderId } : {}),
          },
        });
        const optionId = r.marca ? brandIndex.get(normalizeName(r.marca)) : undefined;
        if (optionId) {
          await tx.productVariant.create({
            data: { productId: product.id, optionId, organizationId },
          });
        }
        await syncHqStockInline(tx, organizationId, product.id);
        existingByName.set(key, product.id);
        resolveByPosition.set(r.position, product.id);
        createdIds.add(product.id);
      }
    }

    const sections = buildSections(imports);
    let sectionPosition = 0;
    for (const section of sections) {
      const sec = await tx.priceListSection.create({
        data: {
          priceListId: created.id,
          brand: section.brand,
          line: section.line,
          subline: section.subline,
          position: sectionPosition++,
        },
      });
      let entryPosition = 0;
      for (const r of section.entries) {
        const productId = r.productId ?? resolveByPosition.get(r.position) ?? null;
        const computed = computeSuggestedPrice(r.precioConIva ?? null, r.precioSinIva ?? null);
        const sugerido = resolveReimportSuggested(
          computed,
          productId ? currentSuggestedById.get(productId) : undefined,
        );
        await tx.priceListEntry.create({
          data: {
            sectionId: sec.id,
            productId,
            name: r.nombre,
            unit: r.unidadEmpaque ?? null,
            priceSinIva: r.precioSinIva ?? null,
            priceConIva: r.precioConIva ?? null,
            suggestedPrice: sugerido,
            matched: !!productId,
            position: entryPosition++,
          },
        });
      }
    }

    // suggestedPrice (+ price con applyPrices) — UNA escritura por producto.
    // Los productos RECIÉN creados ya llevan price y suggestedPrice en el
    // create → se omiten acá. product.price solo se toca con applyPrices ON y
    // precio Con IVA presente (decisión 5: fila sin Con IVA no aplica precio).
    const seenProducts = new Set<string>();
    let priceUpdated = 0;
    for (const r of imports) {
      const productId = r.productId ?? resolveByPosition.get(r.position);
      if (!productId || seenProducts.has(productId)) continue;
      if (createdIds.has(productId)) continue; // ya queda con price+sugerido
      seenProducts.add(productId);
      const data: { suggestedPrice: number | null; price?: number; providerId?: string } = {
        suggestedPrice: resolveReimportSuggested(
          computeSuggestedPrice(r.precioConIva ?? null, r.precioSinIva ?? null),
          currentSuggestedById.get(productId),
        ),
      };
      if (applyPrices && (r.precioSinIva != null || r.precioConIva != null)) {
        data.price = roundBolsaPriceIfHigh(resolveSalePrice(r.precioSinIva, r.precioConIva)!);
        priceUpdated++;
      }
      if (rowTouchesProducts(r)) {
        const rowProviderId = await getProviderIdForRow(r.providerName);
        if (rowProviderId) data.providerId = rowProviderId;
      }
      await tx.product.updateMany({
        where: { id: productId },
        data,
      });
    }

    return {
      priceListId: created.id,
      imported: imports.length,
      omitted: rows.length - imports.length,
      suggestedUpdated: seenProducts.size + createdIds.size,
      priceUpdated,
      productsCreated: createdIds.size,
    };
  });
}

// ── Listado / detalle (REQ-9) ──────────────────────────────────────────────

/**
 * GET /price-lists — planillas de la org por importedAt desc, con
 * sectionsCount y entriesCount agregados.
 */
export const listPriceLists = async (req: Request, res: Response) => {
  try {
    const organizationId = requireOrganizationId();
    const lists = await prisma.priceList.findMany({
      where: { organizationId },
      orderBy: { importedAt: "desc" },
      select: {
        id: true,
        provider: true,
        type: true,
        period: true,
        sourceFilename: true,
        importedAt: true,
        _count: { select: { sections: true } },
        sections: { select: { _count: { select: { entries: true } } } },
      },
    });
    const items = lists.map((l) => ({
      id: l.id,
      provider: l.provider,
      type: l.type,
      period: l.period,
      sourceFilename: l.sourceFilename,
      importedAt: l.importedAt,
      sectionsCount: l._count.sections,
      entriesCount: l.sections.reduce((s, sec) => s + sec._count.entries, 0),
    }));
    return res.status(200).json({ items });
  } catch (error: any) {
    console.error("Error listando planillas:", error);
    return res.status(500).json({ message: "Error al listar las planillas" });
  }
};

/**
 * GET /price-lists/:id — jerarquía del PDF (sections por position, entries por
 * position). 404 si la planilla no existe o pertenece a otra org (findFirst
 * con organizationId — anti-fuga REQ-12).
 */
export const getPriceList = async (req: Request, res: Response) => {
  try {
    const organizationId = requireOrganizationId();
    const { id } = req.params;
    const pl = await prisma.priceList.findFirst({
      where: { id, organizationId },
      include: {
        sections: {
          orderBy: { position: "asc" },
          include: { entries: { orderBy: { position: "asc" } } },
        },
      },
    });
    if (!pl) {
      return res.status(404).json({ message: "Planilla no encontrada" });
    }
    return res.status(200).json({
      id: pl.id,
      provider: pl.provider,
      type: pl.type,
      period: pl.period,
      sourceFilename: pl.sourceFilename,
      importedAt: pl.importedAt,
      sections: pl.sections.map((s) => ({
        id: s.id,
        brand: s.brand,
        line: s.line,
        subline: s.subline,
        position: s.position,
        entries: s.entries.map((e) => ({
          id: e.id,
          productId: e.productId,
          name: e.name,
          unit: e.unit,
          // Prisma Decimal se serializaría a STRING en JSON; el contrato
          // (design §6.3) y los tipos del front exigen number. Convertir acá.
          priceSinIva: e.priceSinIva === null ? null : Number(e.priceSinIva),
          priceConIva: e.priceConIva === null ? null : Number(e.priceConIva),
          suggestedPrice: e.suggestedPrice === null ? null : Number(e.suggestedPrice),
          matched: e.matched,
          position: e.position,
        })),
      })),
    });
  } catch (error: any) {
    console.error("Error obteniendo planilla:", error);
    return res.status(500).json({ message: "Error al obtener la planilla" });
  }
};

// ── Ajuste masivo de sugeridos (REQ-11, D7) ────────────────────────────────

interface AdjustRow {
  entryId: string;
  name: string;
  productId: string | null;
  suggestedPrice: number;
  newSuggestedPrice: number;
  delta: number;
}

/**
 * POST /price-lists/:id/adjust (?dryRun) — patrón dryRun de bulkPriceUpdate:
 * el % se aplica server-side sobre el suggestedPrice ACTUAL de cada entrada de
 * la planilla (excluidas fuera; overrides por entryId). El apply escribe
 * PriceListEntry.suggestedPrice Y Product.suggestedPrice (solo entradas con
 * productId). Los precios del proveedor (priceSinIva/priceConIva) NO se tocan.
 * Comportamiento compuesto en re-runs (10% + 10% ≠ 21%), igual que bulkPriceUpdate.
 */
export const adjustPriceList = async (req: Request, res: Response) => {
  try {
    const organizationId = requireOrganizationId();
    const { id } = req.params;
    const { percentage, excludeEntryIds = [], entryOverrides = [] } = req.body as {
      percentage?: number;
      excludeEntryIds?: string[];
      entryOverrides?: { entryId: string; suggestedPrice: number }[];
    };
    const dryRun = req.query.dryRun === "true";

    const pl = await prisma.priceList.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });
    if (!pl) {
      return res.status(404).json({ message: "Planilla no encontrada" });
    }

    const entries = await prisma.priceListEntry.findMany({
      where: { section: { priceListId: id } },
      select: { id: true, productId: true, name: true, suggestedPrice: true },
    });

    const excluded = new Set(excludeEntryIds);
    const overrideByEntry = new Map(
      entryOverrides.map((o) => [o.entryId, o.suggestedPrice]),
    );
    const pct = percentage ?? 0;

    const rows: AdjustRow[] = entries
      .filter((e) => !excluded.has(e.id))
      .map((e) => {
        const current = Number(e.suggestedPrice ?? 0);
        const next = overrideByEntry.has(e.id)
          ? round2(overrideByEntry.get(e.id)!)
          : round2(current * (1 + pct / 100));
        return {
          entryId: e.id,
          name: e.name,
          productId: e.productId,
          suggestedPrice: current,
          newSuggestedPrice: next,
          delta: round2(next - current),
        };
      });

    const affected = rows.length;
    const previousTotal = round2(rows.reduce((s, r) => s + r.suggestedPrice, 0));
    const newTotal = round2(rows.reduce((s, r) => s + r.newSuggestedPrice, 0));

    if (!dryRun) {
      await prisma.$transaction(async (tx) => {
        for (const r of rows) {
          await tx.priceListEntry.updateMany({
            where: { id: r.entryId },
            data: { suggestedPrice: r.newSuggestedPrice },
          });
          if (r.productId) {
            await tx.product.updateMany({
              where: { id: r.productId },
              data: { suggestedPrice: r.newSuggestedPrice },
            });
          }
        }
      });
      return res.status(200).json({ affected, previousTotal, newTotal });
    }

    return res.status(200).json({ affected, previousTotal, newTotal, rows });
  } catch (error: any) {
    console.error("Error ajustando planilla:", error);
    return res.status(500).json({ message: "Error al ajustar la planilla" });
  }
};

const priceListController = {
  importPriceList,
  applyPriceList,
  listPriceLists,
  getPriceList,
  adjustPriceList,
};
export default priceListController;

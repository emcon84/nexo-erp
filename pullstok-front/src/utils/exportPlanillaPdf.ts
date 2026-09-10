/**
 * Generación de la planilla mayorista en PDF con jsPDF + autoTable (texto real,
 * buscable). Usa los helpers compartidos de planillaGroups para que el diseño
 * (seco/húmedo → marca → talla → razas) sea idéntico al de la actualización.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { PriceListDetail } from "@/services/priceLists";
import { groupByPdfHierarchy } from "@/lib/printGrouping";
import orgLogoUrl from "@/assets/logo-horizontal-almacen.png";
import {
  formatPrice,
  redondearPrecio,
  esHumedito,
  normalizeLine,
  displayName,
  isNonFood,
  tallaOf,
  razasOf,
  TALLA_COLORS,
  RAZAS_COLORS,
  BRAND_COLORS,
} from "./planillaGroups";

/** Precio mayorista = sin IVA + 21% (IVA) + 15% de ganancia (todos). La base
 * para la actualización masiva NO lleva el 15% (se guarda aparte). */
const precioMayorista = (sinIva: number | null | undefined): number | null =>
  sinIva == null ? null : redondearPrecio(Math.round(sinIva * 1.21 * 1.15 * 100) / 100);

/** Margen al público: el Sugerido se deriva del Precio mayorista × este factor. */
const SUGERIDO_FACTOR = 1.3334;

/** Sugerido = Precio mayorista (con el +15%) × margen al público. */
const publico = (sinIva: number | null | undefined): number | null => {
  const mayorista = precioMayorista(sinIva);
  return mayorista == null ? null : redondearPrecio(Math.round(mayorista * SUGERIDO_FACTOR * 100) / 100);
};

/** Carga un asset local como data URL + tamaño natural (para no deformar). */
const loadLogo = async (
  url: string,
): Promise<{ dataUrl: string; width: number; height: number } | null> => {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    const dataUrl = await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
    if (!dataUrl) return null;
    const img = new Image();
    img.src = dataUrl;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("logo"));
    });
    return { dataUrl, width: img.naturalWidth, height: img.naturalHeight };
  } catch {
    return null;
  }
};

const ROW_STYLES = { fontSize: 8.5, cellPadding: 2.5, textColor: [0, 0, 0] as [number, number, number] };

export interface GroupRow {
  content: string | number;
  colSpan?: number;
  rowSpan?: number;
  label?: string;
  styles?: Record<string, unknown>;
}

/** Arma el body de autoTable: SECO/HÚMEDO → marca → talla → razas → productos. */
const buildBody = (plan: PriceListDetail): (string | GroupRow)[][] => {
  const sections = groupByPdfHierarchy(
    plan.sections.map((s) => ({ ...s, line: normalizeLine(s.line) })),
  ).filter((s) => !/^IVA$/i.test(s.subline ?? ""));

  const seco = sections
    .map((s) => ({
      ...s,
      entries: s.entries.filter((e) => !esHumedito(e.name) && !isNonFood(e.name, e.unit)),
    }))
    .filter((s) => s.entries.length > 0);
  const humedo = sections
    .map((s) => ({
      ...s,
      entries: s.entries.filter((e) => esHumedito(e.name) && !isNonFood(e.name, e.unit)),
    }))
    .filter((s) => s.entries.length > 0);

  const body: (string | GroupRow)[][] = [];

  const pushBlock = (label: string, list: typeof sections) => {
    if (list.length === 0) return;
    body.push([{ content: label, colSpan: 4, styles: { fontSize: 11, fontStyle: "bold", fillColor: [17, 24, 39], textColor: [255, 255, 255], cellPadding: 4 } }]);

    const products = list.flatMap((s) =>
      s.entries.map((e) => ({
        e,
        brand: s.brand ?? "Sin marca",
        talla: tallaOf(s.line),
        razas: razasOf(e.name, s.subline),
      })),
    );

    const byBrand = new Map<string, typeof products>();
    for (const p of products) {
      if (!byBrand.has(p.brand)) byBrand.set(p.brand, []);
      byBrand.get(p.brand)!.push(p);
    }

    for (const [brand, prods] of byBrand) {
      const bColor = BRAND_COLORS[brand.toUpperCase()] ?? [30, 41, 59];
      body.push([{ content: brand, colSpan: 4, styles: { fontSize: 10.5, fontStyle: "bold", fillColor: bColor, textColor: [255, 255, 255], cellPadding: 4 } }]);
      const byTalla = new Map<string, typeof prods>();
      for (const p of prods) {
        if (!byTalla.has(p.talla)) byTalla.set(p.talla, []);
        byTalla.get(p.talla)!.push(p);
      }
      for (const [talla, tp] of byTalla) {
        const tColor = TALLA_COLORS[talla] ?? [30, 41, 59];
        body.push([{ content: talla || brand, colSpan: 4, styles: { fontSize: 9.5, fontStyle: "bold", fillColor: tColor, textColor: [255, 255, 255], cellPadding: 3.5 } }]);
        const byRazas = new Map<string | null, typeof tp>();
        for (const p of tp) {
          const k = p.razas;
          if (!byRazas.has(k)) byRazas.set(k, []);
          byRazas.get(k)!.push(p);
        }
        for (const [razas, rp] of byRazas) {
          if (razas) {
            const rColor = RAZAS_COLORS[razas] ?? [100, 116, 139];
            body.push([{ content: razas, colSpan: 4, styles: { fontSize: 8.5, fontStyle: "bold", fillColor: rColor, textColor: [255, 255, 255], cellPadding: 3 } }]);
          }
          for (const p of rp) {
            body.push([
              displayName(p.e.name, p.brand),
              p.e.unit ?? "-",
              formatPrice(precioMayorista(p.e.priceSinIva)),
              formatPrice(publico(p.e.priceSinIva)),
            ] as unknown as GroupRow[]);
          }
        }
      }
    }
  };

  pushBlock("ALIMENTO SECO", seco);
  pushBlock("ALIMENTO HÚMEDO", humedo);
  return body;
};

/** Genera y descarga el PDF de la planilla mayorista. */
export const exportPlanillaPdf = async (plan: PriceListDetail): Promise<string | null> => {
  const body = buildBody(plan);
  if (body.length === 0) return null;

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 30;
  const pageW = doc.internal.pageSize.getWidth();
  let y = 40;

  const logo = await loadLogo(orgLogoUrl);
  if (logo) {
    const logoW = 130;
    const logoH = (logoW * logo.height) / logo.width;
    doc.addImage(logo.dataUrl, "PNG", margin, y, logoW, logoH);
  }
  const rightX = pageW - margin;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Planilla mayorista", rightX, y + 20, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`${plan.type} · ${plan.sections.length} secciones`, rightX, y + 31, { align: "right" });
  y += 52;

  autoTable(doc, {
    startY: y,
    head: [["Descripción", "Kg x U.", "Precio", "Sugerido"]],
    body: body as never,
    margin: { left: margin, right: margin, top: margin, bottom: 24 },
    styles: { ...ROW_STYLES, cellPadding: 2.5, lineColor: [0, 0, 0], lineWidth: 0.15 },
    headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: "bold", fontSize: 9, halign: "left" },
    columnStyles: {
      1: { halign: "right", cellWidth: 46 },
      2: { halign: "right", cellWidth: 60 },
      3: { halign: "right", cellWidth: 60 },
    },
    theme: "grid",
  });

  const filename = `planilla_mayorista_${plan.type}_${plan.period ?? "s/f"}.pdf`;
  doc.save(filename);
  return filename;
};

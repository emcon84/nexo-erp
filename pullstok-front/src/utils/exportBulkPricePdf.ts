/**
 * Generación del PDF del listado de la actualización masiva (vista previa) con
 * jsPDF + autoTable, con EL MISMO diseño que la planilla mayorista:
 * SECO/HÚMEDO → marca → talla → razas, bandas de color, texto real (buscable).
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { BulkPricePreviewRow } from "@/services/productService";
import orgLogoUrl from "@/assets/logo-horizontal-almacen.png";
import { GroupRow } from "./exportPlanillaPdf";
import {
  formatPrice,
  esHumedito,
  displayName,
  normalizeLine,
  tallaOf,
  tallaFromName,
  lineFromName,
  razasOf,
  isNonFood,
  TALLA_COLORS,
  RAZAS_COLORS,
  BRAND_COLORS,
} from "./planillaGroups";

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

/** Arma el body: SECO/HÚMEDO → marca → talla → razas → productos (con precios). */
const buildBody = (rows: BulkPricePreviewRow[]): (string | GroupRow)[][] => {
  // cada fila con su marca/talla/razas desde la SECCIÓN de planilla (igual que
  // la mayorista); si no hay sección, se deriva del nombre. Se excluyen los
  // productos no-alimento (limpieza, piedra sanitaria) y se normaliza la marca
  // a mayúsculas para que "Royal Canin" y "ROYAL CANIN" se fusionen.
  const withGroups = rows
    .filter((r) => !isNonFood(r.name, null))
    .map((r) => ({
      r,
      brand: (() => {
        const raw =
          r.brand?.trim() ||
          (r.brandValues?.join(", ") || "Sin marca").trim() ||
          "Sin marca";
        return raw === "Sin marca" ? "Sin marca" : raw.toUpperCase();
      })(),
      talla:
        tallaOf(normalizeLine(r.line ?? null)) ||
        lineFromName(r.name) ||
        tallaFromName(r.name) ||
        "",
      razas: razasOf(r.name, r.subline ?? null),
      humedo: esHumedito(r.name),
    }));

  const body: (string | GroupRow)[][] = [];

  const pushBlock = (label: string, list: typeof withGroups) => {
    if (list.length === 0) return;
    body.push([{ content: label, colSpan: 2, styles: { fontSize: 11, fontStyle: "bold", fillColor: [17, 24, 39], textColor: [255, 255, 255], cellPadding: 4 } }]);

    const byBrand = new Map<string, typeof list>();
    for (const p of list) {
      if (!byBrand.has(p.brand)) byBrand.set(p.brand, []);
      byBrand.get(p.brand)!.push(p);
    }
    for (const [brand, prods] of byBrand) {
      const bColor = BRAND_COLORS[brand.toUpperCase()] ?? [30, 41, 59];
      body.push([{ content: brand, colSpan: 2, styles: { fontSize: 10.5, fontStyle: "bold", fillColor: bColor, textColor: [255, 255, 255], cellPadding: 4 } }]);
      const byTalla = new Map<string, typeof prods>();
      for (const p of prods) {
        if (!byTalla.has(p.talla)) byTalla.set(p.talla, []);
        byTalla.get(p.talla)!.push(p);
      }
      for (const [talla, tp] of byTalla) {
        if (talla) {
          const tColor = TALLA_COLORS[talla] ?? [30, 41, 59];
          body.push([{ content: talla, colSpan: 2, styles: { fontSize: 9.5, fontStyle: "bold", fillColor: tColor, textColor: [255, 255, 255], cellPadding: 3.5 } }]);
        }
        const byRazas = new Map<string | null, typeof tp>();
        for (const p of tp) {
          const k = p.razas;
          if (!byRazas.has(k)) byRazas.set(k, []);
          byRazas.get(k)!.push(p);
        }
        for (const [razas, rp] of byRazas) {
          if (razas) {
            const rColor = RAZAS_COLORS[razas] ?? [100, 116, 139];
            body.push([{ content: razas, colSpan: 2, styles: { fontSize: 8.5, fontStyle: "bold", fillColor: rColor, textColor: [255, 255, 255], cellPadding: 3 } }]);
          }
          for (const p of rp) {
            body.push([
              displayName(p.r.name, p.brand),
              formatPrice(p.r.newPrice),
            ] as unknown as GroupRow[]);
          }
        }
      }
    }
  };

  pushBlock("ALIMENTO SECO", withGroups.filter((p) => !p.humedo));
  pushBlock("ALIMENTO HÚMEDO", withGroups.filter((p) => p.humedo));
  return body;
};

/** Genera y descarga el PDF del listado de precios actualizados. */
export const exportBulkPricePdf = async (
  rows: BulkPricePreviewRow[],
): Promise<string | null> => {
  const body = buildBody(rows);
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
  doc.text("Actualización masiva de precios", rightX, y + 20, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`${new Date().toLocaleDateString("es-AR")} · ${rows.length} productos`, rightX, y + 31, { align: "right" });
  y += 52;

  autoTable(doc, {
    startY: y,
    head: [["Producto", "Precio"]],
    body: body as never,
    margin: { left: margin, right: margin, top: margin, bottom: 24 },
    styles: { ...ROW_STYLES, cellPadding: 2.5, lineColor: [0, 0, 0], lineWidth: 0.15 },
    headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: "bold", fontSize: 9, halign: "left" },
    columnStyles: {
      1: { halign: "right", cellWidth: 70 },
    },
    theme: "grid",
  });

  const filename = `actualizacion_precios_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
  return filename;
};

/**
 * Generación del PDF del listado de precios actualizados (vista previa de la
 * actualización masiva) con jsPDF + autoTable: PDF con TEXTO real (buscable),
 * agrupado por marca, columnas Producto | Precio.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { BulkPricePreviewRow } from "@/services/productService";
import orgLogoUrl from "@/assets/logo-horizontal-almacen.png";

const formatPrice = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "-"
    : `$${Number(n).toLocaleString("es-AR", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      })}`;

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

/**
 * Genera y descarga el PDF del listado de precios actualizados.
 * Devuelve el nombre del archivo, o null si no hay filas.
 */
export const exportBulkPricePdf = async (
  rows: BulkPricePreviewRow[],
): Promise<string | null> => {
  if (rows.length === 0) return null;

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 30;
  const pageW = doc.internal.pageSize.getWidth();
  let y = 40;

  // Logo (izquierda, sin deformar) + título (derecha) — sin "mayorista".
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

  // Agrupar por marca.
  const byBrand = new Map<string, BulkPricePreviewRow[]>();
  for (const row of rows) {
    const b = (row.brandValues?.join(", ") || "Sin marca").trim() || "Sin marca";
    if (!byBrand.has(b)) byBrand.set(b, []);
    byBrand.get(b)!.push(row);
  }
  const body: (string | { content: string; colSpan: number; styles: Record<string, unknown> })[][] = [];
  for (const [brand, items] of byBrand) {
    body.push([{
      content: brand,
      colSpan: 2,
      styles: { fontSize: 10, fontStyle: "bold", fillColor: [17, 24, 39], textColor: [255, 255, 255], cellPadding: 4 },
    }]);
    for (const it of items) {
      body.push([it.name, formatPrice(it.newPrice)]);
    }
  }

  autoTable(doc, {
    startY: y,
    head: [["Producto", "Precio"]],
    body: body as never,
    margin: { left: margin, right: margin, top: margin, bottom: 24 },
    styles: { fontSize: 8.5, cellPadding: 2.5, textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.15 },
    headStyles: { fillColor: [229, 231, 235], textColor: [0, 0, 0], fontStyle: "bold", fontSize: 9, halign: "left" },
    columnStyles: {
      1: { halign: "right", cellWidth: 80 },
    },
    theme: "grid",
  });

  const filename = `actualizacion_precios_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
  return filename;
};

/**
 * Generación de la planilla mayorista en PDF con jsPDF + autoTable.
 * A diferencia del print del navegador (que rasteriza a imágenes), acá se
 * dibuja TEXTO REAL: el PDF se puede buscar/seleccionar y la paginación la
 * maneja autoTable (compacta, sin páginas en blanco).
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { PriceListDetail } from "@/services/priceLists";
import { groupByPdfHierarchy } from "@/lib/printGrouping";
import orgLogoUrl from "@/assets/logo-horizontal-almacen.png";

const formatPrice = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "-"
    : `$${Number(n).toLocaleString("es-AR", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      })}`;

const redondearPrecio = (n: number | null | undefined): number | null =>
  n == null ? null : n >= 500 ? Math.round(n / 100) * 100 : n;

const precioMayorista = (sinIva: number | null | undefined): number | null =>
  sinIva == null ? null : redondearPrecio(Math.round(sinIva * 1.21 * 100) / 100);

const headerParts = (
  brand: string | null | undefined,
  line: string | null | undefined,
  subline: string | null | undefined,
): string[] => {
  const raw = [brand, line, subline].filter(Boolean) as string[];
  return raw.filter((p, i) => i === 0 || p !== raw[i - 1]);
};

const esHumedito = (nombre: string): boolean =>
  /\b(WET|HÚMEDO|HUMEDO|POUCH|LATA|LÍQUIDO|LIQUID|MOUSSE)\b/i.test(nombre);

const normalizeLine = (line: string | null): string | null => {
  if (!line) return line;
  const l = line.trim().toUpperCase();
  if (/^ADULTO$/i.test(l)) return "ADULT";
  if (/^GATOADULTO$/i.test(l)) return "GATO ADULTO";
  if (/^CACHORRO$/i.test(l)) return "CACHORROS";
  return line;
};

const LEAK_PREFIX =
  /^(?:RAZAS?\s+(?:PEQUEÑAS|PEQUENAS|MEDIANAS|GRANDES)|ADULTOS?|CACHORROS?|SENIOR|PUPPY|KITTEN|HÚMEDO|HUMEDO)\s+/i;

const displayName = (nombre: string, brand: string | null | undefined): string => {
  let n = nombre.replace(LEAK_PREFIX, "");
  n = n.replace(/^\d{5,8}\s+/, "");
  n = n.replace(/^[A-Z]{2}\d{2,3}[A-Z]?\s+/, "");
  if (brand && !n.toUpperCase().startsWith(brand.toUpperCase())) {
    n = `${brand} ${n}`;
  }
  return n.replace(/\s+/g, " ").trim();
};

/** Carga un asset local como data URL (jsPDF.addImage necesita data URL). */
const loadLogoDataUrl = async (url: string): Promise<string | null> => {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
};

const ROW_STYLES = { fontSize: 8.5, cellPadding: 2.5, textColor: [0, 0, 0] as [number, number, number] };

interface GroupRow {
  content: string | number;
  colSpan?: number;
  styles?: Record<string, unknown>;
}

/** Arma el body de autoTable a partir de las secciones (seco/húmedo → marca →
 * sección band + productos), con grupos de fila a lo ancho tipo banda. */
const buildBody = (plan: PriceListDetail): GroupRow[][] => {
  const sections = groupByPdfHierarchy(
    plan.sections.map((s) => ({ ...s, line: normalizeLine(s.line) })),
  ).filter((s) => !/^IVA$/i.test(s.subline ?? ""));

  const seco = sections
    .map((s) => ({ ...s, entries: s.entries.filter((e) => !esHumedito(e.name)) }))
    .filter((s) => s.entries.length > 0);
  const humedo = sections
    .map((s) => ({ ...s, entries: s.entries.filter((e) => esHumedito(e.name)) }))
    .filter((s) => s.entries.length > 0);

  const body: GroupRow[][] = [];
  const pushBlock = (label: string, list: typeof sections) => {
    if (list.length === 0) return;
    body.push([{ content: label, colSpan: 4, styles: { fontSize: 11, fontStyle: "bold", fillColor: [17, 24, 39], textColor: [255, 255, 255], cellPadding: 4 } }]);
    // agrupar por marca
    const byBrand = new Map<string, typeof list>();
    for (const s of list) {
      const b = s.brand ?? "Sin marca";
      if (!byBrand.has(b)) byBrand.set(b, []);
      byBrand.get(b)!.push(s);
    }
    for (const [brand, secs] of byBrand) {
      body.push([{ content: brand, colSpan: 4, styles: { fontSize: 10, fontStyle: "bold", fillColor: [229, 231, 235], textColor: [0, 0, 0], cellPadding: 3.5 } }]);
      for (const section of secs) {
        const band = headerParts(section.brand, section.line, section.subline)
          .filter((p) => p !== brand)
          .join(" · ");
        if (band) {
          body.push([{ content: band, colSpan: 4, styles: { fontSize: 8.5, fontStyle: "bold", fillColor: [243, 244, 246], textColor: [0, 0, 0], cellPadding: 3 } }]);
        }
        for (const entry of section.entries) {
          body.push([
            displayName(entry.name, section.brand),
            entry.unit ?? "-",
            formatPrice(precioMayorista(entry.priceSinIva)),
            formatPrice(redondearPrecio(entry.suggestedPrice)),
          ] as unknown as GroupRow[]);
        }
      }
    }
  };

  pushBlock("ALIMENTO SECO", seco);
  pushBlock("ALIMENTO HÚMEDO", humedo);
  return body;
};

/**
 * Genera y descarga el PDF de la planilla mayorista. Devuelve el nombre del
 * archivo generado (o null si no hay contenido).
 */
export const exportPlanillaPdf = async (plan: PriceListDetail): Promise<string | null> => {
  const body = buildBody(plan);
  if (body.length === 0) return null;

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 30;
  let y = 40;

  // Logo horizontal + título
  const logo = await loadLogoDataUrl(orgLogoUrl);
  if (logo) {
    doc.addImage(logo, "PNG", margin, y, 130, 42);
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Planilla mayorista", margin + (logo ? 140 : 0), y + 20);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`${plan.type} · ${plan.sections.length} secciones`, margin + (logo ? 140 : 0), y + 31);
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

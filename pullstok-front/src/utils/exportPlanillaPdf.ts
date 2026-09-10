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

/** Productos NO alimento (limpieza, piedra sanitaria, ambientadores...) que
 * vienen en la planilla pero no deben estar en la lista mayorista de alimento. */
const NON_FOOD =
  /\b(CITRICA|LAVANDA|MARINA|NEUTRA|LIMÓN|LIMON|MANZANA|ROSAS|MONKCAT|BENTONITA|SÍLICA|SILICA|PIEDRAS SANITARIAS|ARENA)\b/i;

const isNonFood = (nombre: string, unit: string | null): boolean =>
  NON_FOOD.test(nombre) || /^\d+([.,]\d+)?\s*[lL]$/.test(unit ?? ""); // litros → no alimento

/** Carga un asset local como data URL y devuelve su data URL + tamaño natural,
 * para dibujarlo SIN deformar (respetando su proporción real). */
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

interface GroupRow {
  content: string | number;
  colSpan?: number;
  rowSpan?: number;
  label?: string;
  styles?: Record<string, unknown>;
}

/** Arma el body de autoTable con el diseño del proveedor: columna GAMA (marca)
 * y columna TIPO (razas) combinadas verticalmente (rowSpan) y rotuladas en
 * vertical; luego Descripción/Kg/Precio/Sugerido. */
const buildBody = (plan: PriceListDetail): (string | GroupRow)[][] => {
  const sections = groupByPdfHierarchy(
    plan.sections.map((s) => ({ ...s, line: normalizeLine(s.line) })),
  ).filter((s) => !/^IVA$/i.test(s.subline ?? ""));

  /** Razas (Pequeñas/Medianas/Grandes) derivadas del nombre o sublínea. */
  const razasOf = (nombre: string, subline: string | null): string | null => {
    const n = nombre.toUpperCase();
    const s = (subline ?? "").toUpperCase();
    if (/\b(MINI|X-SMALL|X SMALL|SMALL BREED)\b/.test(n) || /PEQUEÑA|PEQUENA|SMALL|MINI/.test(s)) return "RAZAS PEQUEÑAS";
    if (/\b(MEDIUM BREED)\b/.test(n) || /MEDIANA|MEDIUM/.test(s)) return "RAZAS MEDIANAS";
    if (/\b(LARGE BREED|MAXI|GIANT)\b/.test(n) || /GRANDE|MAXI|LARGE/.test(s)) return "RAZAS GRANDES";
    return null;
  };

  const RAZAS_COLORS: Record<string, [number, number, number]> = {
    "RAZAS PEQUEÑAS": [107, 33, 168],
    "RAZAS MEDIANAS": [180, 83, 9],
    "RAZAS GRANDES": [14, 116, 144],
  };
  const BRAND_COLORS: Record<string, [number, number, number]> = {
    EUKANUBA: [16, 122, 87],
    "ROYAL CANIN": [157, 23, 77],
    MONKCAT: [146, 64, 14],
    WIPUP: [2, 132, 199],
    ASADITOS: [190, 24, 93],
  };

  const products = sections.flatMap((s) =>
    s.entries
      .filter((e) => !isNonFood(e.name, e.unit))
      .map((e) => ({ e, brand: s.brand ?? "Sin marca", razas: razasOf(e.name, s.subline) })),
  );

  const rows: (string | GroupRow)[][] = [];
  const byBrand = new Map<string, typeof products>();
  for (const p of products) {
    if (!byBrand.has(p.brand)) byBrand.set(p.brand, []);
    byBrand.get(p.brand)!.push(p);
  }

  for (const [brand, prods] of byBrand) {
    const brandStart = rows.length;
    const byRazas = new Map<string | null, typeof prods>();
    for (const p of prods) {
      const k = p.razas;
      if (!byRazas.has(k)) byRazas.set(k, []);
      byRazas.get(k)!.push(p);
    }
    for (const [razas, rp] of byRazas) {
      const rCount = rp.length;
      rp.forEach((p, i) => {
        const row: (string | GroupRow)[] = [
          "", // GAMA (se completa abajo con rowSpan)
          "", // TIPO (se completa abajo con rowSpan)
          displayName(p.e.name, p.brand),
          p.e.unit ?? "-",
          formatPrice(precioMayorista(p.e.priceSinIva)),
          formatPrice(redondearPrecio(p.e.suggestedPrice)),
        ];
        if (i === 0 && razas) {
          row[1] = {
            content: "",
            rowSpan: rCount,
            label: razas,
            styles: { fillColor: RAZAS_COLORS[razas] ?? [100, 116, 139], valign: "middle" },
          };
        }
        rows.push(row);
      });
    }
    rows[brandStart][0] = {
      content: "",
      rowSpan: rows.length - brandStart,
      label: brand,
      styles: { fillColor: BRAND_COLORS[brand] ?? [30, 41, 59], valign: "middle" },
    };
  }
  return rows;
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
  const pageW = doc.internal.pageSize.getWidth();
  let y = 40;

  // Logo horizontal a la IZQUIERDA (sin deformar); título/sublítulo a la DERECHA
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
    head: [["GAMA", "TIPO", "Descripción", "KG", "Precio", "Sugerido"]],
    body: body as never,
    margin: { left: margin, right: margin, top: margin, bottom: 24 },
    styles: { ...ROW_STYLES, cellPadding: 2.5, lineColor: [0, 0, 0], lineWidth: 0.15 },
    headStyles: { fillColor: [229, 231, 235], textColor: [0, 0, 0], fontStyle: "bold", fontSize: 8.5, halign: "center" },
    columnStyles: {
      0: { cellWidth: 22, halign: "center", valign: "middle" },
      1: { cellWidth: 22, halign: "center", valign: "middle" },
      3: { halign: "center", cellWidth: 34 },
      4: { halign: "right", cellWidth: 62 },
      5: { halign: "right", cellWidth: 62 },
    },
    didDrawCell: (data: {
      section: string;
      column: { index: number };
      cell: { raw: unknown; x: number; y: number; width: number; height: number };
    }) => {
      // Rótulo vertical de GAMA/TIPO en la celda combinada (rowSpan).
      if (data.section !== "body") return;
      if (data.column.index !== 0 && data.column.index !== 1) return;
      const raw = data.cell.raw as { label?: string; rowSpan?: number } | undefined;
      if (!raw || !raw.label || !raw.rowSpan) return;
      const { x, y: cy, width, height } = data.cell;
      const centerX = x + width / 2;
      const centerY = cy + height / 2;
      const gs = doc as unknown as { saveGraphicsState(): void; restoreGraphicsState(): void };
      gs.saveGraphicsState();
      doc.setFont("helvetica", "bold");
      doc.setFontSize(data.column.index === 0 ? 9 : 8);
      doc.setTextColor(255, 255, 255);
      // Rota el texto 90° alrededor del centro de la celda combinada.
      doc.text(raw.label, centerX, centerY, {
        angle: 90,
        align: "center",
        baseline: "middle",
      });
      gs.restoreGraphicsState();
    },
    theme: "grid",
  });

  const filename = `planilla_mayorista_${plan.type}_${plan.period ?? "s/f"}.pdf`;
  doc.save(filename);
  return filename;
};

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

interface RowWithGroups {
  r: BulkPricePreviewRow;
  brand: string;
  levels: string[];
  humedo: boolean;
}

/** ¿Es alimento MEDICADO/veterinario? (se agrupa aparte de PERRO/GATO). */
const MEDICADO_KEYWORDS =
  /\b(VETERINARY|HYPOALLERGENIC|ANALLERGENIC|RENAL|GASTRO|HEPATIC|URINARY|DIABETIC|CARDIAC|MOBILITY|SATIETY|RECOVERY|FIBRE|CALM|WEIGHT CONTROL|DERMATO|NEUTERED|MATURE)\b/i;
const esMedicado = (nombre: string): boolean => MEDICADO_KEYWORDS.test(nombre);

/** ¿Es alimento de PERRO (no medicado)? */
const esPerro = (nombre: string): boolean =>
  !esMedicado(nombre) && /\b(CANINE|DOG|PERRO)\b/.test(nombre);

/** ¿Es alimento de GATO (no medicado)? */
const esGato = (nombre: string): boolean =>
  !esMedicado(nombre) &&
  /\b(CAT|GATO|FELINE|KITTEN|BABYCAT|INDOOR|PERSIAN|SIAMESE|EXIGENT|SENSIBLE|LONGHAIR|POUCH|LATA|MOUSSE)\b/.test(nombre);

/** Etapa (CACHORRO/ADULTO/GATITO/SENIOR). */
const etapa = (nombre: string): string => {
  const n = (nombre ?? "").toUpperCase();
  if (/\bPUPPY\b/.test(n)) return "CACHORRO";
  if (/\bKITTEN\b/.test(n)) return "GATITO";
  if (/\bADULT\b|\bADULTO\b/.test(n)) return "ADULTO";
  if (/\bSENIOR\b/.test(n)) return "SENIOR";
  return "";
};

/** Tamaño (PEQ/MED/GRANDE). */
const tamano = (nombre: string): string => {
  const n = (nombre ?? "").toUpperCase();
  if (/\b(SMALL BREED|SMALL\b|MINI|X-SMALL)\b/.test(n)) return "PEQ";
  if (/\b(MEDIUM BREED|MEDIUM\b)\b/.test(n)) return "MED";
  if (/\b(LARGE BREED|MAXI|GIANT)\b/.test(n)) return "GRANDE";
  return "";
};

/** Determina los niveles de agrupación (marca → cat → etapa → tamaño). */
const levelsOf = (nombre: string): string[] => {
  if (esMedicado(nombre)) return ["MEDICADOS", "", ""];
  if (esPerro(nombre)) return ["PERRO", etapa(nombre), tamano(nombre)];
  if (esGato(nombre)) return ["GATO", etapa(nombre), tamano(nombre)];
  return ["OTROS", "", ""];
};

/** Arma el body: SECO/HÚMEDO → marca → PERRO/GATO/MEDICADOS → etapa → tamaño. */
const buildBody = (rows: BulkPricePreviewRow[]): (string | GroupRow)[][] => {
  const withGroups: RowWithGroups[] = rows
    .filter((r) => !isNonFood(r.name, null))
    .map((r) => {
      const brand = (() => {
        const raw =
          r.brand?.trim() ||
          (r.brandValues?.join(", ") || "Sin marca").trim() ||
          "Sin marca";
        return raw === "Sin marca" ? "Sin marca" : raw.toUpperCase();
      })();
      const levels = levelsOf(r.name);
      return { r, brand, levels, humedo: esHumedito(r.name) };
    });

  const body: (string | GroupRow)[][] = [];
  const LEVEL_COLORS: Record<string, [number, number, number]> = {
    ...TALLA_COLORS,
    ...RAZAS_COLORS,
    PERRO: [17, 24, 39],
    GATO: [126, 34, 206],
    MEDICADOS: [146, 64, 14],
    OTROS: [100, 116, 139],
    CACHORRO: [88, 28, 135],
    GATITO: [88, 28, 135],
    ADULTO: [17, 24, 39],
    SENIOR: [30, 58, 138],
    PEQ: [107, 33, 168],
    MED: [180, 83, 9],
    GRANDE: [14, 116, 144],
  };

  const pushLevels = (items: RowWithGroups[], levelIdx: number) => {
    const by = new Map<string, RowWithGroups[]>();
    for (const p of items) {
      const k = p.levels[levelIdx] ?? "";
      if (!by.has(k)) by.set(k, []);
      by.get(k)!.push(p);
    }
    for (const [k, sub] of by) {
      if (k) {
        body.push([{
          content: k,
          colSpan: 2,
          styles: {
            fontSize: levelIdx === 0 ? 9.5 : 8.5,
            fontStyle: "bold",
            fillColor: LEVEL_COLORS[k] ?? [100, 116, 139],
            textColor: [255, 255, 255],
            cellPadding: levelIdx === 0 ? 3.5 : 3,
          },
        }]);
      }
      if (levelIdx < 2) {
        pushLevels(sub, levelIdx + 1);
      } else {
        for (const p of sub) {
          body.push([
            displayName(p.r.name, p.brand),
            formatPrice(p.r.newPrice),
          ] as unknown as GroupRow[]);
        }
      }
    }
  };

  const pushBlock = (label: string, list: RowWithGroups[]) => {
    if (list.length === 0) return;
    body.push([{ content: label, colSpan: 2, styles: { fontSize: 11, fontStyle: "bold", fillColor: [17, 24, 39], textColor: [255, 255, 255], cellPadding: 4 } }]);

    const byBrand = new Map<string, RowWithGroups[]>();
    for (const p of list) {
      if (!byBrand.has(p.brand)) byBrand.set(p.brand, []);
      byBrand.get(p.brand)!.push(p);
    }
    for (const [brand, prods] of byBrand) {
      const bColor = BRAND_COLORS[brand.toUpperCase()] ?? [30, 41, 59];
      body.push([{ content: brand, colSpan: 2, styles: { fontSize: 10.5, fontStyle: "bold", fillColor: bColor, textColor: [255, 255, 255], cellPadding: 4 } }]);
      pushLevels(prods, 0);
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
  doc.text("Precios", rightX, y + 20, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(new Date().toLocaleDateString("es-AR"), rightX, y + 31, { align: "right" });
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

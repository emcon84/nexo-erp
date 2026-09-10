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

  /** TALLA / etapa (línea normalizada) en el rotulado del proveedor. */
  const tallaOf = (line: string | null): string => {
    const l = (line ?? "").toUpperCase();
    if (l === "PUPPY") return "CACHORROS";
    if (l === "ADULT") return "ADULTOS";
    if (l === "KITTEN") return "GATOS";
    if (l === "SENIOR") return "SENIOR";
    return line ?? "";
  };

  /** Razas (Pequeñas/Medianas/Grandes) derivadas del nombre o sublínea. */
  const razasOf = (nombre: string, subline: string | null): string | null => {
    const n = nombre.toUpperCase();
    const s = (subline ?? "").toUpperCase();
    if (/\b(MINI|X-SMALL|X SMALL|SMALL BREED)\b/.test(n) || /PEQUEÑA|PEQUENA|SMALL|MINI/.test(s)) return "RAZAS PEQUEÑAS";
    if (/\b(MEDIUM BREED)\b/.test(n) || /MEDIANA|MEDIUM/.test(s)) return "RAZAS MEDIANAS";
    if (/\b(LARGE BREED|MAXI|GIANT)\b/.test(n) || /GRANDE|MAXI|LARGE/.test(s)) return "RAZAS GRANDES";
    return null;
  };

  // Talla + razas con su color (parecido al proveedor: morado/ámbar/cian).
  const TALLA_COLORS: Record<string, [number, number, number]> = {
    CACHORROS: [88, 28, 135],
    ADULTOS: [17, 24, 39],
    SENIOR: [30, 58, 138],
    GATOS: [126, 34, 206],
  };
  const RAZAS_COLORS: Record<string, [number, number, number]> = {
    "RAZAS PEQUEÑAS": [107, 33, 168],
    "RAZAS MEDIANAS": [180, 83, 9],
    "RAZAS GRANDES": [14, 116, 144],
  };

  const pushBlock = (label: string, list: typeof sections) => {
    if (list.length === 0) return;
    body.push([{ content: label, colSpan: 4, styles: { fontSize: 11, fontStyle: "bold", fillColor: [17, 24, 39], textColor: [255, 255, 255], cellPadding: 4 } }]);

    // Aplanar productos con su marca/talla/razas.
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
      body.push([{ content: brand, colSpan: 4, styles: { fontSize: 10, fontStyle: "bold", fillColor: [229, 231, 235], textColor: [0, 0, 0], cellPadding: 3.5 } }]);
      // agrupar por talla (línea)
      const byTalla = new Map<string, typeof prods>();
      for (const p of prods) {
        if (!byTalla.has(p.talla)) byTalla.set(p.talla, []);
        byTalla.get(p.talla)!.push(p);
      }
      for (const [talla, tp] of byTalla) {
        const tColor = TALLA_COLORS[talla] ?? [30, 41, 59];
        body.push([{ content: talla || brand, colSpan: 4, styles: { fontSize: 9.5, fontStyle: "bold", fillColor: tColor, textColor: [255, 255, 255], cellPadding: 3.5 } }]);
        // agrupar por razas
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
              formatPrice(redondearPrecio(p.e.suggestedPrice)),
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

  // Logo horizontal (izquierda, sin deformar) + título (derecha)
  const logo = await loadLogo(orgLogoUrl);
  const textX = margin + (logo ? 150 : 0);
  if (logo) {
    const logoW = 130;
    const logoH = (logoW * logo.height) / logo.width;
    doc.addImage(logo.dataUrl, "PNG", margin, y, logoW, logoH);
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Planilla mayorista", textX, y + 20);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`${plan.type} · ${plan.sections.length} secciones`, textX, y + 31);
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

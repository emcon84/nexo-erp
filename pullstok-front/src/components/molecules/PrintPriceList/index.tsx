import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PriceListDetail } from "@/services/priceLists";
import { groupByPdfHierarchy } from "@/lib/printGrouping";
import { PrintHeader } from "@/components/molecules/PrintHeader";

interface PrintPriceListProps {
  plan: PriceListDetail;
}

const formatPrice = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : `$ ${Number(n).toLocaleString("es-AR", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      })}`;

/** Redondea a múltiplo de 100 cuando el precio es >= 500 (mismo criterio que
 * roundBolsaPriceIfHigh del backend); debajo de ese piso se conserva tal cual. */
const redondearPrecio = (n: number | null | undefined): number | null => {
  if (n == null) return null;
  return n >= 500 ? Math.round(n / 100) * 100 : n;
};

/** Precio mayorista = precio sin IVA + 21%, redondeado al múltiplo de 100. */
const precioMayorista = (sinIva: number | null | undefined): number | null => {
  if (sinIva == null) return null;
  const bruto = Math.round(sinIva * 1.21 * 100) / 100;
  return redondearPrecio(bruto);
};

/** Quita del nombre el prefijo que coincide con un token del encabezado de la
 * sección (marca/línea/sublínea) para no repetirlo en cada fila. Ej: bajo
 * "EUKANUBA · PUPPY", "EUKANUBA PUPPY SMALL BREED 1KG" → "SMALL BREED 1KG". */
/** Etiquetas de sección/sublínea que a veces se cuelan al inicio del nombre
 * (ej. "RAZAS PEQUEÑAS 7131030 EUKANUBA..."), antes del código y el producto. */
const LEAK_PREFIX =
  /^(?:RAZAS?\s+(?:PEQUEÑAS|PEQUENAS|MEDIANAS|GRANDES)|ADULTOS?|CACHORROS?|SENIOR|PUPPY|KITTEN|HÚMEDO|HUMEDO)\s+/i;

/** Nombre a mostrar: quita etiqueta de sección y código sueltos del inicio, y
 * antepone la MARCA (ej. "ROYAL CANIN") cuando el nombre no la trae. Deja el
 * nombre autodescriptivo tipo planilla original ("EUKANUBA PUPPY SMALL BREED 1KG"). */
const displayName = (nombre: string, brand: string | null | undefined): string => {
  let n = nombre.replace(LEAK_PREFIX, "");
  n = n.replace(/^\d{5,8}\s+/, ""); // código numérico suelto al inicio
  n = n.replace(/^[A-Z]{2}\d{2,3}[A-Z]?\s+/, ""); // SKU alfanumérico (CW34H)
  if (brand && !n.toUpperCase().startsWith(brand.toUpperCase())) {
    n = `${brand} ${n}`;
  }
  return n.replace(/\s+/g, " ").trim();
};

/** True si el nombre ya expresa el peso de la unidad (para no repetir la
 * sublínea: "X 1.02 KG" + "(1.02 KG)" → se omite la sublínea). */
const nameAlreadyCarriesWeight = (
  name: string,
  unit: string | null | undefined,
): boolean => {
  if (!unit || !name) return false;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  return norm(name).includes(norm(unit));
};

/** Partes del encabezado deduplicadas (evita "EUKANUBA · EUKANUBA"). */
const headerParts = (
  brand: string | null | undefined,
  line: string | null | undefined,
  subline: string | null | undefined,
): string[] => {
  const raw = [brand, line, subline].filter(Boolean) as string[];
  return raw.filter((p, i) => i === 0 || p !== raw[i - 1]);
};

/** Detecta si un producto es alimento HÚMEDO por su nombre (POUCH, LATA,
 * LÍQUIDO, MOUSSE, HÚMEDO/WET...). El resto se considera SECO. */
const esHumedito = (nombre: string): boolean =>
  /\b(WET|HÚMEDO|HUMEDO|POUCH|LATA|LÍQUIDO|LIQUID|MOUSSE)\b/i.test(nombre);

/** Normaliza la línea de la sección para que variantes ES/EN del proveedor se
 * fusionen en un solo grupo (ej. "ADULT" y "ADULTO" → "ADULT"). Evita secciones
 * duplicadas tipo "EUKANUBA · ADULT" + "EUKANUBA · ADULTO". */
const normalizeLine = (line: string | null): string | null => {
  if (!line) return line;
  const l = line.trim().toUpperCase();
  if (/^ADULTO$/i.test(l)) return "ADULT";
  if (/^GATOADULTO$/i.test(l)) return "GATO ADULTO";
  if (/^CACHORRO$/i.test(l)) return "CACHORROS";
  return line;
};

/**
 * Área imprimible de la planilla mayorista (sdd/alican-wholesale-price-list):
 * encabezado con logo horizontal oficial, jerarquía DEL PDF (marca → línea →
 * sublínea) y por producto 2 columnas: Precio (Con IVA del proveedor) y
 * Sugerido ("—" si no hay). Mismo patrón print-area que
 * PrintProductList/PrintBulkPriceList.
 */
export const PrintPriceList = ({ plan }: PrintPriceListProps) => {
  const sections = groupByPdfHierarchy(
    plan.sections.map((s) => ({ ...s, line: normalizeLine(s.line) })),
    // Se descartan las secciones no-alimento (limpieza, piedra sanitaria) que
    // el preview manda bajo la sublínea "IVA" (etiqueta de precio colada).
  ).filter((s) => !/^IVA$/i.test(s.subline ?? ""));

  // Separar alimento SECO de HÚMEDO según el nombre del producto. Se particiona
  // cada sección del PDF en sus entradas secas y húmedas, para mostrar primero
  // todos los secos y después todos los húmedos (manteniendo marca·línea).
  const seco = sections.map((s) => ({
    ...s,
    entries: s.entries.filter((e) => !esHumedito(e.name)),
  })).filter((s) => s.entries.length > 0);
  const humedo = sections.map((s) => ({
    ...s,
    entries: s.entries.filter((e) => esHumedito(e.name)),
  })).filter((s) => s.entries.length > 0);

  const renderSections = (list: typeof sections) =>
    list.map((section) => (
      <div key={section.id} className="mb-6 print-block">
        {(section.brand || section.line || section.subline) && (
          <h3 className="mb-2 border-b pb-1 text-base font-bold uppercase">
            {headerParts(section.brand, section.line, section.subline).join(" · ")}
          </h3>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead className="w-28 text-right">Precio</TableHead>
              <TableHead className="w-28 text-right">Sugerido</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {section.entries.map((entry) => {
              const nombre = displayName(entry.name, section.brand);
              const showUnit =
                entry.unit && !nameAlreadyCarriesWeight(nombre, entry.unit);
              return (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium leading-tight">
                    {nombre}
                    {showUnit ? (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({entry.unit})
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatPrice(precioMayorista(entry.priceSinIva))}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatPrice(redondearPrecio(entry.suggestedPrice))}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    ));

  return (
    <div className="print-area hidden print:block" aria-hidden="true">
      <PrintHeader
        title="Planilla mayorista"
        subtitle={`${plan.type} · ${plan.sections.length} secciones`}
      />

      {seco.length > 0 && (
        <>
          <h2 className="mb-3 border-b-2 pb-1 text-xl font-black uppercase">
            Alimento seco
          </h2>
          {renderSections(seco)}
        </>
      )}

      {humedo.length > 0 && (
        <>
          <h2 className="mb-3 border-b-2 pb-1 text-xl font-black uppercase">
            Alimento húmedo
          </h2>
          {renderSections(humedo)}
        </>
      )}
    </div>
  );
};

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
const stripLeading = (name: string, token: string | null | undefined): string => {
  if (!token || !name) return name;
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return name.replace(new RegExp(`^${esc}\\b\\s*`, "i"), "");
};

const cleanProductName = (
  name: string,
  brand: string | null | undefined,
  line: string | null | undefined,
  subline: string | null | undefined,
): string => {
  let n = stripLeading(name, brand);
  n = stripLeading(n, line);
  n = stripLeading(n, subline);
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

/**
 * Área imprimible de la planilla mayorista (sdd/alican-wholesale-price-list):
 * encabezado con logo horizontal oficial, jerarquía DEL PDF (marca → línea →
 * sublínea) y por producto 2 columnas: Precio (Con IVA del proveedor) y
 * Sugerido ("—" si no hay). Mismo patrón print-area que
 * PrintProductList/PrintBulkPriceList.
 */
export const PrintPriceList = ({ plan }: PrintPriceListProps) => {
  const sections = groupByPdfHierarchy(plan.sections);

  return (
    <div className="print-area hidden print:block" aria-hidden="true">
      <PrintHeader
        title="Planilla mayorista"
        subtitle={`${plan.type} · ${plan.sections.length} secciones`}
      />

      {sections.map((section) => (
        <div key={section.id} className="mb-6 print-block">
          {(section.brand || section.line || section.subline) && (
            <h2 className="mb-2 border-b pb-1 text-base font-bold uppercase">
              {headerParts(section.brand, section.line, section.subline)
                .join(" · ")}
            </h2>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                <TableHead className="text-right">Sugerido</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {section.entries.map((entry) => {
                const nombre = cleanProductName(
                  entry.name,
                  section.brand,
                  section.line,
                  section.subline,
                );
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
      ))}
    </div>
  );
};

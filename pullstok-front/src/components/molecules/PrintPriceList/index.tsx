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
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;

/** Precio mayorista = precio sin IVA + 21% (lo que se imprime para mayoristas). */
const precioMayorista = (sinIva: number | null | undefined): number | null =>
  sinIva == null ? null : Math.round(sinIva * 1.21 * 100) / 100;

const formatPeriod = (period: string | null) =>
  period ? ` · vigencia ${period}` : " · sin vigencia";

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
        subtitle={
          <>
            {plan.type}
            {formatPeriod(plan.period)} · {plan.sections.length} secciones
          </>
        }
      />

      {sections.map((section) => (
        <div key={section.id} className="mb-6">
          {(section.brand || section.line || section.subline) && (
            <h2 className="mb-2 border-b pb-1 text-base font-bold uppercase">
              {[section.brand, section.line, section.subline]
                .filter(Boolean)
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
              {section.entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium leading-tight">
                    {entry.name}
                    {entry.unit ? (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({entry.unit})
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatPrice(precioMayorista(entry.priceSinIva))}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatPrice(entry.suggestedPrice)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}
    </div>
  );
};

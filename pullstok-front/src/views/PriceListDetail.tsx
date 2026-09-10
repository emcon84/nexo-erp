import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PrintPriceList } from "@/components/molecules/PrintPriceList";
import { groupByPdfHierarchy } from "@/lib/printGrouping";
import {
  adjustPriceList,
  getPriceList,
  type AdjustPayload,
  type AdjustResult,
  type PriceListDetail as PlanDetail,
} from "@/services/priceLists";

const formatPrice = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : `$${Number(n).toLocaleString("es-AR", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      })}`;

/** Precio mayorista = precio sin IVA + 21%, redondeado al múltiplo de 100
 * (mismo criterio que roundBolsaPriceIfHigh del backend: si >= 500). */
const precioMayorista = (sinIva: number | null | undefined): number | null => {
  if (sinIva == null) return null;
  const bruto = Math.round(sinIva * 1.21 * 100) / 100;
  return bruto >= 500 ? Math.round(bruto / 100) * 100 : bruto;
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

/**
 * Detalle de una planilla mayorista (sdd/alican-wholesale-price-list):
 * jerarquía del PDF (marca → línea → sublínea → tabla) con columna Precio
 * (Con IVA del proveedor) + Sugerido editable por fila, panel "Ajuste masivo"
 * (% −100..500, exclusiones por fila, overrides puntuales) con Vista previa
 * dryRun → AlertDialog → apply, e impresión con logo (patrón print-area).
 */
export const PriceListDetail = () => {
  const { id } = useParams<string>();
  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [percentage, setPercentage] = useState("");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<AdjustResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      setPlan(await getPriceList(id));
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Error al obtener la planilla");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const adjustPayload = (): AdjustPayload => {
    const trimmed = percentage.trim();
    const pct =
      trimmed === "" || Number.isNaN(parseFloat(trimmed))
        ? undefined
        : parseFloat(trimmed);
    return {
      percentage: pct,
      excludeEntryIds: [...excluded],
      entryOverrides: Object.entries(overrides)
        .filter(([, v]) => v.trim() !== "" && !Number.isNaN(parseFloat(v)))
        .map(([entryId, value]) => ({ entryId, suggestedPrice: parseFloat(value) })),
    };
  };

  const handlePreview = async () => {
    if (!id) return;
    setSubmitting(true);
    try {
      const data = await adjustPriceList(id, adjustPayload(), true);
      setPreview(data);
      setDialogOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al obtener el preview");
    } finally {
      setSubmitting(false);
    }
  };

  const handleApply = async () => {
    if (!id) return;
    setSubmitting(true);
    try {
      const result = await adjustPriceList(id, adjustPayload(), false);
      toast.success(`${result.affected} precios sugeridos actualizados`);
      setDialogOpen(false);
      setPreview(null);
      await load(); // el server reescribe entries + products → recargar la planilla
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al aplicar el ajuste");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleExclude = (entryId: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  if (loading && !plan) {
    return <div className="p-6 text-muted-foreground">Cargando planilla…</div>;
  }
  if (loadError || !plan) {
    return (
      <div className="p-6">
        <p className="text-destructive" role="alert">
          {loadError || "Planilla no encontrada"}
        </p>
      </div>
    );
  }

  const sections = groupByPdfHierarchy(plan.sections);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Planilla mayorista</h1>
          <p className="text-muted-foreground">
            {plan.type} · {plan.period ? `vigencia ${plan.period}` : "sin vigencia"} ·
            importada el {formatDate(plan.importedAt)} · {plan.sourceFilename}
          </p>
        </div>
        <Button variant="outline" onClick={() => window.print()}>
          Imprimir planilla
        </Button>
      </div>

      {/* Jerarquía del PDF: marca → línea → sublínea → tabla */}
      {sections.map((section) => (
        <Card key={section.id}>
          {(section.brand || section.line || section.subline) && (
            <CardHeader className="pb-2">
              <CardTitle className="text-base uppercase">
                {[section.brand, section.line, section.subline]
                  .filter(Boolean)
                  .join(" · ")}
              </CardTitle>
            </CardHeader>
          )}
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Precio mayorista</TableHead>
                  <TableHead className="text-right">Sugerido</TableHead>
                  <TableHead className="w-24">Excluir</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {section.entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <div className="font-medium leading-tight">{entry.name}</div>
                      {entry.unit && (
                        <div className="text-xs text-muted-foreground">{entry.unit}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPrice(precioMayorista(entry.priceSinIva))}
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        className="ml-auto w-36 text-right tabular-nums"
                        value={overrides[entry.id] ?? entry.suggestedPrice ?? ""}
                        aria-label={`Sugerido de ${entry.name}`}
                        onChange={(e) =>
                          setOverrides((prev) => ({
                            ...prev,
                            [entry.id]: e.target.value,
                          }))
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Checkbox
                        checked={excluded.has(entry.id)}
                        onCheckedChange={() => toggleExclude(entry.id)}
                        aria-label={`Excluir ${entry.name}`}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      {/* Ajuste masivo (D7: toda la planilla, server-side, patrón bulkPriceUpdate) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Ajuste masivo de sugeridos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            El porcentaje se aplica sobre el valor ACTUAL de cada fila (destildar
            una fila la excluye de la corrida; 0% cuenta como incluida sin cambio).
          </p>
          <div className="flex items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="ajuste-pct">Porcentaje (−100 a 500)</Label>
              <Input
                id="ajuste-pct"
                type="number"
                min="-100"
                max="500"
                step="1"
                placeholder="Ej. 10"
                className="w-40"
                value={percentage}
                onChange={(e) => setPercentage(e.target.value)}
              />
            </div>
            <Button onClick={handlePreview} disabled={submitting}>
              {submitting ? "Calculando…" : "Vista previa"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Diálogo de confirmación con el preview del ajuste */}
      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar ajuste masivo</AlertDialogTitle>
            <AlertDialogDescription>
              {preview
                ? `${preview.affected} filas · total actual $${preview.previousTotal.toLocaleString("es-AR")} · total nuevo $${preview.newTotal.toLocaleString("es-AR")}`
                : "Calculando…"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {preview && preview.rows && preview.rows.length > 0 && (
            <div className="max-h-64 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Actual</TableHead>
                    <TableHead className="text-right">Nuevo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((row) => (
                    <TableRow key={row.entryId}>
                      <TableCell>{row.name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatPrice(row.suggestedPrice)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatPrice(row.newSuggestedPrice)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleApply} disabled={submitting}>
              Aplicar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Área imprimible (siempre montada con los datos actuales) */}
      <PrintPriceList plan={plan} />
    </div>
  );
};

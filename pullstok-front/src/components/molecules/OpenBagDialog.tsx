import { useCallback, useEffect, useRef, useState } from "react";
import { PackageOpen, Search } from "lucide-react";
import { toast } from "react-toastify";
import { useOpenBag } from "@/components/hooks/useOpenBag";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface OpenBagDialogProps {
  branchId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface ScannedProductDisplay {
  id: string;
  name: string;
  weightKg: number | null;
  price: number;
  code?: string | null;
  barcode?: string | null;
  category?: { name: string } | null;
}

export const OpenBagDialog = ({
  branchId,
  open,
  onOpenChange,
  onSuccess,
}: OpenBagDialogProps) => {
  const {
    cellOptions,
    loadingCells,
    searchProduct,
    openBag,
    error,
    loading,
    clearError,
  } = useOpenBag({ branchId });

  const [scannedProduct, setScannedProduct] = useState<ScannedProductDisplay | null>(null);
  const [selectedCellId, setSelectedCellId] = useState("");
  const [barcode, setBarcode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  // Focus barcode input when dialog opens
  useEffect(() => {
    if (open && barcodeInputRef.current) {
      barcodeInputRef.current.focus();
    }
  }, [open]);

  // Clear state when dialog closes
  useEffect(() => {
    if (!open) {
      setScannedProduct(null);
      setSelectedCellId("");
      setBarcode("");
      clearError();
    }
  }, [open, clearError]);

  const handleBarcodeSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!barcode.trim()) return;

      clearError();
      try {
        const result = await searchProduct(barcode.trim());
        setScannedProduct({
          id: result.product.id,
          name: result.product.name,
          weightKg: result.product.weightKg,
          price: result.product.price,
          code: result.product.code,
          barcode: result.product.barcode,
          category: result.product.category,
        });
        setSelectedCellId("");
      } catch (err: any) {
        // Error is already set by the hook, but ensure we have a user-friendly message
        if (err?.message && !error) {
          // The hook sets the error, but we can also show a generic message
        }
      }
    },
    [barcode, searchProduct, clearError],
  );

  const handleConfirm = useCallback(async () => {
    if (!scannedProduct || !selectedCellId || submitting) return;

    setSubmitting(true);
    try {
      const result = await openBag(scannedProduct.id, selectedCellId);
      toast.success(
        `Bolsa abierta: ${scannedProduct.name} → +${scannedProduct.weightKg.toFixed(2)} kg en ${cellOptions.find((c) => c.value === selectedCellId)?.label ?? result.priceKgPriceId}`,
      );
      onSuccess?.();
      onOpenChange(false);
    } catch {
      // Error is already set by the hook and shown via toast
    } finally {
      setSubmitting(false);
    }
  }, [scannedProduct, selectedCellId, submitting, openBag, cellOptions, onSuccess, onOpenChange]);

  const handleCancel = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const handleBarcodeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setBarcode(e.target.value);
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Abrir bolsa</DialogTitle>
          <DialogDescription>
            Escaneá el código de barras de la bolsa y seleccioná la celda destino
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleBarcodeSubmit} className="space-y-4">
          {/* Barcode input */}
          <div className="space-y-2">
            <Label htmlFor="barcode-input" className="text-sm font-medium">
              Código de barras
            </Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={barcodeInputRef}
                id="barcode-input"
                type="text"
                placeholder="Escaneá o ingresá el código de barras"
                value={barcode}
                onChange={handleBarcodeChange}
                disabled={loading || submitting}
                className="pl-9"
                autoComplete="off"
                aria-label="Código de barras del producto"
              />
            </div>
            <Button
              type="submit"
              disabled={!barcode.trim() || loading || submitting}
              className="w-full"
            >
              <Search className="h-4 w-4 mr-2" />
              Buscar
            </Button>
          </div>

          {/* Error display */}
          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive" role="alert">
              {error}
            </div>
          )}

          {/* Scanned product display */}
          {scannedProduct && (
            <div className="space-y-2 rounded-lg bg-muted p-4">
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-lg">{scannedProduct.name}</h4>
                <span className="text-sm text-muted-foreground">
                  {scannedProduct.code || scannedProduct.barcode}
                </span>
              </div>
              {scannedProduct.category && (
                <p className="text-sm text-muted-foreground">{scannedProduct.category.name}</p>
              )}
              <div className="flex items-center gap-4 text-sm">
                <span className="font-medium">
                  {scannedProduct.weightKg != null ? scannedProduct.weightKg.toFixed(2) : "—"} kg
                </span>
                <span className="text-muted-foreground">
                  ${scannedProduct.price.toLocaleString("es-AR")}
                </span>
              </div>
            </div>
          )}

          {/* Cell selection */}
          <div className="space-y-2">
            <Label htmlFor="cell-select" className="text-sm font-medium" disabled={!scannedProduct}>
              Celda destino
            </Label>
            <NativeSelect
              id="cell-select"
              value={selectedCellId}
              onValueChange={setSelectedCellId}
              options={cellOptions}
              placeholder="Seleccioná una celda"
              disabled={!scannedProduct || loadingCells}
              aria-label="Celda destino para abrir bolsa"
            />
            {loadingCells && <p className="text-xs text-muted-foreground">Cargando celdas…</p>}
          </div>

          {/* Confirm footer */}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={handleCancel} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleConfirm} disabled={!scannedProduct || !selectedCellId || submitting}>
              {submitting ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent mr-2" />
                  Abriendo…
                </>
              ) : (
                <>
                  <PackageOpen className="h-4 w-4 mr-2" />
                  Abrir bolsa
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
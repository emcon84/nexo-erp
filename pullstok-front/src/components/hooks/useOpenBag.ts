import { useCallback, useEffect, useState } from "react";
import { API_URL } from "@/constants";
import { getPriceKgPlan } from "@/services/priceKgPlan";
import { listPriceKgTypes } from "@/services/priceKgTypes";
import { listPriceKgBrands } from "@/services/priceKgBrands";
import { openBag, type OpenBagResult } from "@/services/looseStock";
import { NativeSelectOption } from "@/components/ui/native-select";

export interface ProductScanResult {
  product: {
    id: string;
    name: string;
    weightKg: number | null;
    price: number;
    code?: string | null;
    barcode?: string | null;
    category?: { name: string } | null;
  };
  isScale: boolean;
}

export interface UseOpenBagResult {
  cellOptions: NativeSelectOption[];
  loadingCells: boolean;
  searchProduct: (barcode: string) => Promise<ProductScanResult>;
  openBag: (productId: string, priceKgPriceId: string) => Promise<OpenBagResult>;
  error: string | null;
  loading: boolean;
  clearError: () => void;
}

const SPECIES_LABELS: Record<string, string> = {
  PERRO: "Perro",
  GATO: "Gato",
  AMBOS: "Perros y gatos",
};

/**
 * Hook for the "Abrir bolsa" flow in UnifiedPos.
 * Encapsulates: loading cell options (plan + types + brands), product search via /by-scan,
 * and calling the openBag API.
 */
export function useOpenBag({ branchId }: { branchId: string }): UseOpenBagResult {
  const [cellOptions, setCellOptions] = useState<NativeSelectOption[]>([]);
  const [loadingCells, setLoadingCells] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Load cell options on mount
  useEffect(() => {
    let mounted = true;

    const loadCellOptions = async () => {
      setLoadingCells(true);
      try {
        const [plan, types, brands] = await Promise.all([
          getPriceKgPlan(),
          listPriceKgTypes(),
          listPriceKgBrands(),
        ]);

        if (!mounted) return;

        const typeById = new Map(types.map((t) => [t.id, t]));
        const brandById = new Map(brands.map((b) => [b.id, b]));

        const options: NativeSelectOption[] = plan.map((cell) => {
          const brandName = brandById.get(cell.brandId)?.name ?? "";
          const typeName = typeById.get(cell.typeId)?.name ?? "";
          const speciesLabel = SPECIES_LABELS[cell.species] ?? cell.species;
          const label = `${brandName} · ${typeName} · ${speciesLabel}${
            cell.priceKg ? ` — $${cell.priceKg.toLocaleString("es-AR")}/kg` : ""
          }`;
          return { value: cell.id, label };
        });

        setCellOptions(options);
      } catch {
        if (mounted) {
          setCellOptions([]);
        }
      } finally {
        if (mounted) {
          setLoadingCells(false);
        }
      }
    };

    loadCellOptions();

    return () => {
      mounted = false;
    };
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const searchProduct = useCallback(
    async (barcode: string): Promise<ProductScanResult> => {
      setLoading(true);
      setError(null);
      
      try {
        const token = localStorage.getItem("token") || "";
        const res = await fetch(
          `${API_URL}/products/by-scan/${encodeURIComponent(barcode)}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          },
        );

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const message = errData.message || "No se pudo buscar el producto";
          setError(message);
          throw new Error(message);
        }

        const data = await res.json();

        if (data.isScale) {
          const message = "Las etiquetas de balanza no se pueden abrir como bolsa";
          setError(message);
          throw new Error(message);
        }

        const product = data.product;
        if (!product || product.weightKg == null || product.weightKg <= 0) {
          const message = "Este producto no tiene peso configurado para abrir bolsa";
          setError(message);
          throw new Error(message);
        }

        return {
          product: {
            id: product._id ?? product.id,
            name: product.name,
            weightKg: product.weightKg,
            price: product.price,
            code: product.code,
            barcode: product.barcode,
            category: product.category,
          },
          isScale: false,
        };
      } catch (err: any) {
        // Ensure error is set for any unexpected errors
        if (err?.message && error === null) {
          setError(err.message);
        }
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const openBagFn = useCallback(
    async (productId: string, priceKgPriceId: string): Promise<OpenBagResult> => {
      setLoading(true);
      setError(null);
      try {
        const result = await openBag({
          productId,
          branchId,
          priceKgPriceId,
        });
        return result;
      } catch (err: any) {
        const originalMessage = err?.message || "";
        let message: string;

        if (originalMessage === "LOOSE_BAG_INSUFFICIENT_STOCK") {
          message = "Sin stock de bolsas en tu sucursal";
        } else if (originalMessage === "LOOSE_LINE_NOT_FOUND") {
          message = "Línea de planilla no existe";
        } else if (originalMessage === "LOOSE_BAG_NO_WEIGHT") {
          message = "Este producto no tiene peso configurado para abrir bolsa";
        } else if (originalMessage === "LOOSE_BAG_NOT_FOUND") {
          message = "Bolsa no encontrada";
        } else {
          message = "No se pudo abrir la bolsa";
        }

        setError(message);
        throw new Error(message);
      } finally {
        setLoading(false);
      }
    },
    [branchId],
  );

  return {
    cellOptions,
    loadingCells,
    searchProduct,
    openBag: openBagFn,
    error,
    loading,
    clearError,
  };
}
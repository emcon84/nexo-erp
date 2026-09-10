import axios from "axios";
import { DataItem } from "../types";
import { API_URL } from "../constants";

/** One branch entry of the self-contained stock response (spec A1). */
export interface BranchStockInfo {
  branchId: string;
  branchName: string;
  quantity: number;
  isHeadquarters: boolean;
  canEdit: boolean;
}

/** Self-contained per-branch stock for a product: no GET /branches needed. */
export interface ProductStockResponse {
  productId: string;
  branches: BranchStockInfo[];
}

/**
 * Fetches the stock of a product across every active branch of the org.
 * The response carries the authoritative `canEdit` per branch (server-side
 * role + BranchAssignment), so any authenticated role can render the drawer.
 */
export const getProductStock = async (
  productId: string,
): Promise<ProductStockResponse> => {
  try {
    const token = localStorage.getItem("token");

    const response = await axios.get<ProductStockResponse>(
      `${API_URL}/products/${productId}/stock`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(error.response?.data?.message || "get product stock failed");
    } else {
      throw new Error("An unknown error occurred");
    }
  }
};

/**
 * Updates the stock quantity of a single branch for a product (spec A2).
 * Server-side authorization decides if the current user may edit that branch.
 */
export const updateBranchStock = async (
  productId: string,
  branchId: string,
  quantity: number,
): Promise<{ branchId: string; quantity: number }> => {
  try {
    const token = localStorage.getItem("token");

    const response = await axios.put<{ branchId: string; quantity: number }>(
      `${API_URL}/products/${productId}/stock/${branchId}`,
      { quantity },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(error.response?.data?.message || "update branch stock failed");
    } else {
      throw new Error("An unknown error occurred");
    }
  }
};

/** Stock agregado de una sucursal ACTIVA dentro del resumen de la org. */
export interface BranchStockSummary {
  branchId: string;
  branchName: string;
  quantity: number;
  isHeadquarters: boolean;
}

/** Resumen de stock de toda la org (dashboard): total + detalle por sucursal. */
export interface StockSummary {
  total: number;
  branches: BranchStockSummary[];
}

/**
 * Fetches the org-wide stock summary: `total` (all ProductStock rows of the
 * org, active or not) plus the per-branch breakdown of ACTIVE branches.
 */
export const getStockSummary = async (): Promise<StockSummary> => {
  try {
    const token = localStorage.getItem("token");

    const response = await axios.get<StockSummary>(
      `${API_URL}/products/stock-summary`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(error.response?.data?.message || "get stock summary failed");
    } else {
      throw new Error("An unknown error occurred");
    }
  }
};

/** Complete filter facets: all org categories + variants for the selected category. */
export interface ProductFacets {
  categories: { id: string; name: string }[];
  variants: { name: string; values: string[] }[];
  /** Títulos de planilla del tipo seleccionado (?priceListType=, default SECO;
   * sdd/alican-plan-titles): chips de filtro por título del PDF (ej. "SIEGER
   * PUPPY"). key = [brand, line, subline].filter(Boolean).join("|") — contract
   * exacto con GET /products?title=. En WET la planilla es plana y vuelve [].
   */
  titles: { key: string; label: string; count: number }[];
}

/**
 * Fetches the full filter facets (all categories that have products, plus
 * variant groups for the matching category). Independent of the paginated list,
 * so the chips always reflect the complete catalog.
 */
export const getProductFacets = async (
  category?: string,
  priceListType?: "SECO" | "WET",
): Promise<ProductFacets> => {
  try {
    const token = localStorage.getItem("token");

    const params: Record<string, string> = {};
    if (category) params.category = category;
    if (priceListType) params.priceListType = priceListType;

    const response = await axios.get<ProductFacets>(
      `${API_URL}/products/filter-facets`,
      {
        params,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        error.response?.data?.message || "get product facets failed",
      );
    } else {
      throw new Error("An unknown error occurred");
    }
  }
};

/**
 * Garantiza `planSection` en cada DataItem (null si la API no lo trae): la
 * sección de planilla SECO más reciente ya viene del backend; este paso la
 * normaliza en AMBOS shapes (array plano y envelope paginado).
 */
const normalizePlanSection = (item: DataItem): DataItem => ({
  ...item,
  planSection: item.planSection ?? null,
});

/** Server-side pagination envelope (opt-in, only when page + pageSize are sent). */
export interface PaginatedProducts {
  items: DataItem[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * Legacy callers (no page/pageSize) get the plain array; paginated callers
 * (page + pageSize) get the envelope {@link PaginatedProducts}. Overloads let
 * existing consumers keep the `DataItem[]` type without any change.
 */
export function products(
  branchId?: string,
  search?: string,
  category?: string,
  priceListType?: "SECO" | "WET",
): Promise<DataItem[]>;
// Paginados: page/pageSize en las posiciones 4/5 (contrato legacy intacto,
// LooseStockAdmin usa products(undefined, "", undefined, 1, 300)); el título de
// planilla es OPCIONAL y va al final (solo lo usa la variante paginada del
// vendor dashboard). priceListType también es OPCIONAL y va al final (posición
// 7): la variante plana del dashboard admin lo recibe en la posición 4.
// carriedOnly (solo lo que trabajo) va al final (posición 8): lo usa la variante
// paginada del vendedor; el admin lo filtra client-side.
export function products(
  branchId: string | undefined,
  search: string | undefined,
  category: string | undefined,
  page: number,
  pageSize: number,
  title?: string,
  priceListType?: "SECO" | "WET",
  carriedOnly?: boolean,
): Promise<PaginatedProducts>;
export async function products(
  branchId?: string,
  search?: string,
  category?: string,
  priceListTypeOrPage?: string | number,
  pageSizeOrPriceListType?: number | "SECO" | "WET",
  title?: string,
  priceListType?: "SECO" | "WET",
  carriedOnly?: boolean,
): Promise<DataItem[] | PaginatedProducts> {
  try {
    const token = localStorage.getItem("token");

    const params: Record<string, string> = {};
    if (branchId) params.branchId = branchId;
    if (search) params.name = search;
    if (category) params.category = category;
    if (title) params.title = title;
    if (carriedOnly) params.carriedOnly = "1";

    // priceListType llega por la posición 4 (variante plana del dashboard
    // admin) o por la 7 (variante paginada del vendor dashboard); nunca ambas.
    const effectivePriceListType =
      typeof priceListTypeOrPage === "string"
        ? (priceListTypeOrPage as "SECO" | "WET")
        : priceListType;
    if (effectivePriceListType) params.priceListType = effectivePriceListType;

    const page =
      typeof priceListTypeOrPage === "number" ? priceListTypeOrPage : undefined;
    const pageSize =
      typeof pageSizeOrPriceListType === "number"
        ? pageSizeOrPriceListType
        : undefined;
    if (page !== undefined && pageSize !== undefined) {
      params.page = String(page);
      params.pageSize = String(pageSize);
    }

    const response = await axios.get(`${API_URL}/products`, {
      params,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const data = response.data;
    if (Array.isArray(data)) {
      return data.map(normalizePlanSection);
    }
    return {
      ...data,
      items: (data.items ?? []).map(normalizePlanSection),
    } as PaginatedProducts;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      // Error específico de Axios
      throw new Error(error.response?.data?.message || "products failed");
    } else {
      // Error general
      throw new Error("An unknown error occurred");
    }
  }
}
export const createProduct = async (product: DataItem) => {
  try {
    const token = localStorage.getItem("token");

    const response = await axios.post(`${API_URL}/products`, product, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      // Error específico de Axios
      throw new Error(error.response?.data?.message || "create product failed");
    } else {
      // Error general
      throw new Error("An unknown error occurred");
    }
  }
};

export const updateProduct = async (product: DataItem) => {
  try {
    const token = localStorage.getItem("token");
    const productId = product._id || product.id;

    const response = await axios.put(
      `${API_URL}/products/${productId}`,
      product,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      // Error específico de Axios
      throw new Error(error.response?.data?.message || "update product failed");
    } else {
      // Error general
      throw new Error("An unknown error occurred");
    }
  }
};
export const deleteProduct = async (productId: string): Promise<void> => {
  try {
    const token = localStorage.getItem("token");

    await axios.delete(`${API_URL}/products/${productId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      // Error específico de Axios
      throw new Error(error.response?.data?.message || "delete product failed");
    } else {
      // Error general
      throw new Error("An unknown error occurred");
    }
  }
};

/**
 * POST /products/bulk-carried — marca/desmarca el flag "carried" de varios
 * productos a la vez (selección múltiple en la tabla del admin).
 */
export const bulkCarried = async (
  productIds: string[],
  carried: boolean,
): Promise<{ updated: number }> => {
  const token = localStorage.getItem("token");
  const res = await fetch(`${API_URL}/products/bulk-carried`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ productIds, carried }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || "bulk carried failed");
  }
  return res.json();
};

/**
 * POST /products/bulk-publish — publica/despublica en la tienda online todos
 * los productos de la org que tengan la variante "Marca" en brandValues.
 * Mismo estilo que bulkCarried (plain fetch + token de localStorage).
 */
export const bulkPublishProducts = async (
  brandValues: string[],
  publishedToStore: boolean,
): Promise<{ count: number }> => {
  const token = localStorage.getItem("token");
  const res = await fetch(`${API_URL}/products/bulk-publish`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ brandValues, publishedToStore }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || "bulk publish failed");
  }
  return res.json();
};

/** Respuesta de GET /products/brands: marcas disponibles de la org (variante
 * "Marca", valores únicos ordenados) para el selector del bulk-publish. */
export interface StoreBrands {
  brands: string[];
}

/** GET /products/brands — marcas disponibles para el selector del masivo. */
export const listStoreBrands = async (): Promise<StoreBrands> => {
  const token = localStorage.getItem("token");
  const res = await fetch(`${API_URL}/products/brands`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || "list store brands failed");
  }
  return res.json();
};

// ---------------------------------------------------------------------------
// Bulk price update (sdd/bulk-price-update-selectors)
// ---------------------------------------------------------------------------

/** Override de % sobre una categoría en una corrida masiva. */
export interface CategoryPriceOverride {
  categoryId: string;
  percentage: number;
}

/** Override de % sobre un producto en una corrida masiva. */
export interface ProductPriceOverride {
  productId: string;
  percentage: number;
}

/** Payload compartido por preview (dryRun) y apply de la actualización masiva. */
export interface BulkPriceUpdatePayload {
  brandValues: string[];
  categoryIds: string[];
  excludeProductIds: string[];
  /** Filtro por proveedor (sdd/alican-wholesale-price-list/providers):
   * OPCIONAL. Se combina con el filtro de marcas como AND. */
  providerIds?: string[];
  /** Filtro por sección de planilla del proveedor (línea del PDF, ej.
   * "SIGER MEDICADOS"): OPCIONAL. Restringe a los productos matcheados de esas
   * secciones; se combina como AND con los demás filtros. */
  priceListSectionIds?: string[];
  /** Filtro por tipo de planilla (SECO/WET): OPCIONAL, default []. Vacío = sin
   * filtro (todos los que tengan planilla); se combina como AND con el resto. */
  priceListTypes?: ("SECO" | "WET")[];
  /** Overrides de % por sección de planilla (línea del PDF): precedencia
   * product > section > category > global. OPCIONAL. */
  sectionPercentages?: { sectionId: string; percentage: number }[];
  /** Overrides de GANANCIA por sección de planilla (línea del PDF): margen
   * propio por línea (ej. medicados). OPCIONAL. Se combina multiplicativamente
   * con el % de aumento de la línea. */
  sectionMargins?: { sectionId: string; margin: number }[];
  /** Global opcional: sin valor el server resuelve 0 para productos sin override. */
  percentage?: number;
  /** Ganancia global (multiplicativa): precio_final = precio × (1+margin/100) ×
   * (1+percentage/100). OPCIONAL; sin valor el server resuelve 0. */
  margin?: number;
  categoryPercentages: CategoryPriceOverride[];
  productPercentages: ProductPriceOverride[];
}

/** Fila del preview: producto con % efectivo resuelto por el server. */
export interface BulkPricePreviewRow {
  id: string;
  name: string;
  categoryName: string | null;
  brandValues: string[];
  oldPrice: number;
  newPrice: number;
  delta: number;
  effectivePercentage: number;
}

/** Respuesta del preview (dryRun): agregados sobre el set COMPLETO + página. */
export interface BulkPricePreview {
  affected: number;
  previousTotal: number;
  newTotal: number;
  page: number;
  pageSize: number;
  total: number;
  rows: BulkPricePreviewRow[];
}

/** Respuesta del apply: conteo autoritativo re-resuelto en el server. */
export interface BulkPriceApplyResult {
  affected: number;
  previousTotal: number;
  newTotal: number;
}

/**
 * POST /products/bulk-price-update — preview (dryRun=true, paginado por page)
 * o apply (sin flag). Plain fetch + token de localStorage: el endpoint se
 * selecciona por query flag, no por verbo/URL, así que este caso deliberado no
 * usa axios (el resto del archivo sí).
 */
export const bulkPriceUpdate = async (
  payload: BulkPriceUpdatePayload,
  dryRun: boolean,
  page = 1,
  all = false,
): Promise<BulkPricePreview | BulkPriceApplyResult> => {
  const token = localStorage.getItem("token");
  const query = dryRun
    ? all
      ? "?dryRun=true&all=true"
      : `?dryRun=true&page=${page}`
    : "";
  const res = await fetch(`${API_URL}/products/bulk-price-update${query}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || "bulk price update failed");
  }
  return res.json();
};

// ---------------------------------------------------------------------------
// Reporte de productos de "Alimento Seco" con/sin código de barras (admin)
// ---------------------------------------------------------------------------

/** Item del reporte de alimento seco: producto con/sin código de barras. */
export interface SecoBarcodeItem {
  id: string;
  name: string;
  species: string;
  code: string;
  barcode: string;
  hasBarcode: boolean;
}

/** Reporte de productos de Alimento Seco con/sin código de barras. */
export interface SecoBarcodesReport {
  total: number;
  conBarcode: number;
  sinBarcode: number;
  items: SecoBarcodeItem[];
}

/** GET /products/seco-barcodes-report — listado de alimento seco con/sin barras. */
export const getSecoBarcodesReport = async (): Promise<SecoBarcodesReport> => {
  try {
    const token = localStorage.getItem("token");
    const response = await axios.get<SecoBarcodesReport>(
      `${API_URL}/products/seco-barcodes-report`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(error.response?.data?.message || "get seco barcodes report failed");
    } else {
      throw new Error("An unknown error occurred");
    }
  }
};


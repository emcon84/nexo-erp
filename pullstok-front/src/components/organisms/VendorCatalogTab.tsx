import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "react-toastify";
import { Loader } from "@/components/atoms/loader";
import { ProductDrawer } from "@/components/molecules/ProductDrawer";
import { FilterChips } from "@/components/molecules/FilterChips";
import { VendorSearchBar } from "@/components/molecules/VendorSearchBar";
import { ProductTable } from "@/components/molecules/ProductTable";
import { useVendorCatalog } from "@/components/hooks/useVendorCatalog";
import { useVendorRowsKeyboard } from "@/components/hooks/useVendorRowsKeyboard";
import { useVendorCart, type SaleMode } from "@/components/hooks/useVendorCart";
import {
  branchQty,
  isUnitSellable,
  unitStock,
  saleModeForProduct,
  VENDOR_FILTER_KEY,
  type StoredFilter,
} from "@/components/hooks/vendorCatalogHelpers";
import { parseDecimal, formatBolsaQty } from "@/components/hooks/vendorRowHelpers";
import type { DataItem } from "@/types";

type VendorCart = ReturnType<typeof useVendorCart>;

interface VendorCatalogTabProps {
  branchId: string;
  cart: VendorCart;
  onSaveOrder: () => void;
  onConfirmSale: () => void;
  /** → salta al panel de pedido. */
  onEnterPanel?: () => void;
  /** Tecla T: cambia de tab (Por unidad ↔ Suelto). */
  onToggleTab?: () => void;
  /** Registra la función para volver al listado desde el panel (←). */
  registerGridApi?: (api: { focusSelectedRow: () => void; clearSearch: () => void }) => void;
}

/**
 * Tab "Por unidad" del POS unificado: catálogo de bolsas con carga INLINE (sin
 * modal). Cada fila tiene un input de cantidad (↑/↓ navegan con roving focus,
 * +/− lo ajustan y Enter/click lo agrega al pedido). Reusa los mismos hooks
 * que VendorDashboard, pero el carrito/checkout viven arriba (UnifiedPos) para
 * compartir el MISMO carrito con la tab "Suelto". Dueño del teclado (P/V).
 */
export const VendorCatalogTab = ({
  branchId,
  cart,
  onSaveOrder,
  onConfirmSale,
  onEnterPanel,
  onToggleTab,
  registerGridApi,
}: VendorCatalogTabProps) => {
  const navigate = useNavigate();
  const catalog = useVendorCatalog(branchId);
  const rootRef = useRef<HTMLDivElement>(null);

  // ── Cantidades inline (string por fila, sync desde el carrito) ──
  const [qtyByKey, setQtyByKey] = useState<Record<string, string>>({});
  // Switch global "Vender por unidad": cuando está ON y el producto es un
  // multi-pack elegible (unitsPerBox > 1), el catálogo vende POR_UNIDAD
  // (precio unitario + stock en unidades); si está OFF, vende por CAJA
  // (BOLSA_CERRADA, precio de caja + stock convertido a cajas).
  const [unitMode, setUnitMode] = useState(false);
  // Refs de los inputs de cantidad para el foco (roving) y del carrito para el
  // sync de valores (los ítems en el carrito muestran su cantidad al input).
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // El scroll del `selectedIndex` ya lo hace useVendorCatalog (itemRefs). Acá
  // solo movemos el FOCO al input (preventScroll: el scroll lo maneja el hook).
  useEffect(() => {
    if (catalog.selectedIndex >= 0) {
      inputRefs.current[catalog.selectedIndex]?.focus({ preventScroll: true });
    }
  }, [catalog.selectedIndex]);

  // Sync: cada producto muestra en su input la cantidad de la línea del carrito
  // que coincide con el MODO ACTUAL del switch (POR_UNIDAD si "Vender por
  // unidad" está ON y el producto es un multi-pack elegible; si no, BOLSA_CERRADA).
  // Los que no están en el carrito arrancan en "1".
  useEffect(() => {
    setQtyByKey((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const it of cart.items) {
        const product = catalog.items.find(
          (p) => (p._id || p.id) === it.productId,
        );
        if (!product) continue;
        const currentMode = saleModeForProduct(product, unitMode);
        if ((it.saleMode ?? "BOLSA_CERRADA") !== currentMode) continue;
        const s = String(formatBolsaQty(it.quantity));
        if (next[it.productId] !== s) {
          next[it.productId] = s;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [cart.items, catalog.items, unitMode]);

  const keyOf = useCallback((p: DataItem) => (p._id || p.id) || "", []);

  // Modo de venta de la fila según el switch global "Vender por unidad"
  // (default caja / bolsa cerrada). La vista del catálogo y el commit usan este
  // modo para saber si agregan la línea POR_UNIDAD o BOLSA_CERRADA.
  const modeFor = useCallback(
    (p: DataItem): SaleMode => saleModeForProduct(p, unitMode),
    [unitMode],
  );

  // Máximo vendible según el modo de la fila: una línea de UNIDADES admite el
  // stock total en unidades; una línea de CAJAS admite solo las cajas completas.
  const maxSellable = useCallback(
    (p: DataItem): number => {
      const units = unitStock(p);
      if (modeFor(p) === "POR_UNIDAD") return units;
      const ub = Number(p.unitsPerBox);
      return isUnitSellable(p.unitsPerBox) && ub > 0
        ? Math.floor(units / ub)
        : units;
    },
    [modeFor],
  );

  const itemFor = useCallback(
    (p: DataItem, mode: SaleMode) =>
      cart.items.find(
        (i) =>
          i.productId === keyOf(p) &&
          (i.saleMode ?? "BOLSA_CERRADA") === mode &&
          (i.loosePriceId ?? null) === null,
      ),
    [cart.items, keyOf],
  );

  const setQtyFor = useCallback(
    (index: number, value: string) => {
      const p = catalog.items[index];
      if (!p) return;
      if (value === "" || /^\d*$/.test(value)) {
        setQtyByKey((prev) => ({ ...prev, [keyOf(p)]: value }));
      }
    },
    [catalog.items, keyOf],
  );

  const qtyValue = useCallback(
    (index: number) => {
      const p = catalog.items[index];
      return p ? (qtyByKey[keyOf(p)] ?? "1") : "1";
    },
    [catalog.items, qtyByKey, keyOf],
  );

  const increment = useCallback(
    (index: number) => {
      const p = catalog.items[index];
      if (!p) return;
      const key = keyOf(p);
      const cur = parseDecimal(qtyByKey[key] ?? "1");
      const base = Number.isNaN(cur) ? 1 : Math.max(1, Math.round(cur));
      const max = maxSellable(p);
      setQtyByKey((prev) => ({ ...prev, [key]: String(Math.min(max, base + 1)) }));
    },
    [catalog.items, qtyByKey, keyOf, maxSellable],
  );

  const decrement = useCallback(
    (index: number) => {
      const p = catalog.items[index];
      if (!p) return;
      const key = keyOf(p);
      const cur = parseDecimal(qtyByKey[key] ?? "1");
      const base = Number.isNaN(cur) ? 1 : Math.max(1, Math.round(cur));
      setQtyByKey((prev) => ({ ...prev, [key]: String(Math.max(1, base - 1)) }));
    },
    [catalog.items, qtyByKey, keyOf],
  );

  const commit = useCallback(
    (index: number) => {
      const p = catalog.items[index];
      if (!p) return;
      const stock = branchQty(p);
      if (stock <= 0) {
        toast.error("Producto sin stock");
        return;
      }
      const key = keyOf(p);
      const cur = parseDecimal(qtyByKey[key] ?? "1");
      const qty = Number.isNaN(cur) ? 1 : Math.max(1, Math.round(cur));
      // Multi-pack: la fila puede estar en modo "Caja" o "Por unidad". El commit
      // agrega/actualiza la línea del MODO actual (líneas distintas por modo).
      const mode = modeFor(p);
      const existing = itemFor(p, mode);
      if (existing) {
        cart.updateQuantity(key, qty, mode);
      } else {
        cart.addToCart(p, qty, branchId, stock, mode);
      }
      toast.success(`"${p.name}" agregado al pedido`);
    },
    [catalog.items, qtyByKey, keyOf, modeFor, itemFor, cart, branchId],
  );

  const registerInput = useCallback((index: number, el: HTMLInputElement | null) => {
    inputRefs.current[index] = el;
  }, []);

  // ── Vuelta desde el panel (←): enfocar el listado ──
  // Si hay fila activa la enfoca; si no, selecciona la primera (el efecto la
  // enfoca). Garantiza que ← desde el panel siempre vuelva a la planilla.
  const focusSelectedRow = useCallback(() => {
    if (catalog.selectedIndex >= 0) {
      inputRefs.current[catalog.selectedIndex]?.focus({ preventScroll: true });
    } else if (catalog.items.length > 0) {
      catalog.setSelectedIndex(0);
    }
  }, [catalog.selectedIndex, catalog.items.length, catalog.setSelectedIndex]);

  useEffect(() => {
    registerGridApi?.({ focusSelectedRow, clearSearch: catalog.clearSearch });
  }, [focusSelectedRow, registerGridApi, catalog.clearSearch]);

  const enabled = useCallback((index: number) => {
    const p = catalog.items[index];
    return !!p && branchQty(p) > 0;
  }, [catalog.items]);

  // Memoizado para no perder el memo de ProductTable en cada tecla del
  // buscador (el valor de la fila cambia solo al editar su cantidad o al
  // cambiar el listado).
  const inlineQty = useMemo(
    () => ({
      value: qtyValue,
      onChange: setQtyFor,
      onCommit: commit,
      registerInput,
      disabled: enabled,
    }),
    [qtyValue, setQtyFor, commit, registerInput, enabled],
  );

  // ── Teclado (↑/↓ +/− Enter) sobre las filas ──
  useVendorRowsKeyboard({
    searchInputRef: catalog.searchInputRef,
    containerRef: rootRef,
    hasRows: catalog.items.length > 0,
    selectedIndex: catalog.selectedIndex,
    moveDown: () => catalog.moveSelection(1),
    moveUp: () => catalog.moveSelection(-1),
    selectFirst: () => catalog.selectFirst(),
    onIncrement: () => {
      if (catalog.selectedIndex >= 0) increment(catalog.selectedIndex);
    },
    onDecrement: () => {
      if (catalog.selectedIndex >= 0) decrement(catalog.selectedIndex);
    },
    onCommitRow: () => {
      if (catalog.selectedIndex >= 0) commit(catalog.selectedIndex);
    },
    onEnterPanel,
    onToggleTab,
    cartItems: cart.items,
    handleSaveOrder: onSaveOrder,
    handleConfirmSale: onConfirmSale,
  });

  // ProductDrawer for viewing stock across all branches
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerProduct, setDrawerProduct] = useState<DataItem | null>(null);

  const openDrawer = useCallback((product: DataItem) => {
    setDrawerProduct(product);
    setDrawerOpen(true);
  }, []);

  const resetSelection = useCallback(() => {
    catalog.resetSelection();
    inputRefs.current = [];
  }, [catalog]);

  const handleRowClick = useCallback(
    (index: number) => {
      catalog.setSelectedIndex(index);
    },
    [catalog.setSelectedIndex],
  );

  const searchEnter = useCallback(
    (product: DataItem) => {
      const idx = catalog.items.findIndex(
        (p) => (p._id || p.id) === (product._id || product.id),
      );
      if (idx >= 0) {
        catalog.setSelectedIndex(idx);
        commit(idx);
      }
    },
    [catalog.items, catalog.setSelectedIndex, commit],
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      catalog.setFilter(value);
      resetSelection();
    },
    [catalog.setFilter, resetSelection],
  );

  const handleFilterChange = useCallback(
    (f: string) => {
      catalog.setFilter(f);
      resetSelection();
    },
    [catalog.setFilter, resetSelection],
  );

  const handleCategoryChange = useCallback(
    (c: string) => {
      catalog.setCategoryFilter(c);
      resetSelection();
    },
    [catalog.setCategoryFilter, resetSelection],
  );

  const handleTitleChange = useCallback(
    (key: string | null) => {
      catalog.setTitleFilter(key);
      resetSelection();
    },
    [catalog.setTitleFilter, resetSelection],
  );

  const handleClearFilters = useCallback(() => {
    catalog.setFilter("");
    catalog.setCategoryFilter("");
    catalog.setTitleFilter(null);
    resetSelection();
  }, [catalog.setFilter, catalog.setCategoryFilter, catalog.setTitleFilter, resetSelection]);

  const handleAssignBarcode = useCallback(
    (product: DataItem) => {
      const id = product._id || product.id;
      sessionStorage.setItem(
        VENDOR_FILTER_KEY,
        JSON.stringify({
          filter: catalog.filter,
          categoryFilter: catalog.categoryFilter,
          branchId,
        } satisfies StoredFilter),
      );
      navigate(`/scanner?assignTo=${id}`);
    },
    [catalog.filter, catalog.categoryFilter, branchId, navigate],
  );

  if (catalog.isLoadingInitial) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader />
      </div>
    );
  }

  return (
    <div ref={rootRef} className="space-y-4 min-h-0 lg:flex lg:flex-1 lg:flex-col lg:space-y-0">
      {/* ── Search + filters (fijos arriba; la lista scrollea debajo) ── */}
      <div className="z-20 space-y-4 border-b bg-background px-4 pb-3 pt-3 sm:px-6 lg:px-8 lg:shrink-0">
        <VendorSearchBar
          value={catalog.filter}
          onChange={handleSearchChange}
          selectedIndex={catalog.selectedIndex}
          items={catalog.items}
          onOpenQty={searchEnter}
          inputRef={catalog.searchInputRef}
        />
        <FilterChips
          products={catalog.items}
          quickCategories={catalog.facetsCategories.map((c) => c.name)}
          quickVariants={catalog.facetsVariants}
          titles={catalog.facetsTitles}
          titleFilter={catalog.titleFilter}
          onTitleChange={handleTitleChange}
          filter={catalog.filter}
          categoryFilter={catalog.categoryFilter}
          onFilterChange={handleFilterChange}
          onCategoryChange={handleCategoryChange}
          onClear={handleClearFilters}
        />
        {/* "Solo lo que trabajo": oculta productos desmarcados (carried=false).
            Default ON. El toggle permite ver todo el catálogo al apagarlo. */}
        <div className="flex flex-wrap items-center gap-2">
          <Switch
            id="only-carried"
            checked={catalog.onlyCarried}
            onCheckedChange={(v) => {
              catalog.setOnlyCarried(v);
              catalog.resetSelection();
            }}
          />
          <Label htmlFor="only-carried" className="cursor-pointer text-sm font-medium">
            Solo lo que trabajo
          </Label>
          {!catalog.onlyCarried && (
            <span className="text-xs text-muted-foreground">
              Mostrando todo el catálogo
            </span>
          )}
          <Switch
            id="sell-by-unit"
            checked={unitMode}
            onCheckedChange={(v) => {
              setUnitMode(v);
              catalog.resetSelection();
            }}
          />
          <Label htmlFor="sell-by-unit" className="cursor-pointer text-sm font-medium">
            Pouch por unidad
          </Label>
        </div>
      </div>

      {/* ── Zona de la lista: toma el espacio sobrante de la columna flex y
             scrollea internamente (la altura la da el flex, sin números mágicos) ── */}
      <div
        ref={catalog.scrollRef}
        className="min-h-0 overflow-y-auto lg:flex-1"
        style={{ position: "relative" }}
      >
        {/* ── Product grid ── */}
        {catalog.items.length === 0 ? (
          <div className="py-12 text-center space-y-3">
            <p className="text-muted-foreground">
              {catalog.filter || catalog.categoryFilter || catalog.titleFilter
                ? "Sin resultados con estos filtros."
                : "No hay productos."}
            </p>
            {(catalog.filter || catalog.categoryFilter || catalog.titleFilter) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  catalog.setFilter("");
                  catalog.setCategoryFilter("");
                  catalog.setTitleFilter(null);
                }}
              >
                Limpiar filtros
              </Button>
            )}
          </div>
        ) : (
          <ProductTable
            items={catalog.items}
            cartItems={cart.items}
            selectedIndex={catalog.selectedIndex}
            registerRow={catalog.registerRow}
            onRowClick={handleRowClick}
            onOpenDrawer={openDrawer}
            onAssignBarcode={handleAssignBarcode}
            inlineQty={inlineQty}
            unitMode={unitMode}
          />
        )}

        {/* ── Infinite scroll: sentinel + "load more" footer ── */}
        {catalog.hasNextPage && (
          <div className="flex items-center justify-center py-6">
            {catalog.isFetchingNextPage ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader />
                <span>Cargando más…</span>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">
                Desplazate para cargar más productos
              </span>
            )}
          </div>
        )}
        <div ref={catalog.sentinelRef} className="h-1" aria-hidden="true" />
      </div>

      {/* ── Product Drawer (stock across all branches) ── */}
      <ProductDrawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setDrawerProduct(null);
        }}
        product={drawerProduct}
        readOnly
      />
    </div>
  );
};

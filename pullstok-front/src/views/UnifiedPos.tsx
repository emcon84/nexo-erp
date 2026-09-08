import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Landmark, ShoppingCart } from "lucide-react";
import { toast } from "react-toastify";
import { API_URL } from "@/constants";
import { VendorCatalogTab } from "@/components/organisms/VendorCatalogTab";
import { LooseSellTab } from "@/components/organisms/LooseSellTab";
import { useVendorCart } from "@/components/hooks/useVendorCart";
import { useVendorCheckout } from "@/components/hooks/useVendorCheckout";
import { useGetCurrentCashSession } from "@/components/hooks/useCashSession";
import { VendorOrderPanel, type VendorOrderPanelApi } from "@/components/molecules/VendorOrderPanel";
import { Loader } from "@/components/atoms/loader";
import { Button } from "@/components/ui/button";
import { imgSrc } from "@/components/hooks/vendorCatalogHelpers";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Tab = "unidad" | "suelto";

// Producto devuelto por GET /products/by-scan (rama no-balanza) que se muestra
// en el modal de confirmación antes de sumarlo como BOLSA_CERRADA al pedido.
interface ScannedProduct {
  id?: string;
  _id?: string;
  name: string;
  price?: number | string;
  code?: string | null;
  barcode?: string | null;
  image?: string | null;
  category?: { name?: string } | null;
  quantity?: number | string;
  priceKgSuelto?: number | null;
  unitsPerBox?: number | null;
}

interface UnifiedPosProps {
  branchId: string;
}

/**
 * POS unificado del vendedor: UNA sola venta con dos pestañas que comparten el
 * MISMO carrito, y un PANEL de pedido siempre visible a la derecha.
 * - "Por unidad": catálogo de bolsas con carga inline (VendorCatalogTab).
 * - "Suelto": planilla marca × tipo → celda (LooseSellTab).
 * Un único carrito (useVendorCart), un solo checkout y un panel fijo que
 * muestra y cierra el pedido MIXTO (BOLSA_CERRADA + POR_PESO/POR_MONTO).
 */
export const UnifiedPos = ({ branchId }: UnifiedPosProps) => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("unidad");

  // Producto de BOLSA CERRADA escaneado, pendiente de confirmación en el modal.
  // null = sin modal abierto. La rama balanza (isScale) NO pasa por acá: se
  // agrega directo al pedido (flujo suelto intacto).
  const [scanProduct, setScanProduct] = useState<ScannedProduct | null>(null);

  // Modal de pago: lo abre la tecla V (listado y panel) y el botón Vender.
  const [paymentOpen, setPaymentOpen] = useState(false);
  const openPayment = useCallback(() => setPaymentOpen(true), []);

  // Carrito ÚNICO de todo el POS (compartido entre ambas pestañas vía props).
  const cart = useVendorCart();
  const checkout = useVendorCheckout({
    branchId,
    cartItems: cart.items,
    clearCart: cart.clearCart,
    totalAmount: cart.totalAmount,
  });
  // Caja OPEN del vendedor (R8/R9): GATE — sin caja abierta no se puede vender
  // ni guardar pedido; también se propaga al confirmar la venta.
  const { session: currentSession, loading: cashLoading } = useGetCurrentCashSession(branchId);

  // ── Navegación por teclado entre el listado y el panel de pedido ──
  // El listado (tab) y el panel se registran acá para saltar de zona con las
  // flechas: ↓ en la última fila → panel; ↑ en el primer control → listado.
  const panelApiRef = useRef<VendorOrderPanelApi | null>(null);
  const gridApiRef = useRef<{ focusSelectedRow: () => void } | null>(null);

  const focusPanelFirst = useCallback(() => {
    panelApiRef.current?.focusFirstControl();
  }, []);

  const exitToGrid = useCallback(() => {
    gridApiRef.current?.focusSelectedRow();
  }, []);

  const registerGridApi = useCallback(
    (api: { focusSelectedRow: () => void }) => {
      gridApiRef.current = api;
    },
    [],
  );

  // Tecla T: alterna entre "Por unidad" y "Suelto".
  const toggleTab = useCallback(() => {
    setTab((t) => (t === "unidad" ? "suelto" : "unidad"));
  }, []);

  // ── Escaneo de la pistola (balanza / barcode) ──
  // La pistola USB HID emula teclado: tipea los dígitos y manda Enter. Acá
  // capturamos un run de dígitos terminado en Enter, llamamos a /by-scan y:
  //  - etiqueta de balanza (isScale) → agrega el producto con POR_PESO y el
  //    peso en kg (el backend calculó total = peso × precio/kg). FLUJO INTACTO.
  //  - código normal (bolsa cerrada) → NO agrega en el acto: abre un modal de
  //    confirmación con el producto y su precio; recién al confirmar se suma
  //    como BOLSA_CERRADA (qty 1).
  const handleScan = useCallback(
    async (barcode: string) => {
      if (!barcode || !/^\d+$/.test(barcode)) return;
      try {
        const token = localStorage.getItem("token") || "";
        const res = await fetch(
          `${API_URL}/products/by-scan/${encodeURIComponent(barcode)}`,
          { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } },
        );
        if (res.status === 404) {
          toast.error("Producto no encontrado para ese código");
          return;
        }
        if (!res.ok) {
          const err = await res.json().catch(() => ({ message: "Error al procesar el código" }));
          toast.error(err.message || "Error al procesar el código");
          return;
        }
        const data = await res.json();

        if (data.isScale) {
          cart.addToCart(
            {
              _id: data.cell.id,
              id: data.cell.id,
              name: data.looseName,
              price: data.priceKg,
              priceKgSuelto: data.priceKg,
              quantity: 0,
              category: "",
            },
            data.weightKg,
            branchId,
            0, // stock lo resuelve el backend (LooseStock de la celda)
            "POR_PESO",
            data.priceKg,
            data.cell.id, // loosePriceId = celda de la planilla
            data.looseName,
          );
          toast.success(
            `${data.looseName}: ${data.weightKg.toFixed(3)} kg → $${(data.total ?? 0).toLocaleString("es-AR")}`,
          );
        } else {
          // Bolsa cerrada: abrimos el modal de confirmación con producto+precio
          // en lugar de sumar directo. La balanza (isScale) NUNCA llega acá.
          setScanProduct(data.product);
        }
      } catch (e: any) {
        toast.error(e?.message || "Error al escanear");
      }
    },
    [cart, branchId],
  );

  // ── Modal de confirmación de bolsa cerrada escaneada ──
  const handleCancelScan = useCallback(() => setScanProduct(null), []);

  const handleConfirmScan = useCallback(() => {
    if (!scanProduct) return;
    const p = scanProduct;
    cart.addToCart(
      {
        _id: p._id || p.id,
        id: p.id,
        name: p.name,
        price: p.price ?? 0,
        priceKgSuelto: p.priceKgSuelto ?? null,
        quantity: 0,
        category: p.category?.name ?? "",
        image: p.image ?? undefined,
        code: p.code ?? "",
        unitsPerBox: p.unitsPerBox ?? null,
      },
      1,
      branchId,
      Number(p.quantity ?? 0),
    );
    toast.success(`${p.name} agregado`);
    setScanProduct(null);
  }, [cart, branchId, scanProduct]);

  // Capturador global (fase CAPTURE) del patrón de la pistola. Reset si hay
  // letras o pausas largas; solo un run de dígitos (≥6) + Enter se trata como
  // escaneo. Números cortos y texto no se interceptan.
  useEffect(() => {
    let buffer = "";
    let lastKeyAt = 0;
    const onKey = (e: KeyboardEvent) => {
      const now = Date.now();
      const gap = now - lastKeyAt;
      if (gap > 400) buffer = "";
      lastKeyAt = now;

      if (e.key === "Enter") {
        const code = buffer;
        buffer = "";
        if (code.length >= 6 && /^\d+$/.test(code)) {
          e.preventDefault();
          e.stopPropagation();
          void handleScan(code);
        }
        return;
      }
      if (/^\d$/.test(e.key)) {
        // La pistola manda los dígitos en ráfaga muy rápida (<60ms). Si ya hay
        // buffer (escaneo en curso) y el dígito llega en ráfaga, lo prevenimos
        // para que NO se escriba en el input enfocado (buscador) y no se mezcle
        // con lo que el operador tipea. El tipeo humano (más lento, >100ms) no
        // se intercepta.
        if (buffer.length > 0 && gap < 60) {
          e.preventDefault();
          e.stopPropagation();
        }
        buffer += e.key;
      } else {
        buffer = "";
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [handleScan]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "unidad", label: "Por unidad" },
    { id: "suelto", label: "Suelto" },
  ];

  // ── Gate: la caja del día debe estar abierta para vender/guardar pedidos ──
  if (cashLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader />
      </div>
    );
  }
  if (!currentSession) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          <Landmark className="h-6 w-6 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">Caja no abierta</h2>
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">
            Para vender o guardar pedidos necesitás tener abierta la caja del día
            en esta sucursal.
          </p>
        </div>
        <Button onClick={() => navigate("/caja")}>Abrir caja</Button>
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
      {/* ── Columna izquierda: header + tabs + contenido ── */}
      <div className="min-w-0 space-y-4 lg:flex lg:h-[calc(100vh_-_2rem)] lg:flex-col lg:space-y-0 lg:overflow-hidden">
        <div className="space-y-4 lg:shrink-0">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Nueva venta</h1>
            <p className="text-sm text-muted-foreground">
              Vendé por unidad o suelto desde el mismo pedido
            </p>
          </div>

          {/* ── Segmented tabs ── */}
          <div className="flex w-fit gap-1 rounded-lg bg-muted p-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex-1 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors",
                  tab === t.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Pestaña activa. En desktop la columna queda fija y es la LISTA la
             que scrollea internamente (buscador/filtros fijos arriba) ── */}
        <div className="min-h-0 lg:flex-1 lg:flex lg:flex-col lg:pr-1">
          {tab === "unidad" ? (
            <VendorCatalogTab
              branchId={branchId}
              cart={cart}
              onSaveOrder={checkout.handleSaveOrder}
              onConfirmSale={openPayment}
              onEnterPanel={focusPanelFirst}
              onToggleTab={toggleTab}
              registerGridApi={registerGridApi}
            />
          ) : (
            <LooseSellTab
              branchId={branchId}
              cart={cart}
              onSaveOrder={checkout.handleSaveOrder}
              onConfirmSale={openPayment}
              onEnterPanel={focusPanelFirst}
              onToggleTab={toggleTab}
              registerGridApi={registerGridApi}
            />
          )}
        </div>
      </div>

      {/* ── Columna derecha: panel de pedido SIEMPRE visible ── */}
      <VendorOrderPanel
        cart={cart}
        status={{
          confirming: checkout.confirming,
          savingOrder: checkout.savingOrder,
        }}
        saveOrder={checkout.handleSaveOrder}
        confirmSale={checkout.handleConfirmSale}
        cashSessionId={currentSession?.id}
        apiRef={panelApiRef}
        onExitToGrid={exitToGrid}
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        className="lg:sticky lg:top-4 lg:max-h-[calc(100vh_-_2rem)]"
      />
    </div>

    {/* ── Modal de confirmación de bolsa cerrada escaneada ── */}
    <Dialog open={!!scanProduct} onOpenChange={(open) => !open && handleCancelScan()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{scanProduct?.name}</DialogTitle>
          <DialogDescription>
            Producto escaneado — confirmá para sumarlo al pedido
          </DialogDescription>
        </DialogHeader>

        {scanProduct?.image && imgSrc(scanProduct.image) && (
          <div className="flex justify-center">
            <img
              src={imgSrc(scanProduct.image)!}
              alt={scanProduct.name}
              className="h-32 w-32 object-cover rounded-lg"
            />
          </div>
        )}

        {(scanProduct?.code || scanProduct?.barcode) && (
          <div className="space-y-1 text-sm text-muted-foreground">
            {scanProduct.code && (
              <p>
                Código:{" "}
                <span className="font-medium text-foreground">{scanProduct.code}</span>
              </p>
            )}
            {scanProduct.barcode && (
              <p>
                Código de barras:{" "}
                <span className="font-medium text-foreground">{scanProduct.barcode}</span>
              </p>
            )}
          </div>
        )}

        <div className="flex items-baseline justify-between rounded-lg bg-muted p-3">
          <span className="text-sm text-muted-foreground">Precio por unidad</span>
          <span className="text-2xl font-bold tabular-nums">
            ${Number(scanProduct?.price ?? 0).toLocaleString("es-AR")}
          </span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancelScan}>
            Cancelar
          </Button>
          <Button autoFocus onClick={handleConfirmScan}>
            <ShoppingCart className="h-4 w-4 mr-2" />
            Agregar al pedido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
};

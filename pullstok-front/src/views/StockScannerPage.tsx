import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useSearchParams, useInRouterContext, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Camera, CameraOff, Plus, Minus, Search, Link2, X, Barcode, Copy, ArrowLeft } from "lucide-react";
import { ProductDrawer } from "@/components/molecules/ProductDrawer";
import { useProductStock } from "@/components/hooks/useProductStock";
import { useBranches } from "@/components/hooks/useBranches";
import { unitStock } from "@/components/hooks/vendorCatalogHelpers";
import { resolveScannerBranchMode } from "@/constants/rolePermissions";
import type { Role } from "@/constants/rolePermissions";
import type { DataItem } from "@/types";
import { formatCurrency } from "@/utils/statsHelpers";
import {
  ensureOfflineCatalog,
  lookupProductByCode,
  searchProducts as searchOfflineProducts,
  syncOfflineCatalog,
  isCatalogStale,
} from "@/lib/offlineCatalog";
import type { OfflineProduct } from "@/lib/offlineCatalog";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

/** Minimal typing for the (non-standard) BarcodeDetector browser API. */
interface BarcodeDetectorLike {
  detect(video: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
type BarcodeDetectorClass = {
  new (options: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats(): Promise<string[]>;
};

interface Product {
  id: string; name: string; code: string; barcode: string; price: number;
  quantity: number; description: string | null;
  weightKg?: number; priceKgSuelto?: number;
  priceKgSueltoManual?: boolean;
  priceKgLista?: number; // Precio por kg de la LISTA de suelto (PriceKgPrice)
  category: { name: string } | null; categoryId?: string;
  variantAssignments?: { option: { id: string; value: string; variantId?: string; variant: { name: string } } }[];
}

/** Mapea un producto del catálogo offline al shape que usa el scanner. */
function mapOfflineProduct(p: OfflineProduct): Product {
  return {
    id: p.id,
    name: p.name,
    code: p.code ?? "",
    barcode: p.barcode ?? "",
    price: p.price,
    quantity: 0,
    description: p.description,
    priceKgSuelto: p.priceKgSuelto ?? undefined,
    priceKgSueltoManual: p.priceKgSueltoManual,
    priceKgLista: p.priceKgLista ?? undefined,
    category: p.categoryName ? { name: p.categoryName } : null,
    categoryId: p.categoryId ?? undefined,
    variantAssignments: (p.variants || []).map((v) => ({
      option: {
        id: v.optionId,
        value: v.value,
        variantId: v.variantId ?? undefined,
        variant: { name: v.variantName },
      },
    })),
  };
}

export const StockScannerPage = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [scanning, setScanning] = useState(false);
  const scanningRef = useRef(false);
  const [manualCode, setManualCode] = useState("");
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(false);
  const [adjustQty, setAdjustQty] = useState("");
  // Asignar/editar precio por kg directo desde el scanner (PUT priceKgSuelto).
  const [kgEditOpen, setKgEditOpen] = useState(false);
  const [kgInput, setKgInput] = useState("");
  // Editar el PRECIO del producto (normal) directo desde el scanner (PUT price).
  const [priceEditOpen, setPriceEditOpen] = useState(false);
  const [priceInput, setPriceInput] = useState("");
  const lastScannedRef = useRef("");

  // Assignment panel
  const [notFoundCode, setNotFoundCode] = useState("");
  const [assignOpen, setAssignOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [correctingBarcode, setCorrectingBarcode] = useState(false);
  const correctingRef = useRef(false);
  const [reassignFromId, setReassignFromId] = useState<string | null>(null);

  // Duplicate product drawer
  const [dupProduct, setDupProduct] = useState<DataItem | null>(null);
  const [dupDrawerOpen, setDupDrawerOpen] = useState(false);
  const [dupBarcode, setDupBarcode] = useState("");

  // -------------------------------------------------------------------------
  // Branch-aware stock (spec F2 / design D3): the scanner adjusts the
  // ProductStock of the user's effective branch, never the global quantity.
  // The branchIds from the login are only a UX hint; the server re-reads the
  // BranchAssignment on every PUT.
  // -------------------------------------------------------------------------
  const currentUser = (() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      return null;
    }
  })();
  const userRole = currentUser?.role as Role | undefined;
  // Solo admin/gestión pueden editar el precio del producto desde el scanner.
  const canEditPrice =
    userRole === "ADMIN" || userRole === "MANAGEMENT" || userRole === "SUPERADMIN";
  const userBranchIds = currentUser?.branchIds as string[] | undefined;

  const mode = resolveScannerBranchMode(userRole, userBranchIds);
  // ADMIN/MANAGEMENT pick from ALL branches (GET /branches is admin-only);
  // VENDEDOR/CASHIER with several assignments pick among their own, named by
  // the self-contained stock response (no extra permission needed).
  const isAdminSelector = mode.kind === "selector" && !mode.branchIds;
  const { branches: allBranches } = useBranches(isAdminSelector);

  const { stock, updateBranchStock: saveBranchStock } =
    useProductStock(product?.id);

  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);

  // Default the admin selector to the first branch once loaded.
  useEffect(() => {
    if (isAdminSelector && allBranches.length > 0 && !selectedBranchId) {
      setSelectedBranchId(allBranches[0].id);
    }
  }, [isAdminSelector, allBranches, selectedBranchId]);

  const restrictedOptions =
    mode.kind === "selector" && mode.branchIds
      ? (stock?.branches.filter((b) => mode.branchIds!.includes(b.branchId)) ?? [])
      : [];

  const effectiveBranchId = useMemo(() => {
    if (mode.kind === "single") return mode.branchId;
    if (mode.kind === "selector") {
      if (mode.branchIds) return selectedBranchId ?? mode.branchIds[0] ?? null;
      return selectedBranchId;
    }
    return null;
  }, [mode, selectedBranchId]);

  const effectiveBranchInfo = stock?.branches.find(
    (b) => b.branchId === effectiveBranchId,
  );

  // The stock response is the source of truth once loaded; until then the
  // legacy global quantity is a placeholder (it equals the HQ stock).
  const [displayQty, setDisplayQty] = useState<number | null>(null);
  const effectiveQty = effectiveBranchInfo?.quantity;
  useEffect(() => {
    if (effectiveQty !== undefined) setDisplayQty(effectiveQty);
  }, [effectiveQty, effectiveBranchId]);
  const shownQty =
    displayQty ?? (product ? unitStock(product as unknown as DataItem) : 0);

  // Precio por kg efectivo para mostrar: gana el MANUAL (asignado desde el
  // scanner, priceKgSueltoManual=true); si no, el de la LISTA de suelto (celda
  // PriceKgPrice). Si no hay ninguno → null (se muestra el botón Asignar).
  const effectiveKg = product
    ? ((product.priceKgSueltoManual ? product.priceKgSuelto : null) ??
        product.priceKgLista ??
        null)
    : null;

  // Editing requires a known branch AND its current quantity: writing a
  // +/- step without the real value could store a wrong number.
  const canAdjust = effectiveBranchId != null && !!effectiveBranchInfo;

  const token = localStorage.getItem("token") || "";
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" }),
    [token],
  );

  // Preload + assign mode: coming from the vendor list with ?assignTo=<productId>
  // (e.g. /scanner?assignTo=abc) preselects the product and arms the correction
  // flow so the NEXT scanned/typed code is written to that product. Without the
  // param this page behaves exactly as a plain scanner.
  const inRouter = useInRouterContext();
  const [searchParams] = inRouter ? useSearchParams() : [null];
  const navigate = inRouter ? useNavigate() : null;
  const assignToId = searchParams?.get("assignTo") || null;

  useEffect(() => {
    if (!assignToId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_URL}/products/${encodeURIComponent(assignToId)}`,
          { headers },
        );
        const data = await res.json();
        if (cancelled) return;
        if (res.ok && data.id) {
          setProduct(data);
          setCorrectingBarcode(true);
          correctingRef.current = true;
          lastScannedRef.current = "";
        } else {
          toast.error(data.message || "No se encontró el producto");
        }
      } catch {
        toast.error("Error al cargar el producto");
      }
    })();
    return () => { cancelled = true; };
  }, [assignToId, headers]);

  const playBeep = () => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880; osc.type = "sine";
      gain.gain.value = 0.15;
      osc.start(); osc.stop(ctx.currentTime + 0.12);
    } catch { /* best-effort audio feedback; ignore failures */ }
  };

  const lookupProduct = async (code: string) => {
    const c = code.trim();
    if (!c) return;
    if (c === lastScannedRef.current && !correctingRef.current) return;
    lastScannedRef.current = c;
    setManualCode(c);

    // Correction mode: update barcode of current product
    if (correctingRef.current && product) {
      setLoading(true);
      try {
        const res = await fetch(`${API_URL}/products/${product.id}`, {
          method: "PUT", headers,
          body: JSON.stringify({ barcode: c }),
        });
        const data = await res.json();
        if (res.ok && data.id) {
          setProduct(data);
          setCorrectingBarcode(false);
          correctingRef.current = false;
          lastScannedRef.current = "";
          toast.success("Código corregido");
          playBeep();
          stopScanner();
        } else {
          toast.error(data.message || "Error al actualizar código");
        }
      } catch { toast.error("Error de conexión"); }
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // 1) LOCAL primero: catálogo en IndexedDB/memoria (instantáneo + offline).
      const local = lookupProductByCode(c);
      if (local) {
        setProduct(mapOfflineProduct(local));
        setAssignOpen(false);
        lastScannedRef.current = "";
        stopScanner();
        playBeep();
        toast.success(local.name);
        setLoading(false);
        return;
      }
      // 2) OFFLINE y no está en el catálogo local → no se puede resolver.
      if (!navigator.onLine) {
        setProduct(null);
        setNotFoundCode(c);
        setSearchQuery("");
        setSearchResults([]);
        setAssignOpen(true);
        stopScanner();
        toast.error("Sin conexión: el código no está en el catálogo offline");
        setTimeout(() => searchInputRef.current?.focus(), 300);
        setLoading(false);
        return;
      }
      // 3) ONLINE: fallback a la API (by-code).
      const res = await fetch(`${API_URL}/products/by-code/${encodeURIComponent(c)}`, { headers });
      const data = await res.json();
      playBeep();
      if (!res.ok) {
        setProduct(null);
        setNotFoundCode(c);
        setSearchQuery("");
        setSearchResults([]);
        setAssignOpen(true);
        stopScanner();
        setTimeout(() => searchInputRef.current?.focus(), 300);
      } else {
        setProduct(data);
        setAssignOpen(false);
        lastScannedRef.current = "";
        stopScanner();
        toast.success(data.name);
      }
    } catch { toast.error("Error al buscar"); }
    setLoading(false);
  };

  const searchProducts = useCallback(async (q: string) => {
    if (q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    if (navigator.onLine) {
      // ONLINE: la API es la fuente de verdad (refleja productos borrados).
      // Si la API vuelve vacía, mostramos vacío — NO caemos al catálogo local,
      // porque ese snapshot puede estar desactualizado y mostrar un producto
      // que ya se eliminó (bug: "el producto sigue apareciendo").
      try {
        const res = await fetch(`${API_URL}/products?name=${encodeURIComponent(q)}`, { headers });
        const data = await res.json();
        const apiHits = (Array.isArray(data) ? data : []).slice(0, 12) as Product[];
        setSearchResults(apiHits);
      } catch {
        // Error de conexión → usamos el catálogo local como respaldo.
        const local = searchOfflineProducts(q, 12);
        setSearchResults(local.map(mapOfflineProduct));
      }
      setSearching(false);
      return;
    }
    // OFFLINE: solo el catálogo local (snapshot).
    const local = searchOfflineProducts(q, 12);
    setSearchResults(local.map(mapOfflineProduct));
    setSearching(false);
  }, [headers]);

  const assignCode = async (productId: string) => {
    setAssigning(true);
    try {
      // If reassigning, first clear barcode from old product
      if (reassignFromId && reassignFromId !== productId) {
        await fetch(`${API_URL}/products/${reassignFromId}`, {
          method: "PUT", headers,
          body: JSON.stringify({ barcode: null }),
        });
        setReassignFromId(null);
      }
      const res = await fetch(`${API_URL}/products/${productId}`, {
        method: "PUT", headers,
        body: JSON.stringify({ barcode: notFoundCode }),
      });
      const data = await res.json();
      if (res.ok && data.id) {
        setProduct(data);
        setAssignOpen(false);
        lastScannedRef.current = "";
        toast.success("¡Código asignado!");
        playBeep();
        stopScanner();
      } else {
        toast.error(data.message || "Error al asignar código");
      }
    } catch { toast.error("Error de conexión"); }
    setAssigning(false);
  };

  const openDuplicateDrawer = (p: Product) => {
    setDupBarcode(notFoundCode);
    setDupProduct({
      name: p.name,
      code: "",
      price: p.price,
      quantity: p.quantity,
      categoryId: p.categoryId || null,
      description: p.description || "",
      image: undefined,
      variantAssignments: (p.variantAssignments || []).map(va => ({
        option: { id: va.option.id, value: va.option.value, variantId: va.option.variantId, variant: va.option.variant },
      })),
    } as DataItem);
    setDupDrawerOpen(true);
  };

  const handleDuplicateCreated = async (newProduct: DataItem) => {
    setDupDrawerOpen(false);
    setDupProduct(null);
    if (!dupBarcode || !newProduct.id) return;
    try {
      const res = await fetch(`${API_URL}/products/${newProduct.id}`, {
        method: "PUT", headers,
        body: JSON.stringify({ barcode: dupBarcode }),
      });
      const assigned = await res.json();
      if (res.ok && assigned.id) {
        setProduct(assigned);
        setAssignOpen(false);
        lastScannedRef.current = "";
        toast.success("¡Producto duplicado y código asignado!");
        playBeep();
        stopScanner();
      } else {
        toast.success("Producto duplicado. Asigná el código manualmente.");
        setAssignOpen(false);
        setProduct(null);
      }
    } catch { toast.error("Error al asignar código"); }
    setDupBarcode("");
  };

  const startScanner = async () => {
    if (!correctingRef.current) setProduct(null);
    setAssignOpen(false);
    setNotFoundCode("");
    setSearchResults([]);
    try {
      // Resolución reducida para teléfonos viejos: 480x360 (min 320x240) baja
      // el CPU del BarcodeDetector sin perder legibilidad de códigos decente.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { min: 320, ideal: 480 },
          height: { min: 240, ideal: 360 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;

      if ("BarcodeDetector" in window) {
        const BarcodeDetectorCtor = (window as unknown as { BarcodeDetector?: BarcodeDetectorClass }).BarcodeDetector;
        if (BarcodeDetectorCtor) {
          const formats = await BarcodeDetectorCtor.getSupportedFormats();
          detectorRef.current = new BarcodeDetectorCtor({ formats });
        }
      }
      setScanning(true);
      scanningRef.current = true;

      const scanLoop = async () => {
        if (!scanningRef.current || !videoRef.current) return;
        try {
          if (detectorRef.current) {
            const barcodes = await detectorRef.current.detect(videoRef.current);
            if (barcodes.length > 0) { lookupProduct(barcodes[0].rawValue); return; }
          }
        } catch { /* frame read errors are transient; keep scanning */ }
        scanTimerRef.current = setTimeout(scanLoop, 350);
      };
      scanLoop();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Permiso de cámara denegado");
    }
  };

  const stopScanner = () => {
    setScanning(false);
    scanningRef.current = false;
    clearTimeout(scanTimerRef.current ?? undefined);
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  useEffect(() => { return () => stopScanner(); }, []);

  // ── Catálogo offline (Fase 1, solo lectura) ──
  // Al montar, carga el snapshot desde IndexedDB a memoria y, si está
  // desactualizado y hay internet, lo re-sincroniza en background.
  useEffect(() => {
    void ensureOfflineCatalog();
  }, []);

  // Al volver de estar offline, re-sincroniza el catálogo si quedó viejo.
  useEffect(() => {
    const onOnline = () => {
      if (isCatalogStale()) void syncOfflineCatalog().catch(() => {});
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => searchProducts(searchQuery), 250);
    return () => clearTimeout(t);
  }, [searchQuery, searchProducts]);

  const updateStock = async (qty: number) => {
    if (!product || !effectiveBranchId) return;
    try {
      await saveBranchStock({ branchId: effectiveBranchId, quantity: qty });
      setDisplayQty(qty);
      toast.success(`Stock: ${qty}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al actualizar el stock");
    }
  };

  // Asigna/edita el precio por kg del producto escaneado (PUT /products/:id con
  // priceKgSuelto → el server marca priceKgSueltoManual=true, no lo sobreescribe).
  const saveKgPrice = async () => {
    if (!product) return;
    const n = parseFloat(kgInput.trim().replace(",", "."));
    if (Number.isNaN(n) || n < 0) {
      toast.error("Ingresá un precio por kg válido");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/products/${product.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ priceKgSuelto: n }),
      });
      const data = await res.json();
      if (res.ok && data.id) {
        setProduct(data);
        setKgEditOpen(false);
        playBeep();
        toast.success(`Precio por kg asignado: ${formatCurrency(n)}`);
        // Refresca el catálogo offline para que el próximo scan muestre el precio por kg nuevo.
        void syncOfflineCatalog().catch(() => {});
      } else {
        toast.error(data.message || "Error al asignar precio por kg");
      }
    } catch {
      toast.error("Error de conexión — se necesita internet para asignar el precio por kg");
    }
    setLoading(false);
  };

  // Edita el PRECIO del producto escaneado (PUT /products/:id con price).
  const savePrice = async () => {
    if (!product) return;
    const n = parseFloat(priceInput.trim().replace(",", "."));
    if (Number.isNaN(n) || n < 0) {
      toast.error("Ingresá un precio válido");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/products/${product.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ price: n }),
      });
      const data = await res.json();
      if (res.ok && data.id) {
        setProduct(data);
        setPriceEditOpen(false);
        playBeep();
        toast.success(`Precio actualizado: ${formatCurrency(n)}`);
        // Refresca el catálogo offline para que el próximo scan muestre el precio nuevo.
        void syncOfflineCatalog().catch(() => {});
      } else {
        toast.error(data.message || "Error al actualizar el precio");
      }
    } catch {
      toast.error("Error de conexión — se necesita internet para actualizar el precio");
    }
    setLoading(false);
  };

  const resetAndScan = () => {
    setProduct(null);
    setAssignOpen(false);
    setNotFoundCode("");
    setSearchResults([]);
    setSearchQuery("");
    setCorrectingBarcode(false);
    correctingRef.current = false;
    lastScannedRef.current = "";
    startScanner();
  };

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <div className="flex items-center gap-2">
        {assignToId && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 px-2"
            onClick={() => {
              if (navigate && window.history.length > 1) {
                navigate(-1);
              } else {
                window.location.href = "/dashboard";
              }
            }}
            title="Volver al listado de productos"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <h1 className="text-xl font-semibold">
          {assignToId ? "Asignar código" : "Scanner"}
        </h1>
      </div>

      {assignToId && product && (
        <p className="text-sm text-muted-foreground -mt-3 truncate">
          {product.name}
        </p>
      )}

      {/* Branch selector (spec F2): admin/management pick any branch; a
          vendedor/cashier with several assignments picks among their own. */}
      {mode.kind === "selector" && (isAdminSelector || product) && (
        <div className="space-y-1.5">
          <Label htmlFor="scanner-branch">Sucursal de trabajo</Label>
          <NativeSelect
            id="scanner-branch"
            ariaLabel="Sucursal de trabajo"
            value={effectiveBranchId ?? ""}
            onValueChange={(v) => setSelectedBranchId(v || null)}
            placeholder="Elegí la sucursal"
            options={(isAdminSelector
              ? allBranches.map((b) => ({ value: b.id, label: b.name }))
              : restrictedOptions.map((b) => ({ value: b.branchId, label: b.branchName }))
            )}
          />
        </div>
      )}

      {/* Camera */}
      <Card className="relative aspect-square overflow-hidden bg-black rounded-xl">
        <video ref={videoRef} className="h-full w-full object-cover" playsInline autoPlay muted />
        {!scanning && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 text-white gap-3">
            <Camera className="h-10 w-10" />
            <span className="text-sm">Cámara apagada</span>
          </div>
        )}
        {scanning && (
          <div className="absolute inset-0 pointer-events-none">
            <div className={`absolute inset-[18%] rounded-2xl border-2 ${correctingBarcode ? "border-amber-400/70" : "border-green-400/70"}`} />
            <p className="absolute bottom-3 w-full text-center text-xs text-white/80">
              {correctingBarcode ? "Corrigiendo código..." : "Escaneando..."}
            </p>
          </div>
        )}
      </Card>

      <div className="flex gap-2">
        {!scanning ? (
          <Button onClick={startScanner} className="flex-1"><Camera className="h-4 w-4 mr-2" />Iniciar cámara</Button>
        ) : (
          <Button onClick={stopScanner} variant="secondary" className="flex-1"><CameraOff className="h-4 w-4 mr-2" />Detener</Button>
        )}
        {correctingBarcode && (
          <Button variant="outline" size="sm" onClick={() => { setCorrectingBarcode(false); correctingRef.current = false; }}>
            <X className="h-4 w-4 mr-1" />Cancelar
          </Button>
        )}
      </div>

      <div className="flex gap-2">
        <Input placeholder="O escribí el código..." value={manualCode} onChange={e => setManualCode(e.target.value)} onKeyDown={e => e.key === "Enter" && lookupProduct(manualCode)} />
        <Button size="icon" onClick={() => lookupProduct(manualCode)}><Search className="h-4 w-4" /></Button>
      </div>

      {loading && <p className="text-center text-sm text-muted-foreground py-2">Buscando...</p>}

      {/* Product card */}
      {product && !loading && (
        <Card className="p-4 space-y-3">
          <h2 className="text-lg font-semibold">{product.name}</h2>
          {product.description && <p className="text-sm text-muted-foreground">{product.description}</p>}

          {/* Precio (mobile: dato clave al escanear) */}
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-2xl font-bold text-primary tabular-nums">
              {formatCurrency(product.price)}
            </span>
            {effectiveKg !== null ? (
              <span className="text-sm text-muted-foreground">
                por kg: {formatCurrency(effectiveKg)}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">sin precio por kg</span>
            )}
            {canEditPrice && (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg border border-primary/20 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/5"
                onClick={() => {
                  setPriceInput(String(product.price));
                  setPriceEditOpen(true);
                }}
              >
                Editar precio
              </button>
            )}
            <button
              type="button"
              className="ml-auto inline-flex items-center gap-1 rounded-lg border border-primary/20 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/5"
              onClick={() => {
                setKgInput(effectiveKg != null ? String(effectiveKg) : "");
                setKgEditOpen(true);
              }}
            >
              {effectiveKg !== null ? "Editar por kg" : "Asignar por kg"}
            </button>
          </div>

          {kgEditOpen && (
            <div className="flex items-center gap-2">
              <Input
                type="number"
                inputMode="decimal"
                placeholder="Precio por kg ($)"
                value={kgInput}
                onChange={(e) => setKgInput(e.target.value)}
                className="h-9"
              />
              <Button size="sm" onClick={() => void saveKgPrice()}>Guardar</Button>
              <Button size="sm" variant="ghost" onClick={() => setKgEditOpen(false)}>Cancelar</Button>
            </div>
          )}

          {priceEditOpen && (
            <div className="flex items-center gap-2">
              <Input
                type="number"
                inputMode="decimal"
                placeholder="Precio ($)"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                className="h-9"
              />
              <Button size="sm" onClick={() => void savePrice()}>Guardar</Button>
              <Button size="sm" variant="ghost" onClick={() => setPriceEditOpen(false)}>Cancelar</Button>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {product.code && (
              <Badge variant="outline">SKU: {product.code}</Badge>
            )}
            {product.barcode && (
              <span className="inline-flex items-center gap-1">
                <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
                  {product.barcode}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  title="Corregir código"
                  onClick={() => {
                    setCorrectingBarcode(true);
                    correctingRef.current = true;
                    lastScannedRef.current = "";
                    if (!scanning) startScanner();
                  }}
                >
                  <Barcode className="h-3.5 w-3.5" />
                </Button>
              </span>
            )}
            {!product.barcode && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  setCorrectingBarcode(true);
                  correctingRef.current = true;
                  lastScannedRef.current = "";
                  if (!scanning) startScanner();
                }}
              >
                <Barcode className="h-3.5 w-3.5 mr-1" />Sin código de barras
              </Button>
            )}
            {product.category && <Badge variant="secondary">{product.category.name}</Badge>}
            {product.variantAssignments?.map((va, i) => (
              <Badge key={i} variant="outline" className="text-xs">{va.option.variant.name}: {va.option.value}</Badge>
            ))}
          </div>

          <div className="flex items-center gap-3 pt-2 border-t">
            <span className="text-sm text-muted-foreground">
              Stock{effectiveBranchInfo ? ` · ${effectiveBranchInfo.branchName}` : ""}:
            </span>
            <span className={`text-2xl font-bold ${shownQty <= 0 ? "text-destructive" : ""}`}>{shownQty}</span>
            {mode.kind === "readonly" ? (
              <span className="ml-auto text-sm text-muted-foreground">Solo lectura</span>
            ) : canAdjust ? (
              <div className="flex gap-1 ml-auto">
                <Button size="icon" variant="outline" aria-label="Disminuir stock" onClick={() => updateStock(shownQty - 1)}><Minus className="h-4 w-4" /></Button>
                <Button size="icon" variant="outline" aria-label="Aumentar stock" onClick={() => updateStock(shownQty + 1)}><Plus className="h-4 w-4" /></Button>
              </div>
            ) : null}
          </div>

          {canAdjust && (
            <div className="flex gap-2">
              <Input type="number" placeholder="Cantidad..." value={adjustQty} onChange={e => setAdjustQty(e.target.value)} className="h-9" />
              <Button size="sm" onClick={() => { const q = parseInt(adjustQty); if (!isNaN(q)) { updateStock(q); setAdjustQty(""); } }}>Actualizar</Button>
            </div>
          )}

          {product.barcode && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setReassignFromId(product.id);
                setNotFoundCode(product.barcode);
                setSearchQuery("");
                setSearchResults([]);
                setAssignOpen(true);
                setTimeout(() => searchInputRef.current?.focus(), 300);
              }}
            >
              <Link2 className="h-4 w-4 mr-2" />Reasignar código
            </Button>
          )}
          <Button variant="outline" className="w-full" onClick={resetAndScan}>
            <Camera className="h-4 w-4 mr-2" />Escanear otro
          </Button>
        </Card>
      )}

      {/* Assign code panel — fullscreen Sheet */}
      <Sheet open={assignOpen} onOpenChange={(v) => { if (!v) { setAssignOpen(false); lastScannedRef.current = ""; } }}>
        <SheetContent side="bottom" className="h-[92vh] rounded-t-2xl p-0">
          <SheetHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between">
            <SheetTitle>Vincular código</SheetTitle>
            <Button variant="ghost" size="icon" onClick={() => { setAssignOpen(false); lastScannedRef.current = ""; }}>
              <X className="h-5 w-5" />
            </Button>
          </SheetHeader>

          <div className="flex flex-col h-full px-4 pb-4 space-y-3">
            {/* Scanned code display */}
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-center">
              <p className="text-xs text-amber-600 font-medium">Código escaneado</p>
              <p className="text-xl font-mono font-bold text-amber-800 mt-0.5">{notFoundCode}</p>
              <p className="text-xs text-amber-600 mt-1">No está asociado a ningún producto</p>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                className="pl-9 h-11 text-base"
                placeholder="Buscá el producto por nombre..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto -mx-1 px-1">
              {searching && <p className="text-center text-sm text-muted-foreground py-4">Buscando...</p>}

              {!searching && searchQuery.length >= 2 && searchResults.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-8">Sin resultados. Probá con menos palabras.</p>
              )}

              {searchResults.map(p => (
                <div
                  key={p.id}
                  className="w-full flex items-start gap-3 rounded-xl px-3 py-3 mb-1.5 text-left border border-transparent hover:border-primary/30 hover:bg-primary/5"
                >
                  <button
                    className="mt-0.5 shrink-0 active:scale-90 transition-transform disabled:opacity-50"
                    onClick={() => assignCode(p.id)}
                    disabled={assigning}
                    title="Asignar código a este producto"
                  >
                    <Link2 className="h-4 w-4 text-primary" />
                  </button>
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => assignCode(p.id)}>
                    <p className="font-medium text-sm leading-snug">{p.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{p.code || "—"}</p>
                    {p.variantAssignments && p.variantAssignments.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {p.variantAssignments.map((va, i) => (
                          <Badge key={i} variant="secondary" className="text-[11px] px-1.5 py-0.5">
                            {va.option.variant.name}: {va.option.value}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {p.category && !p.variantAssignments?.length && (
                      <p className="text-xs text-muted-foreground mt-1">{p.category.name}</p>
                    )}
                  </div>
                  <button
                    className="mt-0.5 shrink-0 p-1 rounded-md hover:bg-primary/10 active:scale-90 transition-transform disabled:opacity-50"
                    onClick={(e) => { e.stopPropagation(); openDuplicateDrawer(p); }}
                    disabled={assigning}
                    title="Duplicar producto y editar antes de asignar"
                  >
                    <Copy className="h-4 w-4 text-muted-foreground" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Product drawer for duplicating */}
      <ProductDrawer
        open={dupDrawerOpen}
        onClose={() => { setDupDrawerOpen(false); setDupProduct(null); }}
        product={dupProduct}
        onCreated={handleDuplicateCreated}
      />
    </div>
  );
};

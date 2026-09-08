import { useState, useEffect } from "react";
import { toast } from "react-toastify";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { CategoryTreePicker } from "@/components/molecules/CategoryTreePicker";
import { useCreateProduct } from "@/components/hooks/useProducts";
import { useProductStock } from "@/components/hooks/useProductStock";
import { useQueryClient } from "@tanstack/react-query";
import {
  VariantDefinition,
  getCategoryVariants,
} from "@/services/onboardingService";
import { updateProduct } from "@/services/productService";
import type { BranchStockInfo } from "@/services/productService";
import { canEditBranchStock } from "@/constants/rolePermissions";
import type { Role } from "@/constants/rolePermissions";
import { API_URL } from "@/constants";
import { roundBolsaPrice } from "@/lib/money";
import type { DataItem } from "@/types";

interface ProductDrawerProps {
  open: boolean;
  onClose: () => void;
  product?: DataItem | null;
  onCreated?: (product: DataItem) => void;
  readOnly?: boolean;
}

/** Body sent to create/update product. quantity is only present in create
 * mode (server syncs HQ stock); edit mode edits stock per branch. */
interface ProductPayload {
  name: string;
  code?: string;
  description?: string;
  price: number;
  image?: string;
  variantOptionIds: string[];
  quantity?: number;
  categoryId?: string | null;
  weightKg?: number | null;
  bulkFactor?: number | null;
  unitsPerBox?: number | null;
  carried?: boolean;
}

export const ProductDrawer = ({ open, onClose, product, onCreated, readOnly }: ProductDrawerProps) => {
  const isEdit = !!(product?._id || product?.id);
  const queryClient = useQueryClient();
  const { createProduct, loading } = useCreateProduct();

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [variants, setVariants] = useState<VariantDefinition[]>([]);
  const [variantSelections, setVariantSelections] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // Draft per-branch quantities + which branch is saving right now (edit mode).
  const [branchDrafts, setBranchDrafts] = useState<Record<string, string>>({});
  const [savingBranch, setSavingBranch] = useState<string | null>(null);

  // Loose-sale fields (sdd/venta-alimento-suelto A-02):
  const [weightKg, setWeightKg] = useState("");
  // Multi-pack: unidades por caja (sdd/venta-por-unidad-multpack). Int, > 1
  // habilita la venta por unidad. Puede derivarse del nombre ("15x85grs").
  const [unitsPerBox, setUnitsPerBox] = useState("");
  // priceKgSuelto is read-only (derived server-side from price/weightKg/factor).
  // ¿El negocio trabaja este producto? (filtro "solo lo que trabajo").
  const [carried, setCarried] = useState(true);

  // Stock por sucursal (edit mode): self-contained response, no GET /branches.
  const productId = isEdit ? (product?._id || product?.id) : undefined;
  const { stock, loading: stockLoading, updateBranchStock: saveBranchStock } =
    useProductStock(productId);

  // Client-side stock-edit policy (mirrors the backend): the response's
  // `canEdit` is authoritative; the helper is the UI expression of the same rule.
  const currentUser = (() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      return null;
    }
  })();
  const userRole = currentUser?.role as Role | undefined;
  const userBranchIds = currentUser?.branchIds as string[] | undefined;

  const canEditBranch = (branch: BranchStockInfo): boolean =>
    branch.canEdit &&
    canEditBranchStock(userRole, userBranchIds, branch.branchId);

  // Keep per-branch drafts in sync with the latest server response.
  useEffect(() => {
    if (stock) {
      const drafts: Record<string, string> = {};
      for (const branch of stock.branches) {
        drafts[branch.branchId] = String(branch.quantity);
      }
      setBranchDrafts(drafts);
    }
  }, [stock]);

  const handleSaveBranchStock = async (branchId: string) => {
    const quantity = parseInt(branchDrafts[branchId] ?? "0", 10);
    if (Number.isNaN(quantity) || quantity < 0) {
      toast.error("La cantidad debe ser un número mayor o igual a 0");
      return;
    }
    setSavingBranch(branchId);
    try {
      await saveBranchStock({ branchId, quantity });
      toast.success("Stock actualizado");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Error al actualizar el stock";
      toast.error(message);
    } finally {
      setSavingBranch(null);
    }
  };

  // Load variants when the category changes, keeping only the selections whose
  // options still belong to the category. Stale options (left behind by a
  // category change in edit mode, or by duplicating a product that ended up
  // with options from another category) are dropped instead of being sent to
  // the backend, which would reject them with a 400.
  useEffect(() => {
    if (categoryId) {
      getCategoryVariants(categoryId)
        .then((defs) => {
          setVariants(defs);
          const validOptionIds = new Set(
            defs.flatMap((def) => def.options.map((opt) => opt.id)),
          );
          const next: Record<string, string> = {};
          let dropped = false;
          for (const [defId, optionId] of Object.entries(variantSelections)) {
            if (optionId && validOptionIds.has(optionId)) next[defId] = optionId;
            else dropped = true;
          }
          if (dropped) {
            toast.warn(
              "Se quitaron opciones de variante que no pertenecen a la categoría seleccionada",
            );
          }
          setVariantSelections(next);
        })
        .catch(() => setVariants([]));
    } else {
      setVariants([]);
      setVariantSelections({});
    }
  }, [categoryId, isEdit, product?.variantAssignments]);

  // Reset form on open/product change. Runs AFTER the defs-loading effect so
  // the prefill set here is not clobbered by the categoryId="" branch on the
  // first open; the load effect then filters the prefill against the defs.
  useEffect(() => {
    if (open) {
      if (product) {
        // Pre-fill for both edit and duplicate mode
        setName(product.name || "");
        setCode(product.code || "");
        setDescription(product.description || "");
        setCategoryId(product.categoryId || "");
        setPrice(product.price?.toString() || "");
        setQuantity(product.quantity?.toString() || "");
        setImageUrl(product.image || "");
        setImageFile(null);
        setWeightKg(product.weightKg != null ? String(product.weightKg) : "");
        setUnitsPerBox(product.unitsPerBox != null ? String(product.unitsPerBox) : "");
        setCarried(product.carried !== false); // default true si no viene
        // Pre-select variants if available
        if (product.variantAssignments) {
          const pre: Record<string, string> = {};
          for (const pv of product.variantAssignments) {
            if (pv.option?.variantId) pre[pv.option.variantId] = pv.option.id;
          }
          setVariantSelections(pre);
        } else {
          setVariantSelections({});
        }
      } else {
        setName("");
        setCode("");
        setDescription("");
        setCategoryId("");
        setPrice("");
        setQuantity("");
        setImageUrl("");
        setImageFile(null);
        setWeightKg("");
        setUnitsPerBox("");
        setCarried(true);
        setVariants([]);
        setVariantSelections({});
      }
    }
  }, [open, product, isEdit]);

  const handleSubmit = async () => {
    if (!name.trim()) { toast.error("El nombre es requerido"); return; }
    setSaving(true);
    try {
      let imgUrl = imageUrl;
      if (imageFile) {
        const fd = new FormData();
        fd.append("image", imageFile);
        const res = await fetch(`${API_URL}/image/upload`, {
          method: "POST",
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
          body: fd,
        });
        const data = await res.json();
        imgUrl = data.url;
      }

      const variantOptionIds = Object.values(variantSelections).filter(Boolean);
      // Precio de BOLSA CERRADA >= 500 → múltiplo de 100; < 500 se conserva.
      // NO se toca priceKgSuelto (el precio por kg de venta suelta).
      const parsedWeightKg = parseFloat(weightKg);
      const priceValue = parseFloat(price) || 0;
      const payload: ProductPayload = {
        name,
        code: code || undefined,
        description: description || undefined,
        price: priceValue >= 500 ? roundBolsaPrice(priceValue) : priceValue,
        image: imgUrl,
        variantOptionIds,
      };
      // Only create mode sends the global quantity: the server syncs it to the
      // HQ ProductStock row (syncHqStock). In edit mode stock is edited per
      // branch via the stock endpoints, so Product.quantity must not change.
      if (!isEdit) {
        payload.quantity = parseInt(quantity) || 0;
      }
      // Loose-sale fields (A-02): weightKg always sent, bulkFactor null = org default.
      payload.weightKg = !Number.isNaN(parsedWeightKg) && parsedWeightKg > 0 ? parsedWeightKg : null;
      // El operador pone el precio por kilo manualmente, así que el factor
      // mayorista siempre usa el default de la organización.
      payload.bulkFactor = null;
      const parsedUnitsPerBox = parseInt(unitsPerBox, 10);
      payload.unitsPerBox =
        !isNaN(parsedUnitsPerBox) && parsedUnitsPerBox > 1 ? parsedUnitsPerBox : null;
      payload.carried = carried;

      if (isEdit && product) {
        payload.categoryId = categoryId || null;
        await updateProduct({ _id: product._id || product.id, ...payload } as DataItem);
        toast.success("Producto actualizado");
      } else {
        payload.categoryId = categoryId || undefined;
        const newProduct = await createProduct(payload as DataItem);
        toast.success("Producto creado");
        onCreated?.(newProduct);
      }

      queryClient.invalidateQueries({ queryKey: ["products"] });
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al guardar";
      toast.error(message);
    }
    setSaving(false);
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:w-[560px] sm:max-w-[560px] max-w-[100vw] overflow-hidden p-0 flex flex-col">
        <SheetHeader className="px-6 pt-6 pb-2 shrink-0">
          <SheetTitle>
            {readOnly ? product?.name || "Stock" : isEdit ? "Editar producto" : "Agregar producto"}
          </SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-6 pb-8 overflow-y-auto flex-1 min-h-0">
          {!readOnly && (
          <>
          {/* Nombre + Código */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-name">Nombre *</Label>
              <Input id="p-name" value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Collar de Cuero" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-code">Código / SKU</Label>
              <Input id="p-code" value={code} onChange={e => setCode(e.target.value)} placeholder="Código de barras" />
            </div>
          </div>

          {/* Categoría — tree picker */}
          <div className="space-y-1.5">
            <Label>Categoría</Label>
            <CategoryTreePicker value={categoryId} onChange={setCategoryId} />
          </div>

          {/* Proveedor — solo lectura (sdd/alican-wholesale-price-list/providers):
              se asigna al importar una planilla; la edición del vínculo no es
              parte del flujo (el import lo reasigna en cada corrida). */}
          {isEdit && product?.provider?.name && (
            <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
              <Label className="text-xs text-muted-foreground">Proveedor</Label>
              <p className="text-sm font-medium">{product.provider.name}</p>
            </div>
          )}

          {/* Precio + Cantidad (Cantidad solo en alta; en edición el stock es por sucursal) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className={`space-y-1.5 ${isEdit ? "sm:col-span-2" : ""}`}>
              <Label htmlFor="p-price">Precio</Label>
              <Input id="p-price" type="number" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} placeholder="0" />
            </div>
            {!isEdit && (
              <div className="space-y-1.5">
                <Label htmlFor="p-qty">Cantidad</Label>
                <Input id="p-qty" type="number" inputMode="numeric" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="0" />
              </div>
            )}
          </div>
          </>
          )}

          {/* ── Venta suelta (sdd/venta-alimento-suelto A-02) ── */}
          {!readOnly && (
          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-weightKg">Peso (kg)</Label>
              <Input
                id="p-weightKg"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={weightKg}
                onChange={(e) => setWeightKg(e.target.value)}
                placeholder="Ej: 15"
              />
              <p className="text-[11px] text-muted-foreground">
                Peso del producto para calcular precio por kilo.
              </p>
            </div>
          </div>
          )}

          {/* ── Multi-pack por unidad (sdd/venta-por-unidad-multpack) ── */}
          {!readOnly && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-unitsPerBox">Unidades por caja</Label>
              <Input
                id="p-unitsPerBox"
                type="number"
                inputMode="numeric"
                step="1"
                min="0"
                value={unitsPerBox}
                onChange={(e) => setUnitsPerBox(e.target.value)}
                placeholder="Ej: 15"
              />
              <p className="text-[11px] text-muted-foreground">
                Puede derivarse del nombre (ej: "15x85grs"). Mayor a 1 habilita
                la venta "por unidad" en el POS.
              </p>
            </div>
          </div>
          )}

          {/* priceKgSuelto — read-only, derived (A-02). Shown in both edit/readOnly. */}
          {isEdit && product && (product.priceKgSuelto != null) && (
            <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
              <Label className="text-xs text-muted-foreground">Precio por kilo (calculado)</Label>
              <p className="text-lg font-bold tabular-nums">
                ${Number(product.priceKgSuelto).toLocaleString("es-AR", { minimumFractionDigits: 2 })}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Se recalcula al guardar cambios en peso o factor.
              </p>
            </div>
          )}

          {/* Stock por sucursal — edit mode (spec F1): una card por sucursal activa,
              con edición inline SOLO donde el usuario puede editar (canEdit). */}
          {isEdit && (
            <div className="space-y-2">
              <Label>Stock por sucursal</Label>
              {stockLoading && (
                <p className="text-sm text-muted-foreground">Cargando stock...</p>
              )}
              {!stockLoading && !stock && (
                <p className="text-sm text-muted-foreground">No se pudo cargar el stock de las sucursales</p>
              )}
              {stock?.branches.map((branch) => (
                <Card key={branch.branchId} className="py-3">
                  <CardContent className="flex items-center justify-between gap-3 px-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{branch.branchName}</p>
                      <p className="text-xs text-muted-foreground">
                        {branch.quantity} en stock{branch.isHeadquarters ? " · Casa central" : ""}
                      </p>
                    </div>
                    {!readOnly && canEditBranch(branch) ? (
                      <div className="flex shrink-0 items-center gap-2">
                        <Input
                          type="number"
                          inputMode="numeric"
                          aria-label={`Cantidad de ${branch.branchName}`}
                          className="w-20"
                          value={branchDrafts[branch.branchId] ?? String(branch.quantity)}
                          onChange={e => setBranchDrafts(prev => ({ ...prev, [branch.branchId]: e.target.value }))}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleSaveBranchStock(branch.branchId)}
                          disabled={savingBranch === branch.branchId}
                        >
                          {savingBranch === branch.branchId ? "Guardando..." : "Guardar"}
                        </Button>
                      </div>
                    ) : (
                      <span className="shrink-0 text-sm text-muted-foreground">Solo lectura</span>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {!readOnly && (
          <>
          {/* Descripción */}
          <div className="space-y-1.5">
            <Label htmlFor="p-desc">Descripción</Label>
            <Input id="p-desc" value={description} onChange={e => setDescription(e.target.value)} placeholder="Detalle del producto" />
          </div>

          {/* Imagen */}
          <div className="space-y-1.5">
            <Label>Imagen</Label>
            <div className="flex items-center gap-3">
              {(imageUrl || product?.image) && (
                <img src={imageUrl || product?.image} alt="" className="h-14 w-14 rounded-md border object-cover" />
              )}
              <Input type="file" accept="image/*" onChange={e => setImageFile(e.target.files?.[0] || null)} className="flex-1" />
            </div>
          </div>

          {/* ¿Lo trabaja el negocio? (filtro "solo lo que trabajo") */}
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="min-w-0">
              <Label htmlFor="p-carried" className="text-sm font-medium">
                Lo trabajo
              </Label>
              <p className="text-xs text-muted-foreground">
                Aparece en la búsqueda del dashboard. Desmarcalo si solo se puede
                pedir, no se vende en mostrador.
              </p>
            </div>
            <Switch
              id="p-carried"
              checked={carried}
              onCheckedChange={setCarried}
              disabled={readOnly}
            />
          </div>

          {/* Variants */}
          {variants.length > 0 && (
            <div className="space-y-3 rounded-lg border-2 border-primary/20 bg-primary/5 p-4">
              <p className="text-sm font-semibold text-primary">Variantes</p>
              {variants.map((def) => (
                <div key={def.id} className="space-y-1">
                  <Label className="text-xs">{def.name}</Label>
                  <NativeSelect
                    value={variantSelections[def.id] || ""}
                    onValueChange={(v) => setVariantSelections(prev => ({ ...prev, [def.id]: v }))}
                    placeholder={`Elegí ${def.name.toLowerCase()}`}
                    options={[
                      { value: "", label: "—" },
                      ...def.options.map((opt) => ({ value: opt.id, label: opt.value })),
                    ]}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Acciones */}
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancelar</Button>
            <Button className="flex-1" onClick={handleSubmit} disabled={saving || loading}>
              {saving ? "Guardando..." : isEdit ? "Actualizar" : "Crear producto"}
            </Button>
          </div>
          </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

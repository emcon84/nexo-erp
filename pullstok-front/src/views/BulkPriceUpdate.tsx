import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "react-toastify";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { CategoryTreePickerMulti } from "@/components/molecules/CategoryTreePickerMulti";
import { CategoryOverridesPanel } from "@/components/molecules/CategoryOverridesPanel";
import { PrintBulkPriceList } from "@/components/molecules/PrintBulkPriceList";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { recomputeRow } from "@/lib/priceOverride";
import { getCategories } from "@/services/onboardingService";
import { listProviders, type Provider } from "@/services/providers";
import {
  bulkPriceUpdate,
  BulkPricePreview,
  BulkPricePreviewRow,
  BulkPriceUpdatePayload,
} from "@/services/productService";
import { API_URL } from "@/constants";

interface BrandOption {
  id: string;
  value: string;
}

/** Resumen de una planilla importada (GET /price-lists → items). */
interface PriceListSummary {
  id: string;
  provider: string;
  type: string;
  period: string | null;
  sourceFilename: string;
  importedAt: string;
  sectionsCount: number;
  entriesCount: number;
}

/** Sección de la jerarquía del PDF (marca → línea → sublínea). */
interface PriceListSectionSummary {
  id: string;
  brand: string | null;
  line: string | null;
  subline: string | null;
  position: number;
}

/**
 * Borrador persistido en localStorage del proceso de actualización de precios.
 * Se guarda con el botón "Guardar borrador" y se restaura al volver a la vista,
 * hasta que se aplica (entonces se limpia). Cubre todos los filtros, % /
 * ganancia y overrides configurables por el usuario.
 */
const DRAFT_KEY = "pullstok-bulk-price-update-draft";

interface PriceUpdateDraft {
  selectedBrands: string[];
  selectedProviderIds: string[];
  selectedPriceListId: string;
  selectedPriceListTypes: ("SECO" | "WET")[];
  selectedSectionIds: string[];
  categoryIds: string[];
  percentage: string;
  margin: string;
  excludedIds: string[];
  categoryOverrides: Record<string, string>;
  productOverrides: Record<string, string>;
  sectionOverrides: Record<string, string>;
  sectionMarginsState: Record<string, string>;
}

const loadDraft = (): PriceUpdateDraft | null => {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as PriceUpdateDraft) : null;
  } catch {
    return null;
  }
};

const formatPrice = (n: number) =>
  `$${n.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * Actualización masiva de precios (sdd/bulk-price-update-selectors).
 * Selector de alcance: marcas (chips) + árbol de categorías multi-select
 * (subtree expansion server-side) + % con signo (−100..500). Preview paginado
 * con exclusiones por producto (todas tildadas por defecto → destildar
 * excluye). El apply re-resuelve el set en el server ($transaction) y es
 * autoritativo; el contador puede diferir del preview si algo cambió en el
 * medio — se muestra en el diálogo de confirmación.
 */
export const BulkPriceUpdate = () => {
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  // Proveedores de la org (sdd/alican-wholesale-price-list/providers): filtro
  // opcional que se combina con el de marcas como AND.
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedProviderIds, setSelectedProviderIds] = useState<string[]>([]);
  // Planillas del proveedor (línea del PDF): selector de planilla + chips de
  // línea (brand · line) que restringen el set a los productos matcheados.
  const [priceLists, setPriceLists] = useState<PriceListSummary[]>([]);
  const [selectedPriceListId, setSelectedPriceListId] = useState<string>("");
  // Tipos de planilla (SECO/WET) para filtrar: vacío = sin filtro (todos los
  // que tengan planilla); se combina como AND con el resto de los filtros.
  const [selectedPriceListTypes, setSelectedPriceListTypes] = useState<
    ("SECO" | "WET")[]
  >([]);
  const [sections, setSections] = useState<PriceListSectionSummary[]>([]);
  const [selectedSectionIds, setSelectedSectionIds] = useState<string[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [percentage, setPercentage] = useState("");
  const [margin, setMargin] = useState("");
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  const [categoryOverrides, setCategoryOverrides] = useState<
    Record<string, string>
  >({});
  const [productOverrides, setProductOverrides] = useState<
    Record<string, string>
  >({});
  // Overrides de % por LÍNEA de planilla (grupo brand|line): clave = g.key,
  // valor = string del input (vacío = sin override).
  const [sectionOverrides, setSectionOverrides] = useState<Record<string, string>>({});
  // Overrides de GANANCIA por LÍNEA de planilla (grupo brand|line): margen
  // propio por línea (ej. medicados con ganancia distinta).
  const [sectionMarginsState, setSectionMarginsState] = useState<Record<string, string>>({});
  const [categories, setCategories] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [preview, setPreview] = useState<BulkPricePreview | null>(null);
  const [printRows, setPrintRows] = useState<BulkPricePreviewRow[] | null>(null);
  // Búsqueda client-side sobre las filas de la página de la vista previa
  // (solo análisis en pantalla; no cambia el alcance del apply).
  const [previewSearch, setPreviewSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loadingBrands, setLoadingBrands] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const navigate = useNavigate();
  // Borrador persistido en localStorage (se aplica una sola vez al montar la
  // vista, para restaurar la configuración guardada antes de aplicar).
  const [restoredDraft] = useState<PriceUpdateDraft | null>(() => loadDraft());

  const headers = () => {
    const token = localStorage.getItem("token");
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  };

  // Load brands (Marca variant options)
  useEffect(() => {
    fetch(`${API_URL}/categories/variant-options?def=Marca`, {
      headers: headers(),
    })
      .then((res) => res.json())
      .then((data: BrandOption[]) => {
        const seen = new Set<string>();
        const unique = data.filter((b) => {
          if (seen.has(b.value)) return false;
          seen.add(b.value);
          return true;
        });
        setBrands(unique.sort((a, b) => a.value.localeCompare(b.value)));
      })
      .catch(() => setBrands([]))
      .finally(() => setLoadingBrands(false));
  }, []);

  // Load categories for the overrides side panel (id → name)
  useEffect(() => {
    getCategories()
      .then((data) =>
        setCategories(data.map((c) => ({ id: c.id, name: c.name }))),
      )
      .catch(() => setCategories([]));
  }, []);

  // Load providers for the optional provider filter (org-scoped).
  useEffect(() => {
    listProviders()
      .then(setProviders)
      .catch(() => setProviders([]));
  }, []);

  // Carga las secciones de una planilla. restoreSectionIds permite restaurar la
  // selección de líneas de un borrador guardado; si se omite, limpia la anterior
  // (el usuario cambiando de planilla limpia preview/exclusiones en el handler).
  const loadSections = useCallback((id: string, restoreSectionIds: string[] = []) => {
    fetch(`${API_URL}/price-lists/${id}`, { headers: headers() })
      .then((res) => res.json())
      .then((data) => {
        setSections(data.sections ?? []);
        setSelectedSectionIds(restoreSectionIds);
      })
      .catch(() => {
        setSections([]);
        setSelectedSectionIds([]);
      });
  }, []);

  // Load price lists (most recent first); si hay un borrador guardado se
  // restaura su planilla y líneas seleccionadas, sino se preselecciona la
  // primera y carga sus secciones.
  useEffect(() => {
    fetch(`${API_URL}/price-lists`, { headers: headers() })
      .then((res) => res.json())
      .then((data) => {
        const items = (data.items ?? []) as PriceListSummary[];
        setPriceLists(items);

        // Restaura el borrador guardado (todos los filtros/overrides) antes de
        // elegir planilla, porque selectedSectionIds se setea abajo.
        applyRestoredDraft();

        if (items.length > 0) {
          const savedId = restoredDraft?.selectedPriceListId;
          const target = items.find((pl) => pl.id === savedId);
          const chosen = target ?? items[0];
          setSelectedPriceListId(chosen.id);
          loadSections(
            chosen.id,
            target ? restoredDraft?.selectedSectionIds ?? [] : [],
          );
        }
      })
      .catch(() => setPriceLists([]));
  }, [loadSections]);

  // Any scope change invalidates preview, previous exclusions and category overrides.
  const scopeChanged = () => {
    setPreview(null);
    setExcludedIds(new Set());
    setCategoryOverrides({});
    setPage(1);
  };

  // Aplica el borrador guardado (una vez, al montar) restaurando la
  // configuración completa del proceso de actualización de precios.
  const applyRestoredDraft = () => {
    if (!restoredDraft) return;
    setSelectedBrands(restoredDraft.selectedBrands ?? []);
    setSelectedProviderIds(restoredDraft.selectedProviderIds ?? []);
    setSelectedPriceListTypes(restoredDraft.selectedPriceListTypes ?? []);
    setCategoryIds(restoredDraft.categoryIds ?? []);
    setPercentage(restoredDraft.percentage ?? "");
    setMargin(restoredDraft.margin ?? "");
    setExcludedIds(new Set(restoredDraft.excludedIds ?? []));
    setCategoryOverrides(restoredDraft.categoryOverrides ?? {});
    setProductOverrides(restoredDraft.productOverrides ?? {});
    setSectionOverrides(restoredDraft.sectionOverrides ?? {});
    setSectionMarginsState(restoredDraft.sectionMarginsState ?? {});
    setPreview(null);
    setPage(1);
    toast.info("Borrador restaurado");
  };

  // Guarda el borrador actual del proceso en localStorage (se limpia al aplicar).
  const saveDraft = () => {
    const draft: PriceUpdateDraft = {
      selectedBrands,
      selectedProviderIds,
      selectedPriceListId,
      selectedPriceListTypes,
      selectedSectionIds,
      categoryIds,
      percentage,
      margin,
      excludedIds: [...excludedIds],
      categoryOverrides,
      productOverrides,
      sectionOverrides,
      sectionMarginsState,
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    toast.success("Borrador guardado");
  };

  const toggleBrand = (value: string) => {
    setSelectedBrands((prev) =>
      prev.includes(value) ? prev.filter((b) => b !== value) : [...prev, value],
    );
    scopeChanged();
  };

  const toggleProvider = (id: string) => {
    setSelectedProviderIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
    scopeChanged();
  };

  const togglePriceListType = (type: "SECO" | "WET") => {
    setSelectedPriceListTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
    scopeChanged();
  };

  // Cambia la planilla seleccionada y recarga sus secciones (limpia preview/
  // exclusiones del alcance anterior).
  const handlePriceListChange = (id: string) => {
    setSelectedPriceListId(id);
    loadSections(id);
    scopeChanged();
  };

  // Grupos de LÍNEA (brand · line) sobre las secciones de la planilla actual;
  // las secciones sin brand/line no participan del filtro.
  const sectionGroups = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; ids: string[] }>();
    for (const s of sections) {
      if (!s.brand || !s.line) continue;
      const key = `${s.brand}|${s.line}`;
      const existing = groups.get(key);
      if (existing) existing.ids.push(s.id);
      else groups.set(key, { key, label: `${s.brand} · ${s.line}`, ids: [s.id] });
    }
    return [...groups.values()];
  }, [sections]);

  // Líneas (grupos brand|line) con al menos una sección seleccionada: son las
  // que admiten un override de % propio en el panel "Porcentaje por línea".
  const selectedSectionGroups = sectionGroups.filter((g) =>
    g.ids.some((id) => selectedSectionIds.includes(id)),
  );

  // Toggle de TODA una línea (todos los sectionIds del grupo).
  const toggleSectionGroup = (ids: string[]) => {
    setSelectedSectionIds((prev) => {
      const anySelected = ids.some((id) => prev.includes(id));
      if (anySelected) return prev.filter((id) => !ids.includes(id));
      return [...prev, ...ids];
    });
    scopeChanged();
  };

  const payload = useCallback((): BulkPriceUpdatePayload | null => {
    // Al menos un filtro de alcance (marcas, proveedores, categorías o línea
    // de planilla) para no barrer toda la org por error — mismo criterio que el
    // superRefine del bulkPriceUpdateSchema del backend.
    if (
      selectedBrands.length === 0 &&
      selectedProviderIds.length === 0 &&
      categoryIds.length === 0 &&
      selectedSectionIds.length === 0
    ) return null;
    const trimmed = percentage.trim();
    // Global opcional: vacío/NaN → undefined (server resuelve 0). Los overrides
    // propios por categoría/producto siguen aplicándose con prioridad.
    const pct = trimmed === "" || Number.isNaN(parseFloat(trimmed))
      ? undefined
      : parseFloat(trimmed);
    // Ganancia global opcional: vacío/NaN → undefined (server resuelve 0).
    const marginTrimmed = margin.trim();
    const marginVal = marginTrimmed === "" || Number.isNaN(parseFloat(marginTrimmed))
      ? undefined
      : parseFloat(marginTrimmed);
    const categoryPercentages = Object.entries(categoryOverrides)
      .filter(([, value]) => value.trim() !== "" && !Number.isNaN(parseFloat(value)))
      .map(([categoryId, value]) => ({ categoryId, percentage: parseFloat(value) }));
    const productPercentages = Object.entries(productOverrides)
      .filter(([, value]) => value.trim() !== "" && !Number.isNaN(parseFloat(value)))
      .map(([productId, value]) => ({ productId, percentage: parseFloat(value) }));
    // Overrides de % por línea de planilla: se expanden de grupo (brand|line) a
    // TODAS las sectionIds del grupo. Precedencia product > section > category
    // > global (el server mapea sectionId → productId de las secciones).
    const sectionPercentages = Object.entries(sectionOverrides)
      .filter(([, value]) => value.trim() !== "" && !Number.isNaN(parseFloat(value)))
      .flatMap(([key, value]) => {
        const group = sectionGroups.find((g) => g.key === key);
        if (!group) return [];
        const pct = parseFloat(value);
        return group.ids.map((sectionId) => ({ sectionId, percentage: pct }));
      });
    // Overrides de GANANCIA por línea de planilla: se expanden de grupo
    // (brand|line) a TODAS las sectionIds del grupo. El server mapea sectionId
    // → productId y combina multiplicativamente con el % de aumento.
    const sectionMargins = Object.entries(sectionMarginsState)
      .filter(([, value]) => value.trim() !== "" && !Number.isNaN(parseFloat(value)))
      .flatMap(([key, value]) => {
        const group = sectionGroups.find((g) => g.key === key);
        if (!group) return [];
        const margin = parseFloat(value);
        return group.ids.map((sectionId) => ({ sectionId, margin }));
      });
    return {
      brandValues: selectedBrands,
      categoryIds,
      excludeProductIds: [...excludedIds],
      providerIds: selectedProviderIds,
      priceListSectionIds: selectedSectionIds,
      priceListTypes: selectedPriceListTypes,
      percentage: pct,
      margin: marginVal,
      categoryPercentages,
      productPercentages,
      sectionPercentages,
      sectionMargins,
    };
  }, [
    selectedBrands,
    selectedProviderIds,
    categoryIds,
    excludedIds,
    selectedSectionIds,
    selectedPriceListTypes,
    percentage,
    margin,
    categoryOverrides,
    productOverrides,
    sectionOverrides,
    sectionMarginsState,
    sectionGroups,
  ]);

  const handlePreview = async (targetPage = 1) => {
    const p = payload();
    if (!p) return;
    setSubmitting(true);
    try {
      const data = await bulkPriceUpdate(p, true, targetPage);
      setPreview(data as BulkPricePreview);
      setPage(targetPage);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al obtener preview";
      toast.error(message);
    }
    setSubmitting(false);
  };

  const toggleExclude = (id: string) => {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApply = async () => {
    const p = payload();
    if (!p) return;
    setSubmitting(true);
    try {
      const result = await bulkPriceUpdate(p, false);
      toast.success(`${result.affected} productos actualizados`);
      // El borrador se aplicó: se limpia para no restaurar una corrida vieja.
      localStorage.removeItem(DRAFT_KEY);
      navigate("/dashboard");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al aplicar";
      toast.error(message);
    }
    setSubmitting(false);
  };

  // Imprime el listado COMPLETO del preview (all=true → server devuelve todas
  // las filas, no la página): respeta exclusiones y overrides del payload.
  const handlePrint = async () => {
    const p = payload();
    if (!p) return;
    setSubmitting(true);
    try {
      const data = await bulkPriceUpdate(p, true, 1, true);
      setPrintRows((data as BulkPricePreview).rows);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al preparar impresión";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  // Una vez montado el área print (printRows no nulo), abrir el diálogo de
  // impresión y limpiar el estado al cerrarlo (afterprint) para que un Ctrl+P
  // posterior no reimprima un snapshot stale del preview.
  useEffect(() => {
    if (!printRows) return;
    window.print();
    const cleanup = () => setPrintRows(null);
    window.addEventListener("afterprint", cleanup);
    return () => window.removeEventListener("afterprint", cleanup);
  }, [printRows]);

  const pct = parseFloat(percentage);
  const isNegative = !Number.isNaN(pct) && pct < 0;
  const hasMore = preview
    ? page * preview.pageSize < preview.total
    : false;
  // Selected category nodes, in selection order, for the side panel.
  const selectedNodes =
    categoryIds.length && categories.length
      ? categories.filter((c) => categoryIds.includes(c.id))
      : [];
  const applyDisabled =
    !preview ||
    preview.affected === 0 ||
    excludedIds.size >= preview.affected ||
    submitting;

  // Client-side recompute of totals: server newTotal + deltas from any product
  // % overrides on the visible page (preview-only; server authoritative on apply).
  const totalAdjustment =
    preview?.rows.reduce((acc, row) => {
      const override = productOverrides[row.id];
      if (override === undefined || Number.isNaN(parseFloat(override))) {
        return acc;
      }
      const recomputed = recomputeRow(row.oldPrice, parseFloat(override));
      return acc + (recomputed - row.newPrice);
    }, 0) ?? 0;
  const adjustedNewTotal = preview ? preview.newTotal + totalAdjustment : null;

  // Filas de la página filtradas por el texto de búsqueda (case-insensitive,
  // substring sobre el nombre). Vacío = se muestran todas.
  const filteredRows = useMemo(() => {
    if (!preview) return [];
    const term = previewSearch.trim().toLowerCase();
    if (!term) return preview.rows;
    return preview.rows.filter((r) => r.name.toLowerCase().includes(term));
  }, [preview, previewSearch]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <h1 className="text-2xl font-bold">Actualización masiva de precios</h1>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Marcas</CardTitle>
          </CardHeader>
            <CardContent>
              {loadingBrands ? (
                <p className="text-sm text-muted-foreground">
                  Cargando marcas...
                </p>
              ) : brands.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No se encontraron marcas.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {brands.map((b) => (
                    <Badge
                      key={b.id}
                      variant={
                        selectedBrands.includes(b.value)
                          ? "default"
                          : "outline"
                      }
                      className="cursor-pointer uppercase transition-opacity hover:opacity-80"
                      onClick={() => toggleBrand(b.value)}
                    >
                      {b.value}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Proveedores (opcional)</CardTitle>
            </CardHeader>
            <CardContent>
              {providers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No se encontraron proveedores. Se filtran todos.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {providers.map((p) => (
                    <Badge
                      key={p.id}
                      variant={
                        selectedProviderIds.includes(p.id)
                          ? "default"
                          : "outline"
                      }
                      className="cursor-pointer transition-opacity hover:opacity-80"
                      onClick={() => toggleProvider(p.id)}
                    >
                      {p.name}
                    </Badge>
                  ))}
                </div>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Combina con el filtro de marcas como Y (marcas y proveedor).
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Línea de planilla (proveedor)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label>Tipo de planilla</Label>
                <div className="flex flex-wrap gap-2">
                  {(["SECO", "WET"] as const).map((t) => (
                    <Badge
                      key={t}
                      variant={
                        selectedPriceListTypes.includes(t) ? "default" : "outline"
                      }
                      className="cursor-pointer transition-opacity hover:opacity-80"
                      onClick={() => togglePriceListType(t)}
                    >
                      {t}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Filtra por tipo de planilla (SECO o WET). Sin selección =
                  todas. Se combina como Y con proveedor/línea/categorías.
                </p>
              </div>

              {priceLists.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No hay planillas importadas todavía.
                </p>
              ) : (
                <div className="space-y-1.5">
                  <Label>Planilla de precios</Label>
                  <Select
                    value={selectedPriceListId}
                    onValueChange={handlePriceListChange}
                  >
                    <SelectTrigger className="w-full" aria-label="Planilla de precios">
                      <SelectValue placeholder="Seleccioná una planilla" />
                    </SelectTrigger>
                    <SelectContent>
                      {priceLists.map((pl) => (
                        <SelectItem key={pl.id} value={pl.id}>
                          {pl.provider} · {pl.sourceFilename}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {sections.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Líneas</Label>
                  <div className="flex flex-wrap gap-2">
                    {sectionGroups.map((g) => {
                      const selected = g.ids.some((id) =>
                        selectedSectionIds.includes(id),
                      );
                      return (
                        <Badge
                          key={g.key}
                          variant={selected ? "default" : "outline"}
                          className="cursor-pointer transition-opacity hover:opacity-80"
                          onClick={() => toggleSectionGroup(g.ids)}
                        >
                          {g.label}
                        </Badge>
                      );
                    })}
                  </div>
                  {selectedSectionGroups.length > 0 && (
                    <div className="space-y-3 rounded-md border p-3">
                      <p className="text-sm font-medium">Porcentaje y ganancia por línea</p>
                      <ul className="space-y-2">
                        {selectedSectionGroups.map((g) => (
                          <li key={g.key} className="flex items-center gap-2">
                            <Label
                              htmlFor={`sec-ov-${g.key}`}
                              className="min-w-0 flex-1 truncate uppercase"
                            >
                              {g.label}
                            </Label>
                            <Input
                              id={`sec-ov-${g.key}`}
                              type="number"
                              step="0.5"
                              min="-100"
                              max="500"
                              className="h-8 w-20"
                              value={sectionOverrides[g.key] ?? ""}
                              placeholder="% aum"
                              aria-label={`Porcentaje ${g.label}`}
                              onChange={(e) =>
                                setSectionOverrides((prev) => ({
                                  ...prev,
                                  [g.key]: e.target.value,
                                }))
                              }
                            />
                            <Input
                              id={`sec-margin-${g.key}`}
                              type="number"
                              step="0.5"
                              min="0"
                              max="500"
                              className="h-8 w-20"
                              value={sectionMarginsState[g.key] ?? ""}
                              placeholder="ganancia"
                              aria-label={`Ganancia ${g.label}`}
                              onChange={(e) =>
                                setSectionMarginsState((prev) => ({
                                  ...prev,
                                  [g.key]: e.target.value,
                                }))
                              }
                            />
                          </li>
                        ))}
                      </ul>
                      <p className="text-xs text-muted-foreground">
                        El % de aumento y la ganancia de la línea reemplazan al default
                        para sus productos (no se suman). Ganancia multiplicativa:
                        precio × (1 + ganancia/100) × (1 + % aumento/100).
                      </p>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Filtra por la línea del PDF de la planilla (ej. la línea de medicados).
                    Se combina como Y con marcas/proveedor/categorías.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Categorías y porcentaje
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Categorías (opcional — tildar un padre incluye todo su subtree)</Label>
                <CategoryTreePickerMulti
                  selected={categoryIds}
                  onChange={(ids) => {
                    setCategoryIds(ids);
                    scopeChanged();
                  }}
                />
              </div>

              {selectedNodes.length > 0 && (
                <CategoryOverridesPanel
                  nodes={selectedNodes}
                  values={categoryOverrides}
                  onChange={(id, value) =>
                    setCategoryOverrides((prev) => ({ ...prev, [id]: value }))
                  }
                />
              )}

              <div className="space-y-1.5">
                <Label htmlFor="pct">Porcentaje default (%)</Label>
                <Input
                  id="pct"
                  type="number"
                  step="0.5"
                  min="-100"
                  max="500"
                  placeholder="Ej: 15 o -10"
                  value={percentage}
                  onChange={(e) => {
                    setPercentage(e.target.value);
                    scopeChanged();
                  }}
                />
                {isNegative && (
                  <p
                    className="text-sm font-medium text-red-600"
                    role="alert"
                  >
                    Disminución: los precios se reducirán un {percentage}%
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  0% = no cambia el precio pero cuenta en la corrida; destildar
                  = fuera de la corrida.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="margin">Ganancia (%)</Label>
                <Input
                  id="margin"
                  type="number"
                  step="0.5"
                  min="0"
                  max="500"
                  placeholder="Ej: 30"
                  value={margin}
                  onChange={(e) => {
                    setMargin(e.target.value);
                    scopeChanged();
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Margen que se aplica multiplicativo sobre el precio base: precio
                  × (1 + ganancia/100) × (1 + % de aumento/100). Se aplica SIEMPRE,
                  incluso sin % de aumento.
                </p>
              </div>

              <Button
                className="w-full"
                size="lg"
                disabled={
                  (selectedBrands.length === 0 &&
                    selectedProviderIds.length === 0 &&
                    categoryIds.length === 0 &&
                    selectedSectionIds.length === 0) ||
                  submitting
                }
                onClick={() => handlePreview(1)}
              >
                {submitting ? "Calculando..." : "Calcular preview"}
              </Button>
            </CardContent>
          </Card>
      </div>

        {/* Preview full-width (una sola columna → la tabla entra sin scroll horizontal) */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Vista previa</CardTitle>
              {preview && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={submitting}
                  onClick={handlePrint}
                >
                  Imprimir listado
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {preview ? (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-md bg-muted p-3">
                    <p className="text-xs text-muted-foreground">Afectados</p>
                    <p className="text-lg font-bold">{preview.affected}</p>
                  </div>
                  <div className="rounded-md bg-muted p-3">
                    <p className="text-xs text-muted-foreground">Total actual</p>
                    <p className="font-medium">
                      {formatPrice(preview.previousTotal)}
                    </p>
                  </div>
                  <div className="rounded-md bg-muted p-3">
                    <p className="text-xs text-muted-foreground">Total nuevo</p>
                    <p className="font-bold text-emerald-600">
                      {formatPrice(adjustedNewTotal ?? preview.newTotal)}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    placeholder="Buscar por producto..."
                    value={previewSearch}
                    onChange={(e) => setPreviewSearch(e.target.value)}
                    aria-label="Buscar por producto"
                    className="max-w-xs"
                  />
                  {previewSearch.trim() && (
                    <span className="text-xs text-muted-foreground">
                      {filteredRows.length} de {preview.rows.length} en esta página
                    </span>
                  )}
                </div>

                <div className="max-h-[320px] overflow-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10"></TableHead>
                            <TableHead>Producto</TableHead>
                            <TableHead>Marcas</TableHead>
                            <TableHead className="w-24">%</TableHead>
                            <TableHead>Precio</TableHead>
                            <TableHead className="text-right">Δ</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredRows.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                                No hay productos que coincidan con la búsqueda.
                              </TableCell>
                            </TableRow>
                          ) : filteredRows.map((row) => {
                            const override = productOverrides[row.id];
                            const overridePct = override !== undefined
                                ? parseFloat(override)
                                : NaN;
                            const hasOverride =
                              override !== undefined &&
                              !Number.isNaN(overridePct);
                            const displayNew = hasOverride
                              ? recomputeRow(row.oldPrice, overridePct)
                              : row.newPrice;
                            const displayDelta = displayNew - row.oldPrice;
                            return (
                              <TableRow key={row.id}>
                                <TableCell>
                                  <Checkbox
                                    aria-label={`Excluir ${row.name}`}
                                    checked={!excludedIds.has(row.id)}
                                    onCheckedChange={() => toggleExclude(row.id)}
                                  />
                                </TableCell>
                                <TableCell className="font-medium">
                                  {row.name}
                                </TableCell>
                                <TableCell className="text-muted-foreground uppercase">
                                  {row.brandValues.join(", ")}
                                </TableCell>
                                <TableCell>
                                  <Input
                                    type="number"
                                    step="0.5"
                                    min="-100"
                                    max="500"
                                    className="h-8 w-20"
                                    aria-label={`Porcentaje ${row.name}`}
                                    value={
                                      override !== undefined
                                        ? override
                                        : String(row.effectivePercentage ?? "")
                                    }
                                    placeholder="%"
                                    onChange={(e) =>
                                      setProductOverrides((prev) => ({
                                        ...prev,
                                        [row.id]: e.target.value,
                                      }))
                                    }
                                  />
                                </TableCell>
                                <TableCell className="whitespace-nowrap">
                                  {formatPrice(row.oldPrice)} →{" "}
                                  <span className="font-medium">
                                    {formatPrice(displayNew)}
                                  </span>
                                </TableCell>
                                <TableCell
                                  className={`text-right font-medium ${
                                    displayDelta < 0 ? "text-red-600" : ""
                                  }`}
                                >
                                  {displayDelta >= 0 ? "+" : ""}
                                  {formatPrice(displayDelta)}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>

                <div className="flex items-center justify-between">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1 || submitting}
                    onClick={() => handlePreview(page - 1)}
                  >
                    Anterior
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Página {page} · {preview.total} productos
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!hasMore || submitting}
                    onClick={() => handlePreview(page + 1)}
                  >
                    Siguiente
                  </Button>
                </div>

                <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Confirmar actualización de precios
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {preview.affected} productos · {formatPrice(preview.previousTotal)} →{" "}
                        {formatPrice(adjustedNewTotal ?? preview.newTotal)}. El
                        conteo final puede diferir si el catálogo cambió desde la
                        vista previa.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={handleApply}>
                        Aplicar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Seleccioná marcas, proveedor, categoría o línea de planilla y el porcentaje
                para calcular la vista previa.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Acciones: chicas, una al lado de la otra, alineadas a la derecha */}
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={submitting}
            onClick={saveDraft}
          >
            Guardar borrador
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate("/dashboard")}
          >
            Cancelar
          </Button>
          <Button
            size="sm"
            disabled={applyDisabled}
            onClick={() => setDialogOpen(true)}
          >
            Aplicar cambios
          </Button>
        </div>

        {/* Print area: only visible when printing (see @media print in index.css) */}
        {printRows && <PrintBulkPriceList rows={printRows} />}
      </div>
  );
};

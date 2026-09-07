import { useState, useEffect, useCallback, useRef, Fragment } from "react";
import { Link } from "react-router-dom";
import { Download } from "lucide-react";
import { toast } from "react-toastify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  listPriceKgTypes,
  createPriceKgType,
  updatePriceKgType,
  deletePriceKgType,
  parseSynonyms,
  type PriceKgType,
  type PriceKgSpecies,
} from "@/services/priceKgTypes";
import {
  listPriceKgBrands,
  createPriceKgBrand,
  updatePriceKgBrand,
  deletePriceKgBrand,
  parseKeywords,
  type PriceKgBrand,
} from "@/services/priceKgBrands";
import {
  getPriceKgPlan,
  savePriceKgPlan,
  downloadScaleCsv,
  type PriceKgPlanEntry,
} from "@/services/priceKgPlan";

// Precios sueltos SIEMPRE redondos (decisión del usuario): sin decimales.
// Key de la matriz de celdas: especie primero (una marca/tipo AMBOS tiene una
// celda distinta por planilla). Sin species, editar Gatos pisaría Perros.
const cellKey = (species: PriceKgSpecies, brandId: string, typeId: string) =>
  `${species}:${brandId}:${typeId}`;

// Abreviatura de los nombres de tipo en la IMPRESIÓN: acorta los largos para
// que las columnas "cod./$" por tipo no se estiren y el print entre en pocas
// hojas. Fuera de este mapa se usa el nombre completo.
const TYPE_ABBREV: Record<string, string> = {
  ADULTO: "Adulto",
  CACHORRO: "Cach.",
  KITTEN: "Kitten",
  STERILIZED: "Ster.",
  LIGHT: "Light",
  DERMA: "Derma",
  URINARY: "Urin.",
  SENIOR: "Sen.",
  GASTRO: "Gastro",
  GASTROINTESTINAL: "Gastro",
  CORDERO: "Cord",
  ARROZ: "Arroz",
};
const typeHeader = (name: string): string => TYPE_ABBREV[name.toUpperCase()] ?? name;

// --- Especie (Perro/Gato): mapeo species ↔ checks + componente compartido ---
// La planilla se edita por especie (matriz Perros vs Gatos), así que cada tipo
// y marca declara su especie (PERRO | GATO | AMBOS). Un item "AMBOS" aparece
// en ambas matrices y sus dos checks van tildados.

type SpeciesChecksState = { perro: boolean; gato: boolean };

const speciesToChecks = (s: PriceKgSpecies): SpeciesChecksState => {
  switch (s) {
    case "GATO":
      return { perro: false, gato: true };
    case "AMBOS":
      return { perro: true, gato: true };
    default:
      return { perro: true, gato: false };
  }
};

const checksToSpecies = (c: SpeciesChecksState): PriceKgSpecies =>
  c.perro && c.gato ? "AMBOS" : c.gato ? "GATO" : "PERRO";

/**
 * Dos checks chicos "Perro"/"Gato" para la especie de un tipo/marca. Guard:
 * nunca permite dejar ambos destildados — si destildás el último, revierte y
 * avisa vía onReject (regla del diseño). Se usa en los items de las listas y
 * en los formularios de crear/editar.
 */
const SpeciesChecks = ({
  name,
  checks,
  onChange,
  onReject,
}: {
  name: string;
  checks: SpeciesChecksState;
  onChange: (checks: SpeciesChecksState) => void;
  onReject?: () => void;
}) => {
  const toggle = (which: keyof SpeciesChecksState, checked: boolean) => {
    const next: SpeciesChecksState = { ...checks, [which]: checked };
    if (!next.perro && !next.gato) {
      onReject?.();
      return;
    }
    onChange(next);
  };
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1.5">
        <Checkbox
          id={`${name}-perro`}
          checked={checks.perro}
          onCheckedChange={(c) => toggle("perro", c === true)}
        />
        <Label htmlFor={`${name}-perro`} className="text-xs font-normal">
          Perro
        </Label>
      </div>
      <div className="flex items-center gap-1.5">
        <Checkbox
          id={`${name}-gato`}
          checked={checks.gato}
          onCheckedChange={(c) => toggle("gato", c === true)}
        />
        <Label htmlFor={`${name}-gato`} className="text-xs font-normal">
          Gato
        </Label>
      </div>
    </div>
  );
};

/**
 * Precios por kilo (sdd/price-kg-plan): gestión de tipos (etapas de vida) +
 * gestión de marcas (líneas/sabores editables) + editor de planilla. La
 * planilla es una matriz marca (filas) × tipo (columnas) → precio por kilo,
 * persistente e imprimible. Se edita por especie (Perros/Gatos): cada tipo y
 * marca declara su especie y la matriz solo muestra los que aplican a la
 * planilla activa. NO se tocan productos ni se matchean nombres.
 */
export const PriceKgUpdate = () => {
  // --- Especie de la planilla activa ---
  const [activeSpecies, setActiveSpecies] = useState<"PERRO" | "GATO">("PERRO");

  // --- Gestión de tipos ---
  const [types, setTypes] = useState<PriceKgType[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [typeName, setTypeName] = useState("");
  const [typeSynonyms, setTypeSynonyms] = useState("");
  const [typeChecks, setTypeChecks] = useState<SpeciesChecksState>(
    speciesToChecks("PERRO"),
  );
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);
  const [savingType, setSavingType] = useState(false);
  const [deleteTypeId, setDeleteTypeId] = useState<string | null>(null);

  // --- Gestión de marcas ---
  const [brands, setBrands] = useState<PriceKgBrand[]>([]);
  const [loadingBrands, setLoadingBrands] = useState(true);
  const [brandName, setBrandName] = useState("");
  const [brandKeywords, setBrandKeywords] = useState("");
  const [brandChecks, setBrandChecks] = useState<SpeciesChecksState>(
    speciesToChecks("PERRO"),
  );
  const [editingBrandId, setEditingBrandId] = useState<string | null>(null);
  const [savingBrand, setSavingBrand] = useState(false);
  const [deleteBrandId, setDeleteBrandId] = useState<string | null>(null);

  // --- Planilla (matriz marca × tipo → precio) ---
  const [cells, setCells] = useState<Record<string, string>>({});
  // Código de balanza (scaleCode) por celda (mismo cellKey que `cells`).
  // Solo lectura: el auto-asignado lo hace el backend al guardar; acá se muestra.
  const [cellCodes, setCellCodes] = useState<Record<string, string | null>>({});
  const [loadingPlan, setLoadingPlan] = useState(true);
  const [savingPlan, setSavingPlan] = useState(false);
  const [downloadingCsv, setDownloadingCsv] = useState(false);
  // Snapshot del estado cargado de la DB: permite detectar borrados (celda con
  // valor previo que el usuario deja vacía) y si hubo cambios antes de guardar.
  const baselineRef = useRef<Record<string, string>>({});

  const loadTypes = useCallback(async () => {
    try {
      const data = await listPriceKgTypes();
      setTypes(data);
    } catch {
      setTypes([]);
    } finally {
      setLoadingTypes(false);
    }
  }, []);

  const loadBrands = useCallback(async () => {
    try {
      const data = await listPriceKgBrands();
      setBrands(data);
    } catch {
      setBrands([]);
    } finally {
      setLoadingBrands(false);
    }
  }, []);

  const loadPlan = useCallback(async () => {
    try {
      const data = await getPriceKgPlan();
      const map: Record<string, string> = {};
      const codes: Record<string, string | null> = {};
      for (const c of data) {
        const key = cellKey(c.species, c.brandId, c.typeId);
        map[key] = String(c.priceKg);
        codes[key] = c.scaleCode ?? null;
      }
      setCells(map);
      setCellCodes(codes);
      baselineRef.current = { ...map };
    } catch {
      setCells({});
      setCellCodes({});
      baselineRef.current = {};
    } finally {
      setLoadingPlan(false);
    }
  }, []);

  useEffect(() => {
    loadTypes();
    loadBrands();
    loadPlan();
  }, [loadTypes, loadBrands, loadPlan]);

  // Tipos y marcas que aplican a la planilla activa (species === AMBOS aparece
  // en ambas). SOLO afecta la sección C (matriz + impresión + conteo): los
  // acordeones A y B muestran TODO sin filtrar. La API ya ordena por sortOrder.
  const visibleTypes = types.filter(
    (t) => t.species === activeSpecies || t.species === "AMBOS",
  );
  const visibleBrands = brands.filter(
    (b) => b.species === activeSpecies || b.species === "AMBOS",
  );
  const speciesLabel = activeSpecies === "PERRO" ? "Perros" : "Gatos";

  // --- Tipos: handlers ---
  const startEditType = (t: PriceKgType) => {
    setEditingTypeId(t.id);
    setTypeName(t.name);
    setTypeSynonyms(t.synonyms.join(", "));
    setTypeChecks(speciesToChecks(t.species));
  };

  const resetTypeForm = () => {
    setEditingTypeId(null);
    setTypeName("");
    setTypeSynonyms("");
    setTypeChecks(speciesToChecks("PERRO"));
  };

  const handleSaveType = async () => {
    const name = typeName.trim();
    if (!name) return;
    setSavingType(true);
    try {
      const synonyms = parseSynonyms(typeSynonyms);
      const species = checksToSpecies(typeChecks);
      if (editingTypeId) {
        await updatePriceKgType(editingTypeId, { name, synonyms, species });
        toast.success("Tipo actualizado");
      } else {
        await createPriceKgType({ name, synonyms, species });
        toast.success("Tipo creado");
      }
      resetTypeForm();
      await loadTypes();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al guardar el tipo";
      toast.error(message);
    }
    setSavingType(false);
  };

  const handleTypeSpeciesChange = async (
    t: PriceKgType,
    checks: SpeciesChecksState,
  ) => {
    try {
      await updatePriceKgType(t.id, { species: checksToSpecies(checks) });
      toast.success("Tipo actualizado");
      await loadTypes();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al actualizar el tipo";
      toast.error(message);
    }
  };

  const handleDeleteType = async () => {
    if (!deleteTypeId) return;
    setSavingType(true);
    try {
      await deletePriceKgType(deleteTypeId);
      toast.success("Tipo eliminado");
      setDeleteTypeId(null);
      await loadTypes();
      await loadPlan();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al eliminar el tipo";
      toast.error(message);
    }
    setSavingType(false);
  };

  // --- Marcas: handlers ---
  const startEditBrand = (b: PriceKgBrand) => {
    setEditingBrandId(b.id);
    setBrandName(b.name);
    setBrandKeywords(b.keywords.join(", "));
    setBrandChecks(speciesToChecks(b.species));
  };

  const resetBrandForm = () => {
    setEditingBrandId(null);
    setBrandName("");
    setBrandKeywords("");
    setBrandChecks(speciesToChecks("PERRO"));
  };

  const handleSaveBrand = async () => {
    const name = brandName.trim();
    if (!name) return;
    setSavingBrand(true);
    try {
      const keywords = parseKeywords(brandKeywords);
      const species = checksToSpecies(brandChecks);
      if (editingBrandId) {
        await updatePriceKgBrand(editingBrandId, { name, keywords, species });
        toast.success("Marca actualizada");
      } else {
        await createPriceKgBrand({ name, keywords, species });
        toast.success("Marca creada");
      }
      resetBrandForm();
      await loadBrands();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al guardar la marca";
      toast.error(message);
    }
    setSavingBrand(false);
  };

  const handleBrandSpeciesChange = async (
    b: PriceKgBrand,
    checks: SpeciesChecksState,
  ) => {
    try {
      await updatePriceKgBrand(b.id, { species: checksToSpecies(checks) });
      toast.success("Marca actualizada");
      await loadBrands();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al actualizar la marca";
      toast.error(message);
    }
  };

  const handleDeleteBrand = async () => {
    if (!deleteBrandId) return;
    setSavingBrand(true);
    try {
      await deletePriceKgBrand(deleteBrandId);
      toast.success("Marca eliminada");
      setDeleteBrandId(null);
      await loadBrands();
      await loadPlan();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al eliminar la marca";
      toast.error(message);
    }
    setSavingBrand(false);
  };

  // --- Planilla: handlers ---
  const setCell = (brandId: string, typeId: string, value: string) => {
    setCells((prev) => {
      const key = cellKey(activeSpecies, brandId, typeId);
      const next = { ...prev };
      if (value === "") delete next[key];
      else next[key] = value;
      return next;
    });
  };

  // Arma las entries a guardar: celdas NO vacías con precio > 0 → number;
  // celdas que quedaron vacías pero tenían valor previo → null (borrar). Opera
  // SOLO sobre la planilla activa (visibleBrands × visibleTypes) y arma entries
  // con species = activeSpecies: las celdas de la otra especie no se tocan. El
  // baseline sigue siendo el global (mapa con todas las especies).
  const buildEntries = (
    map: Record<string, string>,
    baseline: Record<string, string>,
  ): PriceKgPlanEntry[] => {
    const entries: PriceKgPlanEntry[] = [];
    for (const brand of visibleBrands) {
      for (const type of visibleTypes) {
        const key = cellKey(activeSpecies, brand.id, type.id);
        const raw = (map[key] ?? "").trim();
        if (raw === "") {
          if (baseline[key] !== undefined) {
            entries.push({
              species: activeSpecies,
              brandId: brand.id,
              typeId: type.id,
              priceKg: null,
            });
          }
        } else {
          const price = parseFloat(raw);
          if (!Number.isNaN(price) && price > 0) {
            entries.push({
              species: activeSpecies,
              brandId: brand.id,
              typeId: type.id,
              priceKg: price,
            });
          }
        }
      }
    }
    return entries;
  };

  const handleSavePlan = async () => {
    const current = buildEntries(cells, baselineRef.current);
    const baseline = buildEntries(baselineRef.current, baselineRef.current);
    if (JSON.stringify(current) === JSON.stringify(baseline)) {
      toast.info("No hay cambios para guardar");
      return;
    }
    setSavingPlan(true);
    try {
      await savePriceKgPlan(current);
      toast.success("Planilla guardada");
      await loadPlan();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al guardar la planilla";
      toast.error(message);
    }
    setSavingPlan(false);
  };

  // Celdas VISIBLES con precio cargado (valor no vacío y > 0), incluyendo
  // ediciones sin guardar, para el indicador de la planilla activa.
  let loadedCount = 0;
  for (const brand of visibleBrands) {
    for (const type of visibleTypes) {
      const raw = (cells[cellKey(activeSpecies, brand.id, type.id)] ?? "").trim();
      const p = parseFloat(raw);
      if (raw !== "" && !Number.isNaN(p) && p > 0) loadedCount++;
    }
  }

  const matrixReady = !loadingTypes && !loadingBrands && !loadingPlan;

  // --- Impresión ---
  // El print area vive SIEMPRE en el DOM con `hidden print:block` (ver
  // @media print en index.css) y el botón solo dispara window.print(). NO usar
  // estado + afterprint: al CANCELAR el diálogo afterprint no se dispara en
  // varios navegadores y `printing` quedaba en true → el botón moría.
  const handlePrint = () => {
    window.print();
  };

  // Descarga del CSV de códigos de balanza (para actualizar los precios en la
  // balanza Systel Cuora vía Qendra). El navegador elige la carpeta: por defecto
  // "Descargas"; si se quiere "Documentos", hay que activar "preguntar dónde
  // guardar" en el navegador.
  const handleDownloadCsv = async () => {
    setDownloadingCsv(true);
    try {
      const filename = await downloadScaleCsv();
      toast.success(
        `CSV descargado: ${filename}. Revisá la carpeta de descargas del navegador.`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Error al descargar el CSV";
      toast.error(message);
    }
    setDownloadingCsv(false);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Precios por kilo</h1>
        <div className="flex items-center gap-2">
          <Link to="/suelto-codigos">
            <Button variant="outline" size="sm">
              Códigos de balanza
            </Button>
          </Link>
          <Button
            variant="outline"
            size="sm"
            disabled={!matrixReady || downloadingCsv}
            onClick={handleDownloadCsv}
          >
            {downloadingCsv ? (
              "Generando..."
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Descargar CSV
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={
              !matrixReady ||
              visibleBrands.length === 0 ||
              visibleTypes.length === 0
            }
            onClick={handlePrint}
          >
            Imprimir planilla
          </Button>
        </div>
      </div>

      {/* Sección A — Gestión de tipos (colapsable) */}
      <Card>
        <Accordion type="single" collapsible>
          <AccordionItem value="types" className="border-b-0">
            <AccordionTrigger className="px-6 py-4 text-base">
              Tipos (etapas de vida)
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6">
              <div className="flex flex-col gap-4">
                {loadingTypes ? (
                  <p className="text-sm text-muted-foreground">Cargando tipos...</p>
                ) : types.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No hay tipos todavía. Creá el primero con el formulario de abajo.
                  </p>
                ) : (
                  <ul className="max-h-[35vh] space-y-2 overflow-y-auto pr-1">
                    {types.map((t) => (
                      <li
                        key={t.id}
                        className="flex items-center justify-between gap-2 rounded-md border p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{t.name}</span>
                          {t.synonyms.map((s) => (
                            <Badge key={s} variant="outline">
                              {s}
                            </Badge>
                          ))}
                          <SpeciesChecks
                            name={`type-${t.id}`}
                            checks={speciesToChecks(t.species)}
                            onChange={(checks) => handleTypeSpeciesChange(t, checks)}
                            onReject={() =>
                              toast.info(
                                "Debe quedar al menos una especie seleccionada",
                              )
                            }
                          />
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => startEditType(t)}
                          >
                            Editar
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDeleteTypeId(t.id)}
                          >
                            Eliminar
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Formulario fijo abajo: siempre visible, no scrollea con la lista */}
                <div className="border-t pt-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="type-name">Nombre</Label>
                      <Input
                        id="type-name"
                        value={typeName}
                        onChange={(e) => setTypeName(e.target.value)}
                        placeholder="Ej: Adulto"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="type-synonyms">Sinónimos (separados por coma)</Label>
                      <Input
                        id="type-synonyms"
                        value={typeSynonyms}
                        onChange={(e) => setTypeSynonyms(e.target.value)}
                        placeholder="Ej: Adulto, Adult, Maduro"
                      />
                    </div>
                  </div>

                  <div className="mt-4 space-y-1.5">
                    <Label>Especie</Label>
                    <SpeciesChecks
                      name="type-form"
                      checks={typeChecks}
                      onChange={setTypeChecks}
                      onReject={() =>
                        toast.info("Debe quedar al menos una especie seleccionada")
                      }
                    />
                  </div>

                  <div className="mt-4 flex gap-2">
                    <Button
                      disabled={!typeName.trim() || savingType}
                      onClick={handleSaveType}
                    >
                      {editingTypeId ? "Guardar cambios" : "Agregar tipo"}
                    </Button>
                    {editingTypeId && (
                      <Button variant="outline" onClick={resetTypeForm}>
                        Cancelar
                      </Button>
                    )}
                  </div>
                </div>

                <AlertDialog
                  open={deleteTypeId !== null}
                  onOpenChange={(open) => {
                    if (!open) setDeleteTypeId(null);
                  }}
                >
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Eliminar tipo</AlertDialogTitle>
                      <AlertDialogDescription>
                        ¿Seguro que querés eliminar este tipo? Esta acción no se puede
                        deshacer.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDeleteType}>
                        Eliminar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Card>

      {/* Sección B — Gestión de marcas (colapsable) */}
      <Card>
        <Accordion type="single" collapsible>
          <AccordionItem value="brands" className="border-b-0">
            <AccordionTrigger className="px-6 py-4 text-base">
              Marcas (líneas / sabores)
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6">
              <div className="flex flex-col gap-4">
                {loadingBrands ? (
                  <p className="text-sm text-muted-foreground">Cargando marcas...</p>
                ) : brands.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No hay marcas todavía. Creá la primera con el formulario de abajo.
                  </p>
                ) : (
                  <ul className="max-h-[35vh] space-y-2 overflow-y-auto pr-1">
                    {brands.map((b) => (
                      <li
                        key={b.id}
                        className="flex items-center justify-between gap-2 rounded-md border p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{b.name}</span>
                          {b.keywords.map((k) => (
                            <Badge key={k} variant="outline">
                              {k}
                            </Badge>
                          ))}
                          <SpeciesChecks
                            name={`brand-${b.id}`}
                            checks={speciesToChecks(b.species)}
                            onChange={(checks) => handleBrandSpeciesChange(b, checks)}
                            onReject={() =>
                              toast.info(
                                "Debe quedar al menos una especie seleccionada",
                              )
                            }
                          />
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => startEditBrand(b)}
                          >
                            Editar
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDeleteBrandId(b.id)}
                          >
                            Eliminar
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Formulario fijo abajo: siempre visible, no scrollea con la lista */}
                <div className="border-t pt-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="brand-name">Nombre</Label>
                      <Input
                        id="brand-name"
                        value={brandName}
                        onChange={(e) => setBrandName(e.target.value)}
                        placeholder="Ej: MAXXIUM CORDERO"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="brand-keywords">
                        Palabras clave (separadas por coma)
                      </Label>
                      <Input
                        id="brand-keywords"
                        value={brandKeywords}
                        onChange={(e) => setBrandKeywords(e.target.value)}
                        placeholder="Ej: MAXXIUM, CORDERO"
                      />
                    </div>
                  </div>

                  <div className="mt-4 space-y-1.5">
                    <Label>Especie</Label>
                    <SpeciesChecks
                      name="brand-form"
                      checks={brandChecks}
                      onChange={setBrandChecks}
                      onReject={() =>
                        toast.info("Debe quedar al menos una especie seleccionada")
                      }
                    />
                  </div>

                  <div className="mt-4 flex gap-2">
                    <Button
                      disabled={!brandName.trim() || savingBrand}
                      onClick={handleSaveBrand}
                    >
                      {editingBrandId ? "Guardar cambios" : "Agregar marca"}
                    </Button>
                    {editingBrandId && (
                      <Button variant="outline" onClick={resetBrandForm}>
                        Cancelar
                      </Button>
                    )}
                  </div>
                </div>

                <AlertDialog
                  open={deleteBrandId !== null}
                  onOpenChange={(open) => {
                    if (!open) setDeleteBrandId(null);
                  }}
                >
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Eliminar marca</AlertDialogTitle>
                      <AlertDialogDescription>
                        ¿Seguro que querés eliminar esta marca? Esta acción no se puede
                        deshacer.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDeleteBrand}>
                        Eliminar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Card>

      {/* Sección C — Planilla de precios por kilo */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">
                Planilla de precios por kilo
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {loadedCount} {loadedCount === 1 ? "celda" : "celdas"} con precio cargadas
              </p>
            </div>
            {/* Selector de planilla activa: solo filtra la matriz (sección C). */}
            <div className="flex items-center gap-1 rounded-md border bg-muted p-1">
              <Button
                size="sm"
                variant={activeSpecies === "PERRO" ? "default" : "ghost"}
                onClick={() => setActiveSpecies("PERRO")}
              >
                Perros
              </Button>
              <Button
                size="sm"
                variant={activeSpecies === "GATO" ? "default" : "ghost"}
                onClick={() => setActiveSpecies("GATO")}
              >
                Gatos
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!matrixReady ? (
            <p className="text-sm text-muted-foreground">Cargando planilla...</p>
          ) : brands.length === 0 || types.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Creá al menos una marca y un tipo para completar la planilla.
            </p>
          ) : visibleBrands.length === 0 || visibleTypes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay marcas o tipos para la planilla de{" "}
              {speciesLabel.toLowerCase()}.
            </p>
          ) : (
            <div className="max-h-[60vh] overflow-auto rounded-md border">
              {/* <table> cruda (sin el wrapper Table que rompe el sticky): el
                  contenedor de arriba es el scroll container, así el thead
                  sticky top-0 se pega al scrollear vertical. */}
              <table className="w-full caption-bottom text-sm">
                <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0] shadow-border">
                  <TableRow>
                    <TableHead className="min-w-[150px]">Marca</TableHead>
                    {visibleTypes.map((t) => (
                      <TableHead key={t.id} className="px-2 text-right text-xs">
                        {t.name}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleBrands.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="whitespace-nowrap p-2 font-medium">
                        {b.name}
                      </TableCell>
                      {visibleTypes.map((t) => {
                        const code = cellCodes[cellKey(activeSpecies, b.id, t.id)];
                        return (
                          <TableCell key={t.id} className="p-1.5">
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              className="h-8 w-20 px-2 text-right text-sm"
                              aria-label={`${b.name} ${t.name}`}
                              value={cells[cellKey(activeSpecies, b.id, t.id)] ?? ""}
                              onChange={(e) => setCell(b.id, t.id, e.target.value)}
                            />
                            <div
                              className="mt-1 text-center font-mono text-xs text-muted-foreground"
                              aria-label={`${b.name} ${t.name} código balanza`}
                              title="Código balanza (auto-asignado)"
                            >
                              {code ?? ""}
                            </div>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </table>
            </div>
          )}

          <div className="flex justify-end">
            <Button
              disabled={
                savingPlan ||
                !matrixReady ||
                visibleBrands.length === 0 ||
                visibleTypes.length === 0
              }
              onClick={handleSavePlan}
            >
              {savingPlan ? "Guardando..." : "Guardar planilla"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Print area: siempre en el DOM, oculto en pantalla y visible solo al
          imprimir (ver @media print en index.css). Sin estado: el botón solo
          llama window.print() y el navegador decide cuándo muestra esto. */}
      <div className="print-area print-planilla hidden print:block" aria-hidden="true">
        {(["PERRO", "GATO"] as const).map((sp) => {
          const spLabel = sp === "PERRO" ? "Perros" : "Gatos";
          const spTypes = types.filter((t) => t.species === sp || t.species === "AMBOS");
          const spBrands = brands.filter((b) => b.species === sp || b.species === "AMBOS");
          return (
            <div
              key={sp}
              className={`mb-4 text-[11px] leading-tight ${sp === "GATO" ? "break-before-page" : ""}`}
            >
              <h3 className="mb-1 text-lg font-bold">{spLabel}</h3>
              <Table className="border-collapse">
                <TableHeader>
                  <TableRow>
                    <TableHead rowSpan={2} className="px-1 py-0.5 border border-black print:h-6">
                      Marca
                    </TableHead>
                    {spTypes.map((t) => (
                      <TableHead key={t.id} colSpan={2} className="px-1 py-0.5 border border-black text-center print:h-6">
                        {typeHeader(t.name)}
                      </TableHead>
                    ))}
                  </TableRow>
                  <TableRow>
                    {spTypes.flatMap((t) => (
                      <Fragment key={t.id}>
                        <TableHead className="px-1 py-0.5 border border-black text-right print:h-6">cod.</TableHead>
                        <TableHead className="px-1 py-0.5 border border-black text-right print:h-6">$</TableHead>
                      </Fragment>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {spBrands.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="px-1 py-0.5 border border-black font-medium">{b.name}</TableCell>
                      {spTypes.flatMap((t) => {
                        const key = cellKey(sp, b.id, t.id);
                        const raw = (cells[key] ?? "").trim();
                        const price = parseFloat(raw);
                        const valid = raw !== "" && !Number.isNaN(price) && price > 0;
                        const code = cellCodes[key];
                        return (
                          <Fragment key={t.id}>
                            <TableCell className="px-1 py-0.5 border border-black text-right font-semibold tabular-nums">
                              {code ?? ""}
                            </TableCell>
                            <TableCell className="px-1 py-0.5 border border-black text-right tabular-nums">
                              {valid
                                ? price.toLocaleString("es-AR", { maximumFractionDigits: 0 })
                                : ""}
                            </TableCell>
                          </Fragment>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          );
        })}
        </div>
    </div>
  );
};
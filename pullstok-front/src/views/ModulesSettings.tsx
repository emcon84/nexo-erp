import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { useMutation } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Loader } from "@/components/atoms/loader";
import { useOrgModulesContext } from "@/contexts/OrgModulesContext";
import { updateModules } from "@/services/modulesService";

/**
 * Vista /ajustes/modulos (sdd/modulos-por-negocio). Un toggle por módulo del
 * registro. Los módulos que el plan de la org no permite se muestran BLOQUEADOS
 * (switch disabled). Guardar → PUT /api/modules → refresh del contexto →
 * el sidebar se actualiza.
 */
export const ModulesSettings = () => {
  const {
    registry,
    planAllowed,
    enabledModules,
    isLoading,
    refresh,
  } = useOrgModulesContext();

  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Sincroniza la selección con la config actual. Si la org tiene config
  // explícita (enabledModules) usa esa lista; si no, usa los módulos activos
  // del registry (defaults del plan + suelto condicional).
  useEffect(() => {
    const initial =
      enabledModules.length > 0
        ? enabledModules
        : registry.filter((m) => m.enabled).map((m) => m.key);
    setSelected(new Set(initial));
  }, [enabledModules, registry]);

  const mutation = useMutation({
    mutationFn: (modules: string[]) => updateModules(modules),
    onSuccess: () => {
      toast.success("Módulos guardados");
      refresh();
    },
    onError: (error) => {
      toast.error(error.message || "Error al guardar los módulos");
    },
  });

  const toggle = (key: string, allowed: boolean) => {
    if (!allowed) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSave = () => {
    mutation.mutate(Array.from(selected));
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Módulos</h1>
        <p className="text-muted-foreground">
          Activa o desactivá los módulos de tu negocio. Los que tu plan no
          incluye quedan bloqueados.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Módulos habilitados</CardTitle>
          <CardDescription>
            Cambiá la visibilidad de cada módulo en la barra lateral.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {registry.map((module) => {
            const allowed = planAllowed.includes(module.key);
            const checked = selected.has(module.key);
            return (
              <div
                key={module.key}
                className="flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">{module.label}</span>
                  {!allowed && (
                    <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </div>
                <Switch
                  checked={checked}
                  onCheckedChange={() => toggle(module.key, allowed)}
                  disabled={!allowed}
                  aria-label={`${module.label} (${module.key})`}
                />
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="mt-6 flex justify-end">
        <Button onClick={handleSave} disabled={mutation.isPending}>
          {mutation.isPending ? "Guardando..." : "Guardar módulos"}
        </Button>
      </div>
    </div>
  );
};

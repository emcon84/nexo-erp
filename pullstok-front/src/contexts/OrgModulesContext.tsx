/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useCallback,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOrgModules } from "../components/hooks/useOrgModules";
import type {
  ModuleRegistryEntry,
  Plan,
} from "../services/modulesService";

export interface OrgModulesContextValue {
  registry: ModuleRegistryEntry[];
  plan: Plan | null;
  planAllowed: string[];
  enabledModules: string[];
  hasPriceKg: boolean;
  isLoading: boolean;
  refresh: () => void;
}

const EMPTY_REGISTRY: ModuleRegistryEntry[] = [];
const EMPTY_STRINGS: string[] = [];

const DEFAULT_CONTEXT: OrgModulesContextValue = {
  registry: EMPTY_REGISTRY,
  plan: null,
  planAllowed: EMPTY_STRINGS,
  enabledModules: EMPTY_STRINGS,
  hasPriceKg: false,
  isLoading: true,
  refresh: () => {},
};

const OrgModulesContext = createContext<OrgModulesContextValue>(DEFAULT_CONTEXT);

export const useOrgModulesContext = () => useContext(OrgModulesContext);

/**
 * Proveedor de módulos por negocio (sdd/modulos-por-negocio). Se alimenta de
 * GET /api/modules (registro autoritativo del backend) y expone el estado que
 * el sidebar y la vista /ajustes/modulos necesitan para resolver los módulos
 * efectivos y bloquear los que el plan no permite.
 */
export const OrgModulesProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const { modules, loading } = useOrgModules();

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["modules"] });
  }, [queryClient]);

  const value: OrgModulesContextValue = {
    registry: modules?.registry ?? EMPTY_REGISTRY,
    plan: modules?.plan ?? null,
    planAllowed: modules?.planAllowed ?? EMPTY_STRINGS,
    enabledModules: modules?.enabledModules ?? EMPTY_STRINGS,
    hasPriceKg: modules?.hasPriceKg ?? false,
    isLoading: loading,
    refresh,
  };

  return (
    <OrgModulesContext.Provider value={value}>
      {children}
    </OrgModulesContext.Provider>
  );
};

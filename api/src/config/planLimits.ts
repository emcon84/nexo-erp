import { Plan } from "@prisma/client";

// Límites y módulos habilitados por plan. `null` en maxUsers/maxProducts/
// maxStoreProducts significa "ilimitado" (no se chequea contra ningún tope).
// `maxStoreProducts` = cuántos productos puede PUBLICAR en la tienda online
// (BASICO = 0 porque no tiene tienda; el gate de acceso vive en
// checkStoreEnabled.ts).

// ─────────────────────────────────────────────────────────────────────────────
// Registro autoritativo de módulos (sdd/modulos-por-negocio). El backend es la
// fuente de verdad; el front lo espeja en pullstok-front/src/constants/
// planLimits.ts. Cada módulo tiene key/label/minPlan. `suelto` (venta por kilo)
// se excluye de PLAN_LIMITS.modules a propósito: se agrega condicionalmente si
// la org tiene celdas de precio por kilo (ver resolveEffectiveModules).
// ─────────────────────────────────────────────────────────────────────────────
export interface ModuleRegistryEntry {
  key: string;
  label: string;
  minPlan: Plan;
}

export const MODULE_REGISTRY: ModuleRegistryEntry[] = [
  { key: "stock", label: "Stock", minPlan: "BASICO" },
  { key: "ventas", label: "Ventas", minPlan: "BASICO" },
  { key: "clientes", label: "Clientes", minPlan: "BASICO" },
  { key: "suelto", label: "Venta por kilo", minPlan: "BASICO" },
  { key: "presupuestos", label: "Presupuestos", minPlan: "PRO" },
  { key: "pedidos", label: "Pedidos", minPlan: "PRO" },
  { key: "remitos", label: "Remitos", minPlan: "PRO" },
  { key: "reportes", label: "Reportes", minPlan: "PRO" },
  { key: "tienda", label: "Tienda online", minPlan: "PRO" },
  { key: "facturacion", label: "Facturación", minPlan: "PRO" },
  { key: "pricing", label: "Config. de precios", minPlan: "PRO" },
  { key: "branding", label: "Branding", minPlan: "PRO" },
  { key: "bot", label: "Asistente IA", minPlan: "PREMIUM" },
];

// Jerarquía de planes para comparar minPlan contra el plan de la org.
export const PLAN_RANK: Record<Plan, number> = {
  BASICO: 0,
  PRO: 1,
  PREMIUM: 2,
};

/** Módulos (sin `suelto`) que un plan puede tener, derivados del registro. */
const modulesForPlan = (plan: Plan): string[] =>
  MODULE_REGISTRY.filter(
    (m) => m.key !== "suelto" && PLAN_RANK[plan] >= PLAN_RANK[m.minPlan],
  ).map((m) => m.key);

export const PLAN_LIMITS: Record<
  Plan,
  {
    maxUsers: number | null;
    maxProducts: number | null;
    maxStoreProducts: number | null;
    modules: string[];
  }
> = {
  BASICO: {
    maxUsers: 2,
    maxProducts: 500,
    maxStoreProducts: 0,
    modules: modulesForPlan("BASICO"),
  },
  PRO: {
    maxUsers: 10,
    maxProducts: null,
    maxStoreProducts: 100,
    modules: modulesForPlan("PRO"),
  },
  PREMIUM: {
    maxUsers: null,
    maxProducts: null,
    maxStoreProducts: null,
    modules: modulesForPlan("PREMIUM"),
  },
};

/** ¿El plan de la org permite un módulo (rank(plan) >= rank(minPlan))? */
export const isModuleAllowed = (plan: Plan, key: string): boolean => {
  const entry = MODULE_REGISTRY.find((m) => m.key === key);
  if (!entry) return false;
  return PLAN_RANK[plan] >= PLAN_RANK[entry.minPlan];
};

/**
 * Valida una lista de keys de módulo contra el plan de la org.
 * Devuelve las keys desconocidas y las no permitidas por el plan (plan-cap).
 * Pura: la usa el controller de PUT /modules y los tests.
 */
export const validateModules = (
  plan: Plan,
  keys: string[],
): { unknown: string[]; notAllowed: string[] } => {
  const known = new Set(MODULE_REGISTRY.map((m) => m.key));
  const unknown = keys.filter((k) => !known.has(k));
  const notAllowed = keys.filter((k) => known.has(k) && !isModuleAllowed(plan, k));
  return { unknown, notAllowed };
};

/**
 * Resuelve los módulos efectivos de una org. Si la org tiene una config
 * explícita (enabledModules no vacío), esa lista gana. Si no (legacy), usa los
 * defaults del plan y agrega `suelto` solo si la org tiene celdas de precio por
 * kilo (hasPriceKg). Esta es la fuente para `enabled` de cada módulo en el
 * sidebar y en la respuesta de GET /api/modules.
 */
export const resolveEffectiveModules = (
  enabledModules: string[],
  plan: Plan,
  hasPriceKg: boolean,
): string[] => {
  if (enabledModules.length > 0) return enabledModules;
  const base = PLAN_LIMITS[plan]?.modules ?? [];
  if (hasPriceKg && !base.includes("suelto")) return [...base, "suelto"];
  return base;
};

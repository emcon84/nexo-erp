// DEUDA TÉCNICA DOCUMENTADA: espejo de `api/src/config/planLimits.ts` (el
// backend es AUTORITATIVO, sdd/modulos-por-negocio). El shape y los valores se
// duplican a mano porque no existe un endpoint compartido que exponga esta
// tabla; si se agrega/quita un módulo en el backend, hay que replicarlo acá en
// el mismo commit o el sidebar se desincroniza. Ver sdd/facturacion-servicios
// y sdd/modulos-por-negocio en Engram.

export type Plan = "BASICO" | "PRO" | "PREMIUM";

export type ModuleRegistryEntry = {
  key: string;
  label: string;
  minPlan: Plan;
};

// Registro de módulos por negocio (espejo del backend). `suelto` se excluye de
// PLAN_LIMITS.modules a propósito: se agrega condicionalmente si la org tiene
// celdas de precio por kilo (resolveEffectiveModules en navItems.ts).
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

export const PLAN_RANK: Record<Plan, number> = {
  BASICO: 0,
  PRO: 1,
  PREMIUM: 2,
};

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

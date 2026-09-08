import { describe, it, expect } from "vitest";
import {
  navItems,
  resolveEffectiveModules,
  filterNavItemsByModules,
} from "../components/molecules/sidebar/navItems";
import {
  MODULE_REGISTRY,
  PLAN_LIMITS,
  PLAN_RANK,
} from "../constants/planLimits";
import type { Plan } from "../constants/planLimits";

describe("MODULE_REGISTRY (espejo del backend, autoritativo)", () => {
  it("el registro cubre TODOS los moduleKeys usados en navItems (guard de sync)", () => {
    const registryKeys = new Set(MODULE_REGISTRY.map((m) => m.key));
    const navKeys = navItems
      .map((item) => item.moduleKey)
      .filter((k): k is string => Boolean(k));
    navKeys.forEach((k) => {
      expect(registryKeys.has(k)).toBe(true);
    });
  });

  it("no incluye `ajustes` (el ítem Módulos es siempre visible, sin moduleKey)", () => {
    const keys = MODULE_REGISTRY.map((m) => m.key);
    expect(keys).not.toContain("ajustes");
  });

  it("cada entrada tiene key/label/minPlan válidos", () => {
    MODULE_REGISTRY.forEach((m) => {
      expect(m.key).toBeTruthy();
      expect(m.label).toBeTruthy();
      expect(["BASICO", "PRO", "PREMIUM"]).toContain(m.minPlan);
    });
  });

  it("PLAN_RANK es BASICO=0 PRO=1 PREMIUM=2", () => {
    expect(PLAN_RANK.BASICO).toBe(0);
    expect(PLAN_RANK.PRO).toBe(1);
    expect(PLAN_RANK.PREMIUM).toBe(2);
  });

  it("PLAN_LIMITS no incluye suelto en ningún plan", () => {
    (["BASICO", "PRO", "PREMIUM"] as Plan[]).forEach((plan) => {
      expect(PLAN_LIMITS[plan].modules).not.toContain("suelto");
    });
  });
});

describe("resolveEffectiveModules", () => {
  it("demo (PREMIUM, 0 celdas, sin config) → NO incluye suelto", () => {
    const modules = resolveEffectiveModules([], "PREMIUM", false);
    expect(modules).not.toContain("suelto");
    expect(modules).toContain("stock");
  });

  it("El Almacén (PREMIUM, 197 celdas, sin config) → incluye suelto", () => {
    const modules = resolveEffectiveModules([], "PREMIUM", true);
    expect(modules).toContain("suelto");
  });

  it("config explícita gana: suelto no se agrega aunque haya celdas", () => {
    const modules = resolveEffectiveModules(["stock", "ventas"], "PREMIUM", true);
    expect(modules).toEqual(["stock", "ventas"]);
    expect(modules).not.toContain("suelto");
  });

  it("BASICO con celdas → base + suelto", () => {
    const modules = resolveEffectiveModules([], "BASICO", true);
    expect(modules).toContain("suelto");
    expect(modules).toContain("stock");
  });
});

describe("filterNavItemsByModules", () => {
  const sampleItems = [
    { to: "/dashboard", label: "Dashboard", icon: {} as any },
    { to: "/suelto", label: "Venta suelta", icon: {} as any, moduleKey: "suelto" },
    { to: "/facturacion", label: "Facturación", icon: {} as any, moduleKey: "facturacion" },
  ];

  it("muestra ítems sin moduleKey (siempre visibles)", () => {
    const result = filterNavItemsByModules(sampleItems, []);
    expect(result.map((i) => i.to)).toContain("/dashboard");
  });

  it("oculta ítems cuyo moduleKey no está en los módulos efectivos", () => {
    const result = filterNavItemsByModules(sampleItems, ["stock"]);
    expect(result.map((i) => i.to)).not.toContain("/suelto");
    expect(result.map((i) => i.to)).not.toContain("/facturacion");
  });

  it("muestra ítems cuyo moduleKey sí está en los módulos efectivos", () => {
    const result = filterNavItemsByModules(sampleItems, ["stock", "suelto", "facturacion"]);
    const paths = result.map((i) => i.to);
    expect(paths).toContain("/suelto");
    expect(paths).toContain("/facturacion");
    expect(paths).toContain("/dashboard");
  });
});

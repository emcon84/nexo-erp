/**
 * Unit tests para el registro de módulos por negocio (sdd/modulos-por-negocio).
 * Sin DB: prueban MODULE_REGISTRY, PLAN_RANK, la derivación de PLAN_LIMITS
 * (excluye `suelto`), validateModules (rechazo por plan) y resolveEffectiveModules.
 * Todas funciones puras de api/src/config/planLimits.ts.
 */
import {
  MODULE_REGISTRY,
  PLAN_RANK,
  PLAN_LIMITS,
  isModuleAllowed,
  validateModules,
  resolveEffectiveModules,
} from "../../src/config/planLimits";
import type { Plan } from "@prisma/client";

describe("MODULE_REGISTRY", () => {
  it("expone 13 módulos (sin `ajustes`)", () => {
    expect(MODULE_REGISTRY).toHaveLength(13);
    const keys = MODULE_REGISTRY.map((m) => m.key);
    expect(keys).not.toContain("ajustes");
  });

  it("cubre todos los moduleKeys usados en el sidebar del front", () => {
    const keys = MODULE_REGISTRY.map((m) => m.key);
    // moduleKeys de navItems.ts: suelto (6 ítems sueltos), facturacion,
    // branding, pricing, bot.
    ["stock", "ventas", "clientes", "suelto", "presupuestos", "pedidos",
      "remitos", "reportes", "tienda", "facturacion", "pricing", "branding",
      "bot"].forEach((k) => expect(keys).toContain(k));
  });

  it("cada entrada tiene key/label/minPlan válidos", () => {
    MODULE_REGISTRY.forEach((m) => {
      expect(m.key).toBeTruthy();
      expect(m.label).toBeTruthy();
      expect(["BASICO", "PRO", "PREMIUM"]).toContain(m.minPlan);
    });
  });

  it("no hay keys duplicadas", () => {
    const keys = MODULE_REGISTRY.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("PLAN_RANK", () => {
  it("BASICO=0 < PRO=1 < PREMIUM=2", () => {
    expect(PLAN_RANK.BASICO).toBe(0);
    expect(PLAN_RANK.PRO).toBe(1);
    expect(PLAN_RANK.PREMIUM).toBe(2);
  });
});

describe("PLAN_LIMITS (derivado del registro)", () => {
  it("ningún plan incluye `suelto` en modules (se agrega condicionalmente)", () => {
    (["BASICO", "PRO", "PREMIUM"] as Plan[]).forEach((plan) => {
      expect(PLAN_LIMITS[plan].modules).not.toContain("suelto");
    });
  });

  it("BASICO no incluye módulos PRO/PREMIUM (tienda, bot)", () => {
    expect(PLAN_LIMITS.BASICO.modules).not.toContain("tienda");
    expect(PLAN_LIMITS.BASICO.modules).not.toContain("bot");
    expect(PLAN_LIMITS.BASICO.modules).not.toContain("pricing");
    expect(PLAN_LIMITS.BASICO.modules).not.toContain("branding");
  });

  it("PRO incluye los módulos PRO (tienda, facturacion, branding, pricing) y NO bot", () => {
    expect(PLAN_LIMITS.PRO.modules).toContain("tienda");
    expect(PLAN_LIMITS.PRO.modules).toContain("facturacion");
    expect(PLAN_LIMITS.PRO.modules).toContain("branding");
    expect(PLAN_LIMITS.PRO.modules).toContain("pricing");
    expect(PLAN_LIMITS.PRO.modules).not.toContain("bot");
  });

  it("PREMIUM incluye todos los módulos del registro excepto suelto", () => {
    const premiumModules = new Set(PLAN_LIMITS.PREMIUM.modules);
    MODULE_REGISTRY.forEach((m) => {
      if (m.key === "suelto") {
        expect(premiumModules.has(m.key)).toBe(false);
      } else {
        expect(premiumModules.has(m.key)).toBe(true);
      }
    });
  });
});

describe("isModuleAllowed / validateModules (plan-cap)", () => {
  it("isModuleAllowed: BASICO puede suelto, no puede bot", () => {
    expect(isModuleAllowed("BASICO", "suelto")).toBe(true);
    expect(isModuleAllowed("BASICO", "bot")).toBe(false);
    expect(isModuleAllowed("PRO", "pricing")).toBe(true);
    expect(isModuleAllowed("PRO", "bot")).toBe(false);
    expect(isModuleAllowed("PREMIUM", "bot")).toBe(true);
  });

  it("validateModules: keys válidas para el plan → sin errores", () => {
    expect(validateModules("PRO", ["stock", "ventas", "pricing"])).toEqual({
      unknown: [],
      notAllowed: [],
    });
  });

  it("validateModules: PRO con `bot` (PREMIUM) → notAllowed", () => {
    const result = validateModules("PRO", ["stock", "bot"]);
    expect(result.notAllowed).toContain("bot");
    expect(result.unknown).toEqual([]);
  });

  it("validateModules: key desconocida → unknown", () => {
    const result = validateModules("PREMIUM", ["stock", "no-existe"]);
    expect(result.unknown).toContain("no-existe");
    expect(result.notAllowed).toEqual([]);
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

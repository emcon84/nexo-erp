/**
 * Zod schema tests para updateModulesSchema (sdd/modulos-por-negocio, task 2.1).
 * Sin DB. En un archivo aparte para no mezclarse con el suite genérico de
 * schemas (que ya tiene fallas pre-existentes).
 */
import { updateModulesSchema } from "../../src/validation/schemas";

describe("updateModulesSchema", () => {
  it("acepta un body con modules de strings", () => {
    const result = updateModulesSchema.safeParse({
      modules: ["stock", "ventas", "pricing"],
    });
    expect(result.success).toBe(true);
    expect(result.data?.modules).toEqual(["stock", "ventas", "pricing"]);
  });

  it("acepta un array vacío (desconfigurar → legacy)", () => {
    const result = updateModulesSchema.safeParse({ modules: [] });
    expect(result.success).toBe(true);
    expect(result.data?.modules).toEqual([]);
  });

  it("rechaza si falta modules", () => {
    const result = updateModulesSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rechaza si modules no es un array", () => {
    const result = updateModulesSchema.safeParse({ modules: "stock" });
    expect(result.success).toBe(false);
  });

  it("rechaza campos desconocidos (strict)", () => {
    const result = updateModulesSchema.safeParse({
      modules: ["stock"],
      extra: "no va",
    });
    expect(result.success).toBe(false);
  });
});

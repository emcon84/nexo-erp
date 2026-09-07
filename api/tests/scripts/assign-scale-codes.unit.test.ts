import {
  planScaleCodes,
  parentBrandOf,
  type CellLike,
} from "../../scripts/assign-scale-codes";

const cell = (over: Partial<CellLike> = {}): CellLike => ({
  id: "c1",
  brandId: "b1",
  brandName: "Royal Canin",
  parentBrand: "ROYAL CANIN",
  typeName: "Adulto",
  species: "PERRO",
  priceKg: 15000,
  ...over,
});

describe("planScaleCodes — códigos corridos de 3 dígitos dentro del límite", () => {
  it("arranca en 101 y ordena por marca madre → tipo → especie", () => {
    const plan = planScaleCodes([
      cell({ id: "a", parentBrand: "CAT CHOW", typeName: "Kitten" }),
      cell({ id: "b", parentBrand: "CAT CHOW", typeName: "Adulto" }),
      cell({ id: "c", parentBrand: "AGILITY", typeName: "Adulto" }),
    ]);
    // AGILITY (A) antes que CAT CHOW (C); dentro de CAT CHOW, Adulto antes de Kitten.
    expect(plan.map((p) => p.scaleCode)).toEqual(["101", "102", "103"]);
    expect(plan[0].parentBrand).toBe("AGILITY");
    expect(plan[1].typeName).toBe("Adulto");
    expect(plan[2].typeName).toBe("Kitten");
  });

  it("todos los códigos son de 3 dígitos, únicos y dentro del rango", () => {
    const plan = planScaleCodes(
      Array.from({ length: 200 }, (_, i) =>
        cell({ id: `c${i}`, parentBrand: `MARCA${String(i).padStart(3, "0")}` }),
      ),
    );
    const set = new Set(plan.map((p) => p.scaleCode));
    expect(set.size).toBe(200);
    for (const p of plan) {
      expect(p.scaleCode).toMatch(/^\d{3}$/);
      expect(Number(p.scaleCode)).toBeLessThan(1000);
    }
    expect(plan[0].scaleCode).toBe("101");
    expect(plan[199].scaleCode).toBe("300"); // 101 + 199
  });

  it("es determinista aunque las celdas vengan en otro orden", () => {
    const cells = [
      cell({ id: "a", parentBrand: "B", typeName: "X" }),
      cell({ id: "b", parentBrand: "A", typeName: "Y" }),
      cell({ id: "c", parentBrand: "B", typeName: "A" }),
    ];
    const key = (p: { parentBrand: string; typeName: string; scaleCode: string }) =>
      `${p.parentBrand}:${p.typeName}=${p.scaleCode}`;
    const fwd = planScaleCodes(cells).map(key);
    const rev = planScaleCodes(cells.slice().reverse()).map(key);
    expect(fwd).toEqual(rev);
  });

  it("marca con '0000' las celdas que no entran en el rango de 3 dígitos", () => {
    const many = Array.from({ length: 3000 }, (_, i) =>
      cell({ id: `c${i}`, parentBrand: `P${String(i).padStart(4, "0")}` }),
    );
    const plan = planScaleCodes(many);
    expect(plan[898].scaleCode).toBe("999"); // último código dentro del rango (101..999)
    expect(plan[899].scaleCode).toBe("0000"); // se desborda
    expect(plan.filter((p) => p.scaleCode === "0000")).toHaveLength(3000 - 899);
  });
});

describe("parentBrandOf — colapsa variantes a la marca madre", () => {
  it("quita tokens de variante (RP, EN, PREMIUM...)", () => {
    expect(parentBrandOf("PRO PLAN RP")).toBe("PRO PLAN");
    expect(parentBrandOf("OLD PRINCE PREMIUM")).toBe("OLD PRINCE");
  });

  it("mantiene intacta la marca madre real", () => {
    expect(parentBrandOf("ROYAL CANIN")).toBe("ROYAL CANIN");
    expect(parentBrandOf("7 VIDAS")).toBe("7 VIDAS");
  });
});

import { describe, it, expect } from "vitest";
import {
  groupByBrand,
  groupByPlanTitle,
  planTitleOf,
  planTitleKeyOf,
  productBrandOf,
  groupByPdfHierarchy,
} from "@/lib/printGrouping";

interface Item {
  id: string;
  name: string;
  brand: string;
}

const item = (id: string, name: string, brand = ""): Item => ({
  id,
  name,
  brand,
});

describe("groupByBrand — agrupación de listados imprimibles", () => {
  it("agrupa por marca y ordena los grupos alfabéticamente (locale es)", () => {
    const items = [
      item("3", "Zeta", "Zap"),
      item("1", "Alfa", "Acme"),
      item("2", "Beta", "Acme"),
    ];

    const groups = groupByBrand(items, (i) => i.brand, (a, b) =>
      a.name.localeCompare(b.name),
    );

    expect(groups.map((g) => g.brand)).toEqual(["Acme", "Zap"]);
    expect(groups[0].items.map((i) => i.name)).toEqual(["Alfa", "Beta"]);
  });

  it("manda 'Sin marca' al final", () => {
    const items = [
      item("1", "Suelto", ""),
      item("2", "Marca", "Purina"),
    ];

    const groups = groupByBrand(items, (i) => i.brand, (a, b) =>
      a.name.localeCompare(b.name),
    );

    expect(groups.map((g) => g.brand)).toEqual(["Purina", "Sin marca"]);
  });

  it("trata whitespace como sin marca", () => {
    const groups = groupByBrand(
      [item("1", "X", "   ")],
      (i) => i.brand,
      (a, b) => a.name.localeCompare(b.name),
    );
    expect(groups.map((g) => g.brand)).toEqual(["Sin marca"]);
  });

  it("devuelve [] para items vacíos", () => {
    expect(
      groupByBrand<Item>([], (i) => i.brand, (a, b) => a.name.localeCompare(b.name)),
    ).toEqual([]);
  });

  it("productBrandOf lee la variante 'Marca' del DataItem", () => {
    const withBrand = {
      variantAssignments: [
        { option: { value: "15 KG", variant: { name: "Tamaño" } } },
        { option: { value: "Purina", variant: { name: "Marca" } } },
      ],
    };
    expect(productBrandOf(withBrand)).toBe("Purina");

    const withoutBrand = { variantAssignments: [] };
    expect(productBrandOf(withoutBrand)).toBe("");
    expect(productBrandOf({})).toBe("");
  });
});

describe("groupByPdfHierarchy — jerarquía del PDF para la planilla mayorista", () => {
  const section = (
    id: string,
    position: number,
    entries: { position: number; name: string }[],
    line: string | null = null,
    brand: string | null = "SIEGER",
  ) => ({ id, brand, line, subline: null, position, entries });

  it("ordena secciones por position y entradas por position", () => {
    const sections = [
      section("s2", 1, [
        { position: 1, name: "B" },
        { position: 0, name: "A" },
      ], "L2"),
      section("s1", 0, [{ position: 0, name: "X" }], "L1"),
    ];
    const result = groupByPdfHierarchy(sections);
    expect(result.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(result[1].entries.map((e) => e.name)).toEqual(["A", "B"]);
  });

  it("descarta secciones sin entradas", () => {
    const sections = [
      section("s-vacia", 0, [], "L-vacia"),
      section("s-ok", 1, [{ position: 0, name: "A" }], "L-ok"),
    ];
    const result = groupByPdfHierarchy(sections);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("s-ok");
  });

  it("fusiona secciones con la misma marca|línea|sublínea (PDF repite grupos)", () => {
    const sections = [
      section("s1", 0, [{ position: 0, name: "A" }], "GI", "ROYAL CANIN"),
      { id: "s2", brand: "ROYAL CANIN", line: "FELINE", subline: "RAZAS PEQUEÑAS", position: 3, entries: [{ position: 0, name: "B" }] },
      section("s3", 2, [{ position: 0, name: "C" }], "GI", "ROYAL CANIN"),
    ];
    const result = groupByPdfHierarchy(sections);
    // s1 y s3 comparten (ROYAL CANIN, GI, null) → se unen; s2 queda aparte.
    expect(result).toHaveLength(2);
    const merged = result.find((s) => s.line === "GI")!;
    expect(merged.entries.map((e) => e.name)).toEqual(["A", "C"]);
    expect(merged.position).toBe(0);
  });

  it("conserva la jerarquía brand/line/subline de cada sección", () => {
    const sections = [
      {
        id: "s1",
        brand: "SIEGER",
        line: "SUPER PREMIUM PARA PERROS",
        subline: "SIEGER PUPPY",
        position: 0,
        entries: [{ position: 0, name: "A" }],
      },
    ];
    const [s] = groupByPdfHierarchy(sections);
    expect(s.brand).toBe("SIEGER");
    expect(s.line).toBe("SUPER PREMIUM PARA PERROS");
    expect(s.subline).toBe("SIEGER PUPPY");
  });
});

describe("planTitleOf — label de título de planilla de un producto", () => {
  const section = (
    overrides: Partial<{ brand: string | null; line: string | null; subline: string | null; position: number }>,
  ) => ({ planSection: { brand: null, line: null, subline: null, position: 0, ...overrides } });

  it("devuelve '' sin planSection", () => {
    expect(planTitleOf({})).toBe("");
    expect(planTitleOf({ planSection: null })).toBe("");
  });

  it("label = subline ?? brand (regla exacta del backend)", () => {
    expect(planTitleOf(section({ brand: "SIEGER", line: "SUPER PREMIUM PARA PERROS", subline: "SIEGER PUPPY" })))
      .toBe("SIEGER PUPPY");
    expect(planTitleOf(section({ brand: "MAXXIUM", line: null, subline: "MAXXIUM PERROS" })))
      .toBe("MAXXIUM PERROS");
    expect(planTitleOf(section({ brand: "BENTONITA HOMEBRAND", line: null, subline: null })))
      .toBe("BENTONITA HOMEBRAND");
  });

  it("sin subline ni brand → '' (aunque haya línea)", () => {
    expect(planTitleOf(section({ brand: null, line: "LÍNEA SUELTA", subline: null }))).toBe("");
  });
});

describe("planTitleKeyOf — clave compuesta para el filtro", () => {
  const section = (
    overrides: Partial<{ brand: string | null; line: string | null; subline: string | null; position: number }>,
  ) => ({ planSection: { brand: null, line: null, subline: null, position: 0, ...overrides } });

  it("construye [brand, line, subline].filter(Boolean).join('|')", () => {
    expect(planTitleKeyOf(section({ brand: "SIEGER", line: "SUPER PREMIUM PARA PERROS", subline: "SIEGER PUPPY" })))
      .toBe("SIEGER|SUPER PREMIUM PARA PERROS|SIEGER PUPPY");
    expect(planTitleKeyOf(section({ brand: "MAXXIUM", line: null, subline: "MAXXIUM PERROS" })))
      .toBe("MAXXIUM|MAXXIUM PERROS");
    expect(planTitleKeyOf(section({ brand: "AGILITY", line: null, subline: null })))
      .toBe("AGILITY");
  });

  it("devuelve '' sin planSection", () => {
    expect(planTitleKeyOf({})).toBe("");
    expect(planTitleKeyOf({ planSection: null })).toBe("");
  });
});

describe("groupByPlanTitle — agrupación por título de planilla para impresión", () => {
  interface Item {
    id: string;
    name: string;
    variantAssignments?: { option?: { value?: string; variant?: { name?: string } } }[];
    planSection?: { brand: string | null; line: string | null; subline: string | null; position: number } | null;
  }
  const item = (
    id: string,
    name: string,
    planSection: Item["planSection"] = null,
    brand = "",
  ): Item => ({
    id,
    name,
    ...(brand
      ? { variantAssignments: [{ option: { value: brand, variant: { name: "Marca" } } }] }
      : {}),
    planSection,
  });

  it("agrupa por label y ordena los grupos por position mínima (orden del PDF)", () => {
    const items = [
      item("1", "Puppy A", { brand: "SIEGER", line: "SUPER PREMIUM PARA PERROS", subline: "SIEGER PUPPY", position: 2 }),
      item("2", "Adulto A", { brand: "SIEGER", line: null, subline: "SIEGER ADULTO", position: 1 }),
      item("3", "Puppy B", { brand: "SIEGER", line: "SUPER PREMIUM PARA PERROS", subline: "SIEGER PUPPY", position: 3 }),
    ];
    const groups = groupByPlanTitle(items);
    expect(groups.map((g) => g.title)).toEqual(["SIEGER ADULTO", "SIEGER PUPPY"]);
    expect(groups[1].items.map((i) => i.name)).toEqual(["Puppy A", "Puppy B"]);
  });

  it("los productos sin planSection caen a su marca (productBrandOf)", () => {
    const items = [
      item("1", "Puppy A", { brand: "SIEGER", line: null, subline: "SIEGER PUPPY", position: 1 }),
      item("2", "Purina Adultos", null, "Purina"),
    ];
    const groups = groupByPlanTitle(items);
    expect(groups.map((g) => g.title)).toEqual(["SIEGER PUPPY", "Purina"]);
    expect(groups[1].items.map((i) => i.name)).toEqual(["Purina Adultos"]);
  });

  it("sin planSection ni marca va al bucket final 'Sin marca'", () => {
    const items = [
      item("1", "Collar Suelto", null),
      item("2", "Purina Pro", null, "Purina"),
      item("3", "Konga Snack", null, "Konga"),
    ];
    const groups = groupByPlanTitle(items);
    expect(groups.map((g) => g.title)).toEqual(["Konga", "Purina", "Sin marca"]);
    expect(groups[2].items.map((i) => i.name)).toEqual(["Collar Suelto"]);
  });

  it("mezcla en un mismo grupo productos con el mismo label (título = marca)", () => {
    const items = [
      item("1", "Maxxium Perros 15kg", { brand: "MAXXIUM", line: "PERROS", subline: null, position: 4 }, "MAXXIUM"),
      item("2", "Maxxium Suelto", null, "MAXXIUM"),
    ];
    const groups = groupByPlanTitle(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("MAXXIUM");
    expect(groups[0].items.map((i) => i.name)).toEqual(["Maxxium Perros 15kg", "Maxxium Suelto"]);
  });

  it("AGILITY CATS se agrupa por nombre en su propio título (no se mezcla con AGILITY)", () => {
    const items = [
      item("1", "AGILITY Cachorros x 3 Kg.", null, "AGILITY"),
      item("2", "AGILITY CATS KITTEN X 1.5 KG.", null, "AGILITY"),
      item("3", "AGILITY + CATS CONTROL DE PESO X 1.5KG.", null, "AGILITY"),
      item("4", "AGILITY + Adult Cat Salmón x 1,5 Kg.", null, "AGILITY"),
    ];
    const groups = groupByPlanTitle(items);
    expect(groups.map((g) => g.title)).toEqual(["AGILITY", "AGILITY CATS"]);
    expect(groups[0].items.map((i) => i.name)).toEqual(["AGILITY Cachorros x 3 Kg."]);
    expect(groups[1].items.map((i) => i.name)).toEqual([
      "AGILITY + Adult Cat Salmón x 1,5 Kg.",
      "AGILITY + CATS CONTROL DE PESO X 1.5KG.",
      "AGILITY CATS KITTEN X 1.5 KG.",
    ]);
  });

  it("ordena los items dentro de cada grupo por nombre (locale es)", () => {
    const items = [
      item("1", "Zeta", null, "Purina"),
      item("2", "Alfa", null, "Purina"),
    ];
    const groups = groupByPlanTitle(items);
    expect(groups[0].items.map((i) => i.name)).toEqual(["Alfa", "Zeta"]);
  });

  it("devuelve [] para items vacíos", () => {
    expect(groupByPlanTitle<Item>([])).toEqual([]);
  });
});

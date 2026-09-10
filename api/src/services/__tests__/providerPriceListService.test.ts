/**
 * Unit tests del parser de planillas multi-marca (limpieza de nombres).
 * Sin DB. Se invoca parsePriceList con un DetectedLayout fijo para no depender
 * de la detección de proveedor.
 */
import { parsePriceList, type DetectedLayout } from "../providerPriceListService";

const royalCanin = (text: string) =>
  parsePriceList(text, {
    provider: "royal-canin",
    layout: "hierarchical-2lvl",
    sections: [],
  } as DetectedLayout);

describe("parsePriceList — limpieza de nombres raros", () => {
  it("saca el SKU alfanumérico de Royal Canin y el código de línea del nombre", () => {
    const { rows } = royalCanin(
      "CW34H FCN HAIRBALL CARE POUCH (12X85G) X 1.02 KG\t10642\t$12877\t$",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].nombre).toBe("HAIRBALL CARE POUCH (12X85G) X 1.02 KG");
    expect(rows[0].codigo).toBe("CW34H");
  });

  it("separa palabras compuestas pegadas (GATOADULTO → GATO ADULTO)", () => {
    const { rows } = royalCanin(
      "EUKANUBA GATOADULTO TOP CONDITION X 1.5 KG\t18426\t$22295\t$",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].nombre).toBe("EUKANUBA GATO ADULTO TOP CONDITION X 1.5 KG");
  });

  it("no rompe nombres sin SKU ni código de línea", () => {
    const { rows } = royalCanin(
      "EUKANUBA PUPPY SMALL BREED X 3 KG\t20000\t$24200\t$",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].nombre).toBe("EUKANUBA PUPPY SMALL BREED X 3 KG");
    expect(rows[0].codigo).toBeNull();
  });

  it("no compone pesos en filas de continuación (X 3 KG X 10 KG)", () => {
    const { rows } = royalCanin(
      [
        "2544004 Mother & Babycat 0.4\t100\t$121\t$",
        "2544015 1.5\t150\t$181\t$",
      ].join("\n"),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].nombre).toBe("Mother & Babycat X 0.4 KG");
    expect(rows[1].nombre).toBe("Mother & Babycat X 1.5 KG");
  });

  it("saca la etiqueta de sección (HÚMEDO) y el código del nombre", () => {
    const { rows } = royalCanin(
      "HÚMEDO 3390102 URINARY SO FELINE WET POUCH (12X85G) X 1.02 KG\t1120\t$1355\t$",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].nombre).toBe(
      "URINARY SO FELINE WET POUCH (12X85G) X 1.02 KG",
    );
    expect(rows[0].codigo).toBe("3390102");
  });
});

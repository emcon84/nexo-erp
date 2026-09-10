import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrintProductList } from "@/components/molecules/PrintProductList";
import type { DataItem } from "@/types";

function product(overrides: Partial<DataItem> = {}): DataItem {
  return {
    _id: "p-" + Math.random().toString(36).slice(2, 8),
    name: "Producto",
    code: "CODE",
    price: 1000,
    quantity: 4,
    ...overrides,
  };
}

describe("PrintProductList — listado de productos imprimible", () => {
  it("muestra el logo en el encabezado", () => {
    render(<PrintProductList products={[product()]} />);
    const logo = screen.getByTestId("print-logo") as HTMLImageElement;
    expect(logo.src).toContain("logo-horizontal-almacen");
  });

  it("muestra todos los productos sin paginar", () => {
    const products = Array.from({ length: 12 }, (_, i) =>
      product({ name: `Producto ${i + 1}` }),
    );

    render(<PrintProductList products={products} />);

    for (let i = 1; i <= 12; i++) {
      expect(screen.getByText(`Producto ${i}`)).toBeInTheDocument();
    }
  });

  it("muestra solo nombre y precio formateado", () => {
    const p = {
      _id: "p-cat",
      name: "Collar de Cuero",
      code: "COL-01",
      price: 1500,
      quantity: 5,
      priceKgSuelto: 1500,
      category: { name: "Accesorios" },
    } as unknown as DataItem;

    render(<PrintProductList products={[p]} />);

    expect(screen.getByText("Collar de Cuero")).toBeInTheDocument();
    expect(screen.getByText("$ 1.500")).toBeInTheDocument();
    // Nada más: sin código, categoría ni stock
    expect(screen.queryByText("COL-01")).not.toBeInTheDocument();
    expect(screen.queryByText("Accesorios")).not.toBeInTheDocument();
    expect(screen.queryByText("5 kg")).not.toBeInTheDocument();
    expect(screen.queryByText("5 u.")).not.toBeInTheDocument();
  });

  it("divide la planilla por títulos por marca", () => {
    const products = [
      product({
        name: "Proplan Adultos",
        variantAssignments: [
          { option: { value: "Proplan", variant: { name: "Marca" } } },
        ],
      }),
      product({
        name: "Purina Pro Plan",
        variantAssignments: [
          { option: { value: "Purina", variant: { name: "Marca" } } },
        ],
      }),
      product({
        name: "Kongo Snacks",
        variantAssignments: [
          { option: { value: "Kongo", variant: { name: "Marca" } } },
        ],
      }),
    ];

    render(<PrintProductList products={products} />);

    const titles = screen
      .getAllByRole("heading", { level: 2, hidden: true })
      .map((h) => h.textContent);
    expect(titles).toEqual(["Kongo", "Proplan", "Purina"]);
    expect(screen.getByText("Purina Pro Plan")).toBeInTheDocument();
    expect(screen.getByText("Proplan Adultos")).toBeInTheDocument();
    expect(screen.getByText("Kongo Snacks")).toBeInTheDocument();
  });

  it("agrupa los productos sin marca bajo 'Sin marca'", () => {
    const products = [
      product({ name: "Collar Suelto" }),
      product({
        name: "Purina Pro",
        variantAssignments: [
          { option: { value: "Purina", variant: { name: "Marca" } } },
        ],
      }),
    ];

    render(<PrintProductList products={products} />);

    const titles = screen
      .getAllByRole("heading", { level: 2, hidden: true })
      .map((h) => h.textContent);
    expect(titles).toEqual(["Purina", "Sin marca"]);
  });

  it("muestra la línea con el conteo de productos", () => {
    render(<PrintProductList products={[product(), product()]} />);

    expect(screen.getByText(/2 productos/)).toBeInTheDocument();
    expect(screen.getByText(/\d{1,2}\/\d{1,2}\/\d{2,4}/)).toBeInTheDocument();
  });

  it("agrupa por título de planilla en orden de position (orden del PDF)", () => {
    const products = [
      product({
        name: "Puppy A",
        planSection: {
          brand: "SIEGER",
          line: "SUPER PREMIUM PARA PERROS",
          subline: "SIEGER PUPPY",
          position: 2,
        },
      }),
      product({
        name: "Adulto B",
        planSection: {
          brand: "SIEGER",
          line: null,
          subline: "SIEGER ADULTO",
          position: 1,
        },
      }),
      product({
        name: "Puppy B",
        planSection: {
          brand: "SIEGER",
          line: "SUPER PREMIUM PARA PERROS",
          subline: "SIEGER PUPPY",
          position: 2,
        },
      }),
    ];

    render(<PrintProductList products={products} />);

    const titles = screen
      .getAllByRole("heading", { level: 2, hidden: true })
      .map((h) => h.textContent);
    expect(titles).toEqual(["SIEGER ADULTO", "SIEGER PUPPY"]);
    expect(screen.getByText("Puppy A")).toBeInTheDocument();
    expect(screen.getByText("Puppy B")).toBeInTheDocument();
    expect(screen.getByText("Adulto B")).toBeInTheDocument();
  });

  it("mezcla: con título de planilla va a su grupo; sin título a su marca", () => {
    const products = [
      product({
        name: "Purina Adultos",
        variantAssignments: [
          { option: { value: "Purina", variant: { name: "Marca" } } },
        ],
      }),
      product({
        name: "Puppy A",
        planSection: {
          brand: "SIEGER",
          line: null,
          subline: "SIEGER PUPPY",
          position: 1,
        },
      }),
    ];

    render(<PrintProductList products={products} />);

    const titles = screen
      .getAllByRole("heading", { level: 2, hidden: true })
      .map((h) => h.textContent);
    // Títulos de planilla primero (orden del PDF), luego las marcas.
    expect(titles).toEqual(["SIEGER PUPPY", "Purina"]);
  });

  it("muestra el mensaje vacío cuando no hay productos", () => {
    render(<PrintProductList products={[]} />);

    expect(screen.getByText("No hay productos todavía.")).toBeInTheDocument();
  });
});

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrintBulkPriceList } from "@/components/molecules/PrintBulkPriceList";
import type { BulkPricePreviewRow } from "@/services/productService";

function row(overrides: Partial<BulkPricePreviewRow> = {}): BulkPricePreviewRow {
  return {
    id: "r-" + Math.random().toString(36).slice(2, 8),
    name: "Producto",
    categoryName: "Alimentos",
    brandValues: ["Acme"],
    oldPrice: 100,
    newPrice: 110,
    delta: 10,
    effectivePercentage: 10,
    ...overrides,
  };
}

describe("PrintBulkPriceList — listado imprimible de precios actualizados", () => {
  it("muestra el logo en el encabezado", () => {
    render(<PrintBulkPriceList rows={[row()]} />);
    const logo = screen.getByTestId("print-logo") as HTMLImageElement;
    expect(logo.src).toContain("logo-horizontal-almacen");
  });

  it("muestra todas las filas sin paginar", () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      row({ name: `Producto ${i + 1}` }),
    );

    render(<PrintBulkPriceList rows={rows} />);

    for (let i = 1; i <= 12; i++) {
      expect(screen.getByText(`Producto ${i}`)).toBeInTheDocument();
    }
  });

  it("muestra SOLO nombre y precio nuevo (con título de marca)", () => {
    const r = row({ name: "Purina Pro Plan", newPrice: 15500.5, oldPrice: 15000, categoryName: "Alimentos", brandValues: ["Purina"] });

    render(<PrintBulkPriceList rows={[r]} />);

    expect(screen.getByText("Purina Pro Plan")).toBeInTheDocument();
    expect(screen.getByText("$ 15.500,5")).toBeInTheDocument();
    // La marca aparece SOLO como título de grupo (es lo pedido).
    expect(screen.getByText("Purina")).toBeInTheDocument();
    // Nada más: sin categoría, % ni precio viejo
    expect(screen.queryByText("Alimentos")).not.toBeInTheDocument();
    expect(screen.queryByText("$ 15.000")).not.toBeInTheDocument();
    expect(screen.queryByText("10%")).not.toBeInTheDocument();
  });

  it("divide la planilla por títulos por marca", () => {
    const rows = [
      row({ name: "Proplan Adultos", brandValues: ["Proplan"], newPrice: 200 }),
      row({ name: "Purina Pro Plan", brandValues: ["Purina"], newPrice: 100 }),
      row({ name: "Kongo Snacks", brandValues: ["Kongo"], newPrice: 50 }),
    ];

    render(<PrintBulkPriceList rows={rows} />);

    // Títulos por marca en orden alfabético
    const titles = screen
      .getAllByRole("heading", { level: 2, hidden: true })
      .map((h) => h.textContent);
    expect(titles).toEqual(["Kongo", "Proplan", "Purina"]);
    expect(screen.getByText("Purina Pro Plan")).toBeInTheDocument();
    expect(screen.getByText("Proplan Adultos")).toBeInTheDocument();
    expect(screen.getByText("Kongo Snacks")).toBeInTheDocument();
  });

  it("agrupa los productos sin marca bajo 'Sin marca'", () => {
    const rows = [
      row({ name: "Producto Suelto", brandValues: [] }),
      row({ name: "Purina Pro", brandValues: ["Purina"] }),
    ];

    render(<PrintBulkPriceList rows={rows} />);

    const titles = screen
      .getAllByRole("heading", { level: 2, hidden: true })
      .map((h) => h.textContent);
    expect(titles).toEqual(["Purina", "Sin marca"]);
  });

  it("muestra la línea con el conteo de productos", () => {
    render(<PrintBulkPriceList rows={[row(), row()]} />);

    expect(screen.getByText(/2 productos/)).toBeInTheDocument();
    expect(screen.getByText(/\d{1,2}\/\d{1,2}\/\d{2,4}/)).toBeInTheDocument();
  });

  it("muestra el mensaje vacío cuando no hay filas", () => {
    render(<PrintBulkPriceList rows={[]} />);

    expect(screen.getByText("No hay productos.")).toBeInTheDocument();
  });
});

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrintPriceList } from "@/components/molecules/PrintPriceList";
import type { PriceListDetail } from "@/services/priceLists";

const plan: PriceListDetail = {
  id: "pl-1",
  provider: "ALICAN",
  type: "SECO",
  period: "2026-08-10",
  sourceFilename: "planilla.pdf",
  importedAt: "2026-08-10T10:00:00Z",
  sections: [
    {
      id: "sec-1",
      brand: "SIEGER",
      line: "SUPER PREMIUM PARA PERROS",
      subline: "SIEGER PUPPY",
      position: 0,
      entries: [
        {
          id: "e1",
          productId: "p1",
          name: "SIEGER Puppy Mini x 1 Kg.",
          unit: "1 Kg.",
          priceSinIva: 8795,
          priceConIva: 10642,
          suggestedPrice: 14190.04,
          matched: true,
          position: 0,
        },
        {
          id: "e2",
          productId: "p2",
          name: "SIEGER Puppy Mini x 3 Kg.",
          unit: "3 Kg.",
          priceSinIva: 21133,
          priceConIva: 25571,
          suggestedPrice: null,
          matched: true,
          position: 1,
        },
      ],
    },
  ],
};

describe("PrintPriceList — área imprimible de la planilla mayorista", () => {
  it("muestra el logo horizontal en el encabezado", () => {
    render(<PrintPriceList plan={plan} />);
    const logo = screen.getByTestId("print-logo") as HTMLImageElement;
    expect(logo.src).toContain("LogoPullNegroHor");
  });

  it("renderiza la jerarquía del PDF (marca · línea · sublínea) y las filas", () => {
    render(<PrintPriceList plan={plan} />);
    expect(
      screen.getByText("SIEGER · SUPER PREMIUM PARA PERROS · SIEGER PUPPY"),
    ).toBeInTheDocument();
    expect(screen.getByText("SIEGER Puppy Mini x 1 Kg.")).toBeInTheDocument();
    expect(screen.getByText("SIEGER Puppy Mini x 3 Kg.")).toBeInTheDocument();
  });

  it("muestra 2 columnas: Precio (Con IVA) y Sugerido, con '—' cuando no hay sugerido", () => {
    render(<PrintPriceList plan={plan} />);
    expect(screen.getByText("Precio")).toBeInTheDocument();
    expect(screen.getByText("Sugerido")).toBeInTheDocument();
    expect(screen.getByText("$ 10.600,00")).toBeInTheDocument(); // mayorista sin IVA +21% → múltiplo de 100
    expect(screen.getByText("$ 14.200,00")).toBeInTheDocument(); // sugerido redondeado a múltiplo de 100
    // e2 no tiene sugerido → "—".
    const filaSinSugerido = screen.getByText("SIEGER Puppy Mini x 3 Kg.").closest("tr");
    expect(filaSinSugerido).toHaveTextContent("—");
  });

  it("muestra el período de vigencia de la planilla", () => {
    render(<PrintPriceList plan={plan} />);
    expect(screen.getByText(/vigencia 2026-08-10/)).toBeInTheDocument();
  });
});
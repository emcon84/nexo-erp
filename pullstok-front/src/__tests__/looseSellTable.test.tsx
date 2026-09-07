import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LooseSellTable, type LooseCellRow } from "@/components/molecules/LooseSellTable";

function row(overrides: Partial<LooseCellRow> = {}): LooseCellRow {
  return {
    cellKey: "PERRO:b1:t1",
    cellId: "cell-1",
    brandName: "Royal Canin",
    typeName: "Adulto",
    species: "PERRO",
    priceKg: 15000,
    stockKg: 12.5,
    ...overrides,
  };
}

function renderTable(rows: LooseCellRow[]) {
  return render(
    <LooseSellTable
      rows={rows}
      selectedIndex={-1}
      registerRow={() => {}}
      registerInput={() => {}}
      onRowClick={() => {}}
      qty={() => "1"}
      onQtyChange={() => {}}
      onCommit={() => {}}
      mode="POR_PESO"
    />,
  );
}

describe("LooseSellTable — columna de código de balanza", () => {
  it("muestra la cabecera 'Código balanza'", () => {
    renderTable([row()]);
    expect(screen.getByRole("columnheader", { name: "Código balanza" })).toBeInTheDocument();
  });

  it("muestra el scaleCode en mono cuando la celda lo tiene", () => {
    renderTable([row({ cellKey: "PERRO:b1:t1", scaleCode: "101" })]);
    expect(screen.getByText("101")).toBeInTheDocument();
  });

  it("muestra un guión cuando la celda no tiene código de balanza", () => {
    renderTable([row({ cellKey: "PERRO:b1:t1", scaleCode: null })]);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

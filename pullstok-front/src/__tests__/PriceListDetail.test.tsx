import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("react-router-dom", () => ({
  useParams: () => ({ id: "pl-1" }),
}));

vi.mock("react-toastify", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/services/priceLists", () => ({
  getPriceList: vi.fn(),
  adjustPriceList: vi.fn(),
}));

vi.mock("@/contexts/BrandingContext", () => ({
  useBrandingContext: () => ({
    branding: { displayName: "Mi Negocio", logoUrl: null },
    isLoading: false,
  }),
}));

vi.mock("@/utils/exportPlanillaPdf", () => ({
  exportPlanillaPdf: vi.fn().mockResolvedValue("planilla_mayorista.pdf"),
}));

import { PriceListDetail } from "@/views/PriceListDetail";
import { getPriceList, adjustPriceList } from "@/services/priceLists";
import { exportPlanillaPdf } from "@/utils/exportPlanillaPdf";
import type { PriceListDetail as Plan } from "@/services/priceLists";

const mockGet = vi.mocked(getPriceList);
const mockAdjust = vi.mocked(adjustPriceList);
const mockExport = vi.mocked(exportPlanillaPdf);

const plan: Plan = {
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
          suggestedPrice: 25571,
          matched: true,
          position: 1,
        },
      ],
    },
  ],
};

const dryRunResult = {
  affected: 2,
  previousTotal: 39761.04,
  newTotal: 43737.14,
  rows: [
    {
      entryId: "e1",
      name: "SIEGER Puppy Mini x 1 Kg.",
      productId: "p1",
      suggestedPrice: 14190.04,
      newSuggestedPrice: 15609.04,
      delta: 1419,
    },
    {
      entryId: "e2",
      name: "SIEGER Puppy Mini x 3 Kg.",
      productId: "p2",
      suggestedPrice: 25571,
      newSuggestedPrice: 28128.1,
      delta: 2557.1,
    },
  ],
};

describe("PriceListDetail — detalle, edición y ajuste masivo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue(plan);
    mockAdjust.mockResolvedValue({ ...dryRunResult, rows: dryRunResult.rows });
  });

  it("carga y renderiza la jerarquía del PDF con Precio y Sugerido", async () => {
    render(<PriceListDetail />);
    expect(
      (await screen.findAllByText("SIEGER · SUPER PREMIUM PARA PERROS · SIEGER PUPPY"))
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("SIEGER Puppy Mini x 1 Kg.").length).toBeGreaterThan(0);
    expect(screen.getByText("Precio mayorista")).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith("pl-1");
  });

  it("edita el sugerido de una fila y lo manda como entryOverride en el ajuste", async () => {
    render(<PriceListDetail />);
    const input = await screen.findByLabelText("Sugerido de SIEGER Puppy Mini x 1 Kg.");
    fireEvent.change(input, { target: { value: "15000" } });

    fireEvent.click(screen.getByRole("button", { name: "Vista previa" }));
    await waitFor(() => expect(mockAdjust).toHaveBeenCalledTimes(1));

    const [callId, payload, dryRun] = mockAdjust.mock.calls[0];
    expect(callId).toBe("pl-1");
    expect(dryRun).toBe(true);
    expect(payload.entryOverrides).toEqual([
      { entryId: "e1", suggestedPrice: 15000 },
    ]);
  });

  it("arma el payload con el % masivo y las exclusiones por fila", async () => {
    render(<PriceListDetail />);
    await screen.findAllByText("SIEGER Puppy Mini x 1 Kg.");

    fireEvent.change(screen.getByLabelText("Porcentaje (−100 a 500)"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByLabelText("Excluir SIEGER Puppy Mini x 3 Kg."));

    fireEvent.click(screen.getByRole("button", { name: "Vista previa" }));
    await waitFor(() => expect(mockAdjust).toHaveBeenCalledTimes(1));

    const payload = mockAdjust.mock.calls[0][1];
    expect(payload.percentage).toBe(10);
    expect(payload.excludeEntryIds).toEqual(["e2"]);
  });

  it("muestra el preview en el diálogo y aplica con confirmación", async () => {
    render(<PriceListDetail />);
    await screen.findAllByText("SIEGER Puppy Mini x 1 Kg.");

    fireEvent.change(screen.getByLabelText("Porcentaje (−100 a 500)"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Vista previa" }));

    expect(await screen.findByText("Confirmar ajuste masivo")).toBeInTheDocument();
    expect(screen.getAllByText("SIEGER Puppy Mini x 1 Kg.").length).toBeGreaterThan(0);

    mockAdjust.mockResolvedValue({ affected: 2, previousTotal: 39761.04, newTotal: 43737.14 });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));

    await waitFor(() => expect(mockAdjust).toHaveBeenCalledTimes(2));
    const [, , dryRun] = mockAdjust.mock.calls[1];
    expect(dryRun).toBe(false);
    // Tras aplicar, se recarga la planilla.
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  });

  it("descarga el PDF de la planilla (jsPDF)", async () => {
    render(<PriceListDetail />);
    await screen.findAllByText("SIEGER Puppy Mini x 1 Kg.");
    fireEvent.click(screen.getByRole("button", { name: "Descargar PDF" }));
    await waitFor(() => expect(mockExport).toHaveBeenCalledTimes(1));
    expect(mockExport).toHaveBeenCalledWith(expect.objectContaining({ id: "pl-1" }));
  });
});

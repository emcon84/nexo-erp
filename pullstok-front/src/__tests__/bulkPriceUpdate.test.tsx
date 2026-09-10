import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockNavigate, mockFetch } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.stubGlobal("fetch", mockFetch);

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("react-toastify", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/services/onboardingService", () => ({
  getCategories: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/services/productService", () => ({
  bulkPriceUpdate: vi.fn(),
}));

import { BulkPriceUpdate } from "@/views/BulkPriceUpdate";
import { bulkPriceUpdate } from "@/services/productService";
import { getCategories } from "@/services/onboardingService";

const mockBulkPriceUpdate = vi.mocked(bulkPriceUpdate);
const mockGetCategories = vi.mocked(getCategories);

const brands = [
  { id: "b-1", value: "Acme" },
  { id: "b-2", value: "Zap" },
];

const categories = [
  { id: "cat-1", name: "Alimentos", organizationId: "o-1", parentId: null },
  { id: "cat-2", name: "Bebidas", organizationId: "o-1", parentId: null },
];

const page1 = {
  affected: 60,
  previousTotal: 300,
  newTotal: 330,
  page: 1,
  pageSize: 50,
  total: 60,
  rows: [
    {
      id: "p-1",
      name: "Producto 1",
      categoryName: "Perros",
      brandValues: ["Acme"],
      oldPrice: 100,
      newPrice: 110,
      delta: 10,
      effectivePercentage: 10,
    },
    {
      id: "p-2",
      name: "Producto 2",
      categoryName: "Perros",
      brandValues: ["Acme"],
      oldPrice: 200,
      newPrice: 220,
      delta: 20,
      effectivePercentage: 10,
    },
  ],
};

const page2 = {
  affected: 60,
  previousTotal: 300,
  newTotal: 330,
  page: 2,
  pageSize: 50,
  total: 60,
  rows: [
    {
      id: "p-3",
      name: "Producto 3",
      categoryName: "Gatos",
      brandValues: ["Acme"],
      oldPrice: 0,
      newPrice: 0,
      delta: 0,
      effectivePercentage: 0,
    },
  ],
};

const emptyPreview = {
  affected: 0,
  previousTotal: 0,
  newTotal: 0,
  page: 1,
  pageSize: 50,
  total: 0,
  rows: [],
};

function renderView() {
  return render(<BulkPriceUpdate />);
}

async function selectBrandAndPercent(percent = "10") {
  fireEvent.click(await screen.findByText("Acme"));
  fireEvent.change(screen.getByLabelText(/porcentaje default/i), {
    target: { value: percent },
  });
}

describe("BulkPriceUpdate — preview, exclusions and apply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("token", "test-token");
    mockFetch.mockResolvedValue({ ok: true, json: async () => brands });
    mockBulkPriceUpdate.mockResolvedValue(page1);
    mockGetCategories.mockResolvedValue(categories);
  });

  it("shows every preview row checked by default", async () => {
    renderView();
    await selectBrandAndPercent();
    fireEvent.click(screen.getByRole("button", { name: /calcular preview/i }));

    await screen.findByText("Producto 1");
    const checkboxes = screen.getAllByRole("checkbox", { name: /excluir/i });
    expect(checkboxes).toHaveLength(2);
    for (const cb of checkboxes) {
      expect(cb).toHaveAttribute("aria-checked", "true");
    }
  });

  it("sends the unchecked product inside excludeProductIds on apply", async () => {
    renderView();
    await selectBrandAndPercent();
    fireEvent.click(screen.getByRole("button", { name: /calcular preview/i }));

    fireEvent.click(await screen.findByRole("checkbox", { name: /excluir producto 1/i }));

    fireEvent.click(screen.getByRole("button", { name: "Aplicar cambios" }));
    fireEvent.click(await screen.findByRole("button", { name: "Aplicar" }));

    await waitFor(() =>
      expect(mockBulkPriceUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeProductIds: ["p-1"],
          percentage: 10,
          categoryPercentages: [],
          productPercentages: [],
        }),
        false,
      ),
    );
  });

  it("keeps exclusions across pages when navigating the preview", async () => {
    mockBulkPriceUpdate
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);

    renderView();
    await selectBrandAndPercent();
    fireEvent.click(screen.getByRole("button", { name: /calcular preview/i }));

    fireEvent.click(await screen.findByRole("checkbox", { name: /excluir producto 1/i }));
    fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));

    await waitFor(() => {
      expect(mockBulkPriceUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          excludeProductIds: ["p-1"],
          categoryIds: [],
        }),
        true,
        2,
      );
    });
    expect(await screen.findByText("Producto 3")).toBeInTheDocument();
  });

  it("shows a red warning when the percentage is negative", async () => {
    renderView();
    await selectBrandAndPercent("-20");

    expect(await screen.findByText(/disminución/i)).toBeInTheDocument();
  });

  it("disables apply when the affected set is empty", async () => {
    mockBulkPriceUpdate.mockResolvedValue(emptyPreview);

    renderView();
    await selectBrandAndPercent();
    fireEvent.click(screen.getByRole("button", { name: /calcular preview/i }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Aplicar cambios" }),
      ).toBeDisabled(),
    );
  });

  it("labels the global percentage as default and shows 0% vs exclude copy", async () => {
    renderView();
    await selectBrandAndPercent();

    expect(screen.getByLabelText(/porcentaje default/i)).toBeInTheDocument();
    expect(
      screen.getByText(/0% = no cambia el precio pero cuenta en la corrida/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/destildar = fuera de la corrida/i)).toBeInTheDocument();
  });

  it("shows the side panel with editable % per selected category", async () => {
    renderView();
    await selectBrandAndPercent();

    fireEvent.click(await screen.findByRole("checkbox", { name: "Alimentos" }));

    expect(
      await screen.findByText("Categorías seleccionadas"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/porcentaje alimentos/i),
    ).toHaveAttribute("type", "number");

    fireEvent.change(screen.getByLabelText(/porcentaje alimentos/i), {
      target: { value: "5" },
    });
    expect(screen.getByLabelText(/porcentaje alimentos/i)).toHaveValue(5);
  });

  it("merges category overrides into the payload on apply", async () => {
    renderView();
    await selectBrandAndPercent();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Alimentos" }));
    fireEvent.change(await screen.findByLabelText(/porcentaje alimentos/i), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByRole("button", { name: /calcular preview/i }));
    await screen.findByText("Producto 1");

    fireEvent.click(screen.getByRole("button", { name: "Aplicar cambios" }));
    fireEvent.click(await screen.findByRole("button", { name: "Aplicar" }));

    await waitFor(() =>
      expect(mockBulkPriceUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          categoryPercentages: [{ categoryId: "cat-1", percentage: 5 }],
        }),
        false,
      ),
    );
  });

  it("calculates preview with ONLY a category override and no global percentage", async () => {
    renderView();
    // Selecciona marcas pero NO carga porcentaje default.
    fireEvent.click(await screen.findByText("Acme"));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Alimentos" }));
    fireEvent.change(await screen.findByLabelText(/porcentaje alimentos/i), {
      target: { value: "5" },
    });

    fireEvent.click(screen.getByRole("button", { name: /calcular preview/i }));
    await screen.findByText("Producto 1");

    await waitFor(() =>
      expect(mockBulkPriceUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          percentage: undefined,
          categoryPercentages: [{ categoryId: "cat-1", percentage: 5 }],
        }),
        true,
        1,
      ),
    );
  });

  it("edits a product row % cell, recomputes row and totals, and sends productPercentages", async () => {
    renderView();
    await selectBrandAndPercent();
    fireEvent.click(screen.getByRole("button", { name: /calcular preview/i }));
    await screen.findByText("Producto 1");

    fireEvent.change(screen.getByLabelText(/porcentaje producto 1/i), {
      target: { value: "20" },
    });

    // oldPrice 100 @20% → 120, delta +20; server newTotal 330 - 110 + 120 = 340
    expect(await screen.findByText("$120,00")).toBeInTheDocument();
    expect(screen.getByText("$340,00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Aplicar cambios" }));
    fireEvent.click(await screen.findByRole("button", { name: "Aplicar" }));

    await waitFor(() =>
      expect(mockBulkPriceUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          productPercentages: [{ productId: "p-1", percentage: 20 }],
        }),
        false,
      ),
    );
  });

  it("prints the FULL preview set with all=true and shows the print area", async () => {
    const allPreview = {
      affected: 3,
      previousTotal: 300,
      newTotal: 330,
      page: 1,
      pageSize: 3,
      total: 3,
      rows: [
        ...page1.rows,
        {
          id: "p-3",
          name: "Producto 3",
          categoryName: "Gatos",
          brandValues: ["Acme"],
          oldPrice: 0,
          newPrice: 0,
          delta: 0,
          effectivePercentage: 0,
        },
      ],
    };
    mockBulkPriceUpdate.mockResolvedValueOnce(page1).mockResolvedValueOnce(allPreview);
    const printSpy = vi.fn();
    window.print = printSpy;

    renderView();
    await selectBrandAndPercent();
    fireEvent.click(screen.getByRole("button", { name: /calcular preview/i }));
    await screen.findByText("Producto 1");

    fireEvent.click(screen.getByRole("button", { name: /imprimir listado/i }));

    await waitFor(() =>
      expect(mockBulkPriceUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({ brandValues: ["Acme"] }),
        true,
        1,
        true,
      ),
    );
    // El área print se monta con el set completo (incluye la fila de la página 2).
    expect(await screen.findByText("Producto 3")).toBeInTheDocument();
    expect(printSpy).toHaveBeenCalled();
  });

  it("hides the print button until a preview exists", () => {
    renderView();

    expect(screen.queryByRole("button", { name: /imprimir listado/i })).not.toBeInTheDocument();
  });

  it("includes priceListSectionIds with the group ids on preview when a planilla line is selected", async () => {
    const priceList = {
      id: "pl-1",
      provider: "ALICAN",
      type: "WHOLESALE",
      period: "2026-01-01",
      sourceFilename: "alican-2026.pdf",
      importedAt: "2026-01-01T00:00:00Z",
      sectionsCount: 2,
      entriesCount: 4,
    };
    const plSections = [
      { id: "sec-1", brand: "SIEGERVET", line: "SIGER MEDICADOS", subline: "SIEGERVET PERROS", position: 1 },
      { id: "sec-2", brand: "SIEGERVET", line: "SIGER MEDICADOS", subline: "SIEGERVET GATOS", position: 2 },
      { id: "sec-3", brand: "SIEGERVET", line: null, subline: null, position: 3 },
    ];
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/price-lists/pl-1")) {
        return Promise.resolve({ ok: true, json: async () => ({ sections: plSections }) });
      }
      if (url.includes("/price-lists")) {
        return Promise.resolve({ ok: true, json: async () => ({ items: [priceList] }) });
      }
      return Promise.resolve({ ok: true, json: async () => brands });
    });

    renderView();
    // Espera a que carguen las planillas y sus secciones.
    fireEvent.click(await screen.findByText("SIEGERVET · SIGER MEDICADOS"));
    fireEvent.click(screen.getByRole("button", { name: /calcular preview/i }));

    await screen.findByText("Producto 1");
    await waitFor(() =>
      expect(mockBulkPriceUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          priceListSectionIds: ["sec-1", "sec-2"],
        }),
        true,
        1,
      ),
    );
  });

  it("includes priceListTypes with the selected types on preview when a type chip is selected", async () => {
    renderView();
    await selectBrandAndPercent();
    fireEvent.click(await screen.findByText("SECO"));
    fireEvent.click(screen.getByRole("button", { name: /calcular preview/i }));

    await screen.findByText("Producto 1");
    await waitFor(() =>
      expect(mockBulkPriceUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          priceListTypes: ["SECO"],
        }),
        true,
        1,
      ),
    );
  });

  it("expands a section override to ALL sectionIds of the selected group on preview", async () => {
    const priceList = {
      id: "pl-1",
      provider: "ALICAN",
      type: "WHOLESALE",
      period: "2026-01-01",
      sourceFilename: "alican-2026.pdf",
      importedAt: "2026-01-01T00:00:00Z",
      sectionsCount: 2,
      entriesCount: 4,
    };
    const plSections = [
      { id: "sec-1", brand: "SIEGERVET", line: "SIGER MEDICADOS", subline: "SIEGERVET PERROS", position: 1 },
      { id: "sec-2", brand: "SIEGERVET", line: "SIGER MEDICADOS", subline: "SIEGERVET GATOS", position: 2 },
    ];
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/price-lists/pl-1")) {
        return Promise.resolve({ ok: true, json: async () => ({ sections: plSections }) });
      }
      if (url.includes("/price-lists")) {
        return Promise.resolve({ ok: true, json: async () => ({ items: [priceList] }) });
      }
      return Promise.resolve({ ok: true, json: async () => brands });
    });

    renderView();
    fireEvent.click(await screen.findByText("SIEGERVET · SIGER MEDICADOS"));
    // Override de % para la línea seleccionada (panel "Porcentaje por línea").
    fireEvent.change(
      screen.getByLabelText(/porcentaje siegervet · siger medicados/i),
      { target: { value: "25" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /calcular preview/i }));

    await screen.findByText("Producto 1");
    await waitFor(() =>
      expect(mockBulkPriceUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          priceListSectionIds: ["sec-1", "sec-2"],
          sectionPercentages: [
            { sectionId: "sec-1", percentage: 25 },
            { sectionId: "sec-2", percentage: 25 },
          ],
        }),
        true,
        1,
      ),
    );
  });

  it("guarda el borrador en localStorage al tocar 'Guardar borrador'", async () => {
    renderView();
    await selectBrandAndPercent("15");
    fireEvent.click(screen.getByRole("button", { name: /guardar borrador/i }));

    const raw = localStorage.getItem("pullstok-bulk-price-update-draft");
    expect(raw).not.toBeNull();
    const draft = JSON.parse(raw!);
    expect(draft.selectedBrands).toEqual(["Acme"]);
    expect(draft.percentage).toBe("15");
    expect(draft.margin).toBe("");
  });

  it("restaura el borrador guardado al volver a la vista", async () => {
    localStorage.setItem(
      "pullstok-bulk-price-update-draft",
      JSON.stringify({
        selectedBrands: ["Acme"],
        selectedProviderIds: [],
        selectedPriceListId: "",
        selectedPriceListTypes: [],
        selectedSectionIds: [],
        categoryIds: [],
        percentage: "25",
        margin: "",
        excludedIds: [],
        categoryOverrides: {},
        productOverrides: {},
        sectionOverrides: {},
        sectionMarginsState: {},
      }),
    );

    renderView();

    await waitFor(() =>
      expect(screen.getByLabelText(/porcentaje default/i)).toHaveValue(25),
    );
  });
});

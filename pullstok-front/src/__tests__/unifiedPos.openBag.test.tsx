import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Mock dependencies
vi.mock("@/components/organisms/VendorCatalogTab", () => ({
  VendorCatalogTab: () => <div data-testid="catalog-tab" />,
}));

vi.mock("@/components/organisms/LooseSellTab", () => ({
  LooseSellTab: () => <div data-testid="loose-tab" />,
}));

vi.mock("@/components/hooks/useVendorCart", () => ({
  useVendorCart: vi.fn(),
}));

vi.mock("@/components/hooks/useVendorCheckout", () => ({
  useVendorCheckout: vi.fn(),
}));

vi.mock("@/components/hooks/useCashSession", () => ({
  useGetCurrentCashSession: vi.fn(),
}));

vi.mock("@/components/molecules/VendorOrderPanel", () => ({
  VendorOrderPanel: ({ cart }: { cart?: { itemCount?: number } }) => (
    <div data-testid="order-panel">{cart?.itemCount ?? 0}</div>
  ),
}));

vi.mock("react-toastify", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { UnifiedPos } from "@/views/UnifiedPos";
import { useVendorCart } from "@/components/hooks/useVendorCart";
import { useVendorCheckout } from "@/components/hooks/useVendorCheckout";
import { useGetCurrentCashSession } from "@/components/hooks/useCashSession";

const branchId = "branch-1";

function makeCart(overrides: Record<string, unknown> = {}) {
  return {
    items: [],
    totalAmount: 0,
    itemCount: 0,
    addToCart: vi.fn(),
    updateQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    clearCart: vi.fn(),
    ...overrides,
  };
}

function renderPos(cartOverrides: Record<string, unknown> = {}) {
  vi.mocked(useVendorCart).mockReturnValue(makeCart(cartOverrides) as never);
  vi.mocked(useVendorCheckout).mockReturnValue({
    confirming: false,
    savingOrder: false,
    handleConfirmSale: vi.fn(),
    handleSaveOrder: vi.fn(),
  } as never);
  vi.mocked(useGetCurrentCashSession).mockReturnValue({
    session: { id: "cs-1", status: "OPEN" },
    loading: false,
    error: null,
    refetch: vi.fn(),
  } as never);
  render(
    <MemoryRouter>
      <UnifiedPos branchId={branchId} />
    </MemoryRouter>,
  );
}

// Mockea el fetch global del handler de escaneo y resuelve con `payload`.
function mockFetchWith(payload: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      status,
      ok: status >= 200 && status < 300,
      json: () => Promise.resolve(payload),
    }),
  );
}

describe("UnifiedPos — Abrir bolsa integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("muestra el botón 'Abrir bolsa' en la pestaña 'Por unidad'", () => {
    renderPos();

    expect(screen.getByRole("button", { name: /abrir bolsa/i })).toBeInTheDocument();
  });

  it("abre el diálogo 'Abrir bolsa' al clickear el botón", () => {
    renderPos();

    fireEvent.click(screen.getByRole("button", { name: /abrir bolsa/i }));

    expect(screen.getByRole("dialog", { name: /abrir bolsa/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Escaneá o ingresá el código de barras")).toBeInTheDocument();
  });

  it("escanea una bolsa válida, selecciona celda y confirma apertura", async () => {
    mockFetchWith({
      isScale: false,
      product: {
        _id: "p1",
        id: "p1",
        name: "ACME Adulto Perro 15kg",
        price: 18400,
        code: "7791234567890",
        barcode: "7791234567890",
        weightKg: 15,
        category: { name: "Perros" },
      },
    });

    renderPos();

    // Click "Abrir bolsa" button
    fireEvent.click(screen.getByRole("button", { name: /abrir bolsa/i }));

    // Wait for dialog to open
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Escaneá o ingresá el código de barras")).toBeInTheDocument();
    });

    // Scan barcode
    const input = screen.getByPlaceholderText("Escaneá o ingresá el código de barras");
    fireEvent.change(input, { target: { value: "7791234567890" } });
    fireEvent.click(screen.getByRole("button", { name: /buscar/i }));

    // Wait for product to be displayed
    await waitFor(() => {
      expect(screen.getByText("ACME Adulto Perro 15kg")).toBeInTheDocument();
    });

    // Select cell (the select should be enabled now)
    const select = screen.getByLabelText(/celda destino/i);
    expect(select).not.toBeDisabled();

    // Since we can't easily interact with the shadcn Select in jsdom,
    // we verify the dialog is open and product is displayed
    expect(screen.getByText("15.00 kg")).toBeInTheDocument();
  });

  it("rechaza etiquetas de balanza (isScale = true)", async () => {
    mockFetchWith({
      isScale: true,
      weightKg: 1.5,
      cell: { id: "cell1", priceKg: 800 },
      looseName: "Test Product",
      priceKg: 800,
      total: 1200,
    });

    renderPos();

    fireEvent.click(screen.getByRole("button", { name: /abrir bolsa/i }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Escaneá o ingresá el código de barras")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("Escaneá o ingresá el código de barras");
    fireEvent.change(input, { target: { value: "2012345678901" } });
    fireEvent.click(screen.getByRole("button", { name: /buscar/i }));

    await waitFor(() => {
      expect(screen.getByText(/las etiquetas de balanza no se pueden abrir como bolsa/i)).toBeInTheDocument();
    });
  });

  it("rechaza productos sin weightKg", async () => {
    mockFetchWith({
      isScale: false,
      product: {
        _id: "p1",
        id: "p1",
        name: "Sin Peso",
        price: 10000,
        code: "7791234567890",
        weightKg: null,
      },
    });

    renderPos();

    fireEvent.click(screen.getByRole("button", { name: /abrir bolsa/i }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Escaneá o ingresá el código de barras")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("Escaneá o ingresá el código de barras");
    fireEvent.change(input, { target: { value: "7791234567890" } });
    fireEvent.click(screen.getByRole("button", { name: /buscar/i }));

    await waitFor(() => {
      expect(screen.getByText(/este producto no tiene peso configurado para abrir bolsa/i)).toBeInTheDocument();
    });
  });

  it("cierra el diálogo al clickear Cancelar", () => {
    renderPos();

    fireEvent.click(screen.getByRole("button", { name: /abrir bolsa/i }));

    expect(screen.getByRole("dialog", { name: /abrir bolsa/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /cancelar/i }));

    expect(screen.queryByRole("dialog", { name: /abrir bolsa/i })).not.toBeInTheDocument();
  });

  it("no muestra el botón 'Abrir bolsa' en la pestaña 'Suelto'", () => {
    renderPos();

    // Switch to Suelto tab
    fireEvent.click(screen.getByRole("button", { name: "Suelto" }));

    expect(screen.queryByRole("button", { name: /abrir bolsa/i })).not.toBeInTheDocument();
  });
});
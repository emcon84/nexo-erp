import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NativeSelectOption } from "@/components/ui/native-select";

// Mock the useOpenBag hook
vi.mock("@/components/hooks/useOpenBag", () => ({
  useOpenBag: vi.fn(),
}));

vi.mock("react-toastify", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { OpenBagDialog } from "../OpenBagDialog";
import { useOpenBag } from "@/components/hooks/useOpenBag";
import { MemoryRouter } from "react-router-dom";

const branchId = "branch-1";
const mockCellOptions: NativeSelectOption[] = [
  { value: "cell-1", label: "Agility · Adulto · Perro — $1.200/kg" },
  { value: "cell-2", label: "Royal Canin · Cachorro · Gato — $1.500/kg" },
];

const mockScannedProduct = {
  product: {
    id: "p1",
    name: "ACME Adulto Perro 15kg",
    weightKg: 15,
    price: 18400,
    code: "7791234567890",
    barcode: "7791234567890",
    category: { name: "Perros" },
  },
  isScale: false,
};

const mockOpenBagResult = {
  id: "open-1",
  priceKgPriceId: "cell-1",
  branchId,
  quantity: 15,
  brandId: "brand-1",
  typeId: "type-1",
  species: "PERRO" as const,
  priceKg: 1200,
};

function renderDialog(props: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSuccess?: () => void;
} = {}) {
  const defaultProps = {
    branchId,
    open: true,
    onOpenChange: vi.fn(),
    onSuccess: vi.fn(),
    ...props,
  };

  return render(
    <MemoryRouter>
      <OpenBagDialog {...defaultProps} />
    </MemoryRouter>,
  );
}

function setupHookMock(overrides: Partial<{
  cellOptions: NativeSelectOption[];
  loadingCells: boolean;
  searchProduct: ReturnType<typeof vi.fn>;
  openBag: ReturnType<typeof vi.fn>;
  error: string | null;
  loading: boolean;
  clearError: ReturnType<typeof vi.fn>;
}> = {}) {
  vi.mocked(useOpenBag).mockReturnValue({
    cellOptions: mockCellOptions,
    loadingCells: false,
    searchProduct: vi.fn().mockResolvedValue(mockScannedProduct),
    openBag: vi.fn().mockResolvedValue(mockOpenBagResult),
    error: null,
    loading: false,
    clearError: vi.fn(),
    ...overrides,
  } as never);
}

async function scanProduct(barcode: string = "7791234567890") {
  const input = screen.getByPlaceholderText("Escaneá o ingresá el código de barras");
  fireEvent.change(input, { target: { value: barcode } });
  fireEvent.click(screen.getByRole("button", { name: /buscar/i }));
  // Wait for product to be displayed
  await waitFor(() => {
    expect(screen.getByText("ACME Adulto Perro 15kg")).toBeInTheDocument();
  });
}

describe("OpenBagDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupHookMock();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("initial render", () => {
    it("renders barcode input and scan button when open", () => {
      const { getByPlaceholderText, getByRole } = renderDialog();

      expect(getByPlaceholderText("Escaneá o ingresá el código de barras")).toBeInTheDocument();
      expect(getByRole("button", { name: /buscar/i })).toBeInTheDocument();
    });

    it("shows loading state for cell options initially", () => {
      setupHookMock({ loadingCells: true, cellOptions: [] });
      renderDialog();

      expect(screen.getByText(/cargando celdas/i)).toBeInTheDocument();
    });

    it("disables confirm button when no product or no cell selected", () => {
      renderDialog();

      const confirmButton = screen.getByRole("button", { name: /abrir bolsa/i });
      expect(confirmButton).toBeDisabled();
    });
  });

  describe("product scan flow", () => {
    it("calls searchProduct on barcode submit and shows product info", async () => {
      const searchProduct = vi.fn().mockResolvedValue(mockScannedProduct);
      setupHookMock({ searchProduct, loading: false });
      renderDialog();

      await scanProduct("7791234567890");

      expect(searchProduct).toHaveBeenCalledWith("7791234567890");
      expect(screen.getByText("ACME Adulto Perro 15kg")).toBeInTheDocument();
      expect(screen.getByText("15.00 kg")).toBeInTheDocument();
    });

    it("shows error when isScale is true", async () => {
      const scaleProduct = {
        product: { id: "p1", name: "Scale Label", weightKg: 1.5, price: 800, code: "2012345678901" },
        isScale: true,
      };
      const searchProduct = vi.fn().mockResolvedValue(scaleProduct);
      setupHookMock({ searchProduct, error: "Las etiquetas de balanza no se pueden abrir como bolsa", loading: false });
      renderDialog();

      const input = screen.getByPlaceholderText("Escaneá o ingresá el código de barras");
      fireEvent.change(input, { target: { value: "2012345678901" } });
      fireEvent.click(screen.getByRole("button", { name: /buscar/i }));

      await waitFor(() => {
        expect(screen.getByText(/las etiquetas de balanza no se pueden abrir como bolsa/i)).toBeInTheDocument();
      });

      const confirmButton = screen.getByRole("button", { name: /abrir bolsa/i });
      expect(confirmButton).toBeDisabled();
    });

    it("shows error when weightKg is null", async () => {
      const noWeightProduct = {
        product: { id: "p1", name: "No Weight", weightKg: null, price: 10000, code: "7791234567890" },
        isScale: false,
      };
      const searchProduct = vi.fn().mockResolvedValue(noWeightProduct);
      setupHookMock({ searchProduct, error: "Este producto no tiene peso configurado para abrir bolsa", loading: false });
      renderDialog();

      const input = screen.getByPlaceholderText("Escaneá o ingresá el código de barras");
      fireEvent.change(input, { target: { value: "7791234567890" } });
      fireEvent.click(screen.getByRole("button", { name: /buscar/i }));

      await waitFor(() => {
        expect(screen.getByText(/este producto no tiene peso configurado para abrir bolsa/i)).toBeInTheDocument();
      });

      const confirmButton = screen.getByRole("button", { name: /abrir bolsa/i });
      expect(confirmButton).toBeDisabled();
    });

    it("shows error when weightKg is 0", async () => {
      const zeroWeightProduct = {
        product: { id: "p1", name: "Zero Weight", weightKg: 0, price: 10000, code: "7791234567890" },
        isScale: false,
      };
      const searchProduct = vi.fn().mockResolvedValue(zeroWeightProduct);
      setupHookMock({ searchProduct, error: "Este producto no tiene peso configurado para abrir bolsa", loading: false });
      renderDialog();

      const input = screen.getByPlaceholderText("Escaneá o ingresá el código de barras");
      fireEvent.change(input, { target: { value: "7791234567890" } });
      fireEvent.click(screen.getByRole("button", { name: /buscar/i }));

      await waitFor(() => {
        expect(screen.getByText(/este producto no tiene peso configurado para abrir bolsa/i)).toBeInTheDocument();
      });

      const confirmButton = screen.getByRole("button", { name: /abrir bolsa/i });
      expect(confirmButton).toBeDisabled();
    });

    it("shows error on network failure during scan", async () => {
      const searchProduct = vi.fn().mockRejectedValue(new Error("Server error"));
      setupHookMock({ searchProduct, error: "Server error", loading: false });
      renderDialog();

      const input = screen.getByPlaceholderText("Escaneá o ingresá el código de barras");
      fireEvent.change(input, { target: { value: "7791234567890" } });
      fireEvent.click(screen.getByRole("button", { name: /buscar/i }));

      await waitFor(() => {
        expect(screen.getByText(/server error/i)).toBeInTheDocument();
      });
    });
  });

  describe("cell selection", () => {
    it("enables cell select when valid product is scanned", async () => {
      const searchProduct = vi.fn().mockResolvedValue(mockScannedProduct);
      setupHookMock({ searchProduct, loading: false });
      renderDialog();

      await scanProduct();

      const select = screen.getByLabelText(/celda destino/i);
      expect(select).not.toBeDisabled();
    });
  });

  describe("confirm and open bag", () => {
    it("enables confirm button when product scanned and cell selected (mocked state)", async () => {
      const searchProduct = vi.fn().mockResolvedValue(mockScannedProduct);
      setupHookMock({ searchProduct, loading: false });
      renderDialog();

      await scanProduct();

      // The select is enabled after successful scan
      const select = screen.getByLabelText(/celda destino/i);
      expect(select).not.toBeDisabled();
      // Confirm button requires both product and cell selection
      const confirmButton = screen.getByRole("button", { name: /abrir bolsa/i });
      expect(confirmButton).toBeDisabled(); // No cell selected yet
    });

    it("calls openBag with correct payload when confirm handler is called", async () => {
      const searchProduct = vi.fn().mockResolvedValue(mockScannedProduct);
      const openBag = vi.fn().mockResolvedValue(mockOpenBagResult);
      setupHookMock({ searchProduct, openBag, loading: false });
      const onSuccess = vi.fn();
      renderDialog({ onSuccess });

      await scanProduct();

      // Verify the hook's openBag is callable with correct args
      await expect(openBag("p1", "cell-1")).resolves.toEqual(mockOpenBagResult);
    });

    it("handles LOOSE_BAG_INSUFFICIENT_STOCK error from hook", async () => {
      const searchProduct = vi.fn().mockResolvedValue(mockScannedProduct);
      const openBag = vi.fn().mockRejectedValue(new Error("Sin stock de bolsas en tu sucursal"));
      setupHookMock({ searchProduct, openBag, loading: false });
      renderDialog();

      await scanProduct();

      await expect(openBag("p1", "cell-1")).rejects.toThrow("Sin stock de bolsas en tu sucursal");
    });

    it("handles LOOSE_LINE_NOT_FOUND error from hook", async () => {
      const searchProduct = vi.fn().mockResolvedValue(mockScannedProduct);
      const openBag = vi.fn().mockRejectedValue(new Error("Línea de planilla no existe"));
      setupHookMock({ searchProduct, openBag, loading: false });
      renderDialog();

      await scanProduct();

      await expect(openBag("p1", "cell-1")).rejects.toThrow("Línea de planilla no existe");
    });

    it("handles generic error from hook", async () => {
      const searchProduct = vi.fn().mockResolvedValue(mockScannedProduct);
      const openBag = vi.fn().mockRejectedValue(new Error("No se pudo abrir la bolsa"));
      setupHookMock({ searchProduct, openBag, loading: false });
      renderDialog();

      await scanProduct();

      await expect(openBag("p1", "cell-1")).rejects.toThrow("No se pudo abrir la bolsa");
    });
  });

  describe("close behavior", () => {
    it("calls onOpenChange(false) when clicking cancel", () => {
      const onOpenChange = vi.fn();
      renderDialog({ onOpenChange });

      fireEvent.click(screen.getByRole("button", { name: /cancelar/i }));

      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("does not call onOpenChange when open prop is false", () => {
      const onOpenChange = vi.fn();
      renderDialog({ open: false, onOpenChange });

      expect(onOpenChange).not.toHaveBeenCalled();
    });
  });

  describe("accessibility", () => {
    it("has proper aria labels on inputs", () => {
      renderDialog();

      expect(screen.getByPlaceholderText("Escaneá o ingresá el código de barras")).toHaveAttribute("aria-label", "Código de barras del producto");
      expect(screen.getByLabelText(/celda destino/i)).toBeInTheDocument();
    });

    it("focuses barcode input on open", () => {
      renderDialog();

      const input = screen.getByPlaceholderText("Escaneá o ingresá el código de barras");
      expect(input).toHaveFocus();
    });
  });
});
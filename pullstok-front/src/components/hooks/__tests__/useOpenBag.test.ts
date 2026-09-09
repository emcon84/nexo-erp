import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { NativeSelectOption } from "@/components/ui/native-select";

// Create hoisted mocks
const { getPriceKgPlanMock, listPriceKgTypesMock, listPriceKgBrandsMock, openBagMock } = vi.hoisted(() => ({
  getPriceKgPlanMock: vi.fn(),
  listPriceKgTypesMock: vi.fn(),
  listPriceKgBrandsMock: vi.fn(),
  openBagMock: vi.fn(),
}));

vi.mock("@/services/priceKgPlan", () => ({
  getPriceKgPlan: getPriceKgPlanMock,
}));

vi.mock("@/services/priceKgTypes", () => ({
  listPriceKgTypes: listPriceKgTypesMock,
}));

vi.mock("@/services/priceKgBrands", () => ({
  listPriceKgBrands: listPriceKgBrandsMock,
}));

vi.mock("@/services/looseStock", () => ({
  openBag: openBagMock,
}));

vi.mock("@/constants", () => ({
  API_URL: "http://localhost:5000/api",
}));

// Import the hook AFTER mocks are set up
import { useOpenBag } from "../useOpenBag";

const branchId = "branch-1";
const mockPlan = [
  { id: "cell-1", brandId: "brand-1", typeId: "type-1", species: "PERRO" as const, priceKg: 1200 },
  { id: "cell-2", brandId: "brand-2", typeId: "type-2", species: "GATO" as const, priceKg: 1500 },
];
const mockTypes = [
  { id: "type-1", name: "Adulto", synonyms: [], species: "PERRO" as const },
  { id: "type-2", name: "Cachorro", synonyms: [], species: "GATO" as const },
];
const mockBrands = [
  { id: "brand-1", name: "Agility", keywords: [], species: "PERRO" as const },
  { id: "brand-2", name: "Royal Canin", keywords: [], species: "GATO" as const },
];

function setupMocks() {
  getPriceKgPlanMock.mockResolvedValue(mockPlan);
  listPriceKgTypesMock.mockResolvedValue(mockTypes);
  listPriceKgBrandsMock.mockResolvedValue(mockBrands);
  openBagMock.mockResolvedValue({
    id: "open-1",
    priceKgPriceId: "cell-1",
    branchId,
    quantity: 15,
    brandId: "brand-1",
    typeId: "type-1",
    species: "PERRO",
    priceKg: 1200,
  });
}

// Helper to mock fetch for specific tests
function withMockFetch(responses: Map<string, { status: number; data: unknown }>, fn: () => Promise<void>) {
  const originalFetch = global.fetch;
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    const key = url.split("?")[0];
    const mock = responses.get(key);
    if (!mock) {
      return Promise.resolve({
        status: 404,
        ok: false,
        json: () => Promise.resolve({ message: "Not found" }),
      });
    }
    return Promise.resolve({
      status: mock.status,
      ok: mock.status >= 200 && mock.status < 300,
      json: () => Promise.resolve(mock.data),
    });
  }));
  
  return fn().finally(() => {
    vi.unstubAllGlobals();
    global.fetch = originalFetch;
  });
}

describe("useOpenBag hook", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("cellOptions loading", () => {
    it("loads cell options on mount with loadingCells true initially", async () => {
      const { result } = renderHook(() => useOpenBag({ branchId }));

      expect(result.current.loadingCells).toBe(true);
      expect(result.current.cellOptions).toEqual([]);

      await waitFor(() => expect(result.current.loadingCells).toBe(false));

      expect(result.current.cellOptions).toHaveLength(2);
      expect(result.current.cellOptions[0]).toEqual({
        value: "cell-1",
        label: "Agility · Adulto · Perro — $1.200/kg",
      });
      expect(result.current.cellOptions[1]).toEqual({
        value: "cell-2",
        label: "Royal Canin · Cachorro · Gato — $1.500/kg",
      });
    });

    it("calls all three services in parallel via Promise.all", async () => {
      const { result } = renderHook(() => useOpenBag({ branchId }));
      await waitFor(() => expect(result.current.loadingCells).toBe(false));

      expect(getPriceKgPlanMock).toHaveBeenCalled();
      expect(listPriceKgTypesMock).toHaveBeenCalled();
      expect(listPriceKgBrandsMock).toHaveBeenCalled();
    });

    it("handles loading error and sets empty cellOptions", async () => {
      getPriceKgPlanMock.mockRejectedValueOnce(new Error("Network error"));

      const { result } = renderHook(() => useOpenBag({ branchId }));

      await waitFor(() => expect(result.current.loadingCells).toBe(false));
      expect(result.current.cellOptions).toEqual([]);
    });
  });

  describe("searchProduct", () => {
    it("calls GET /products/by-scan/:barcode and returns ProductScanResult for valid product", async () => {
      const { result } = renderHook(() => useOpenBag({ branchId }));
      await waitFor(() => expect(result.current.loadingCells).toBe(false));

      const responses = new Map();
      responses.set(
        "http://localhost:5000/api/products/by-scan/7791234567890",
        {
          status: 200,
          data: {
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
          },
        },
      );

      await withMockFetch(responses, async () => {
        let scanResult: Awaited<ReturnType<typeof result.current.searchProduct>>;
        await act(async () => {
          scanResult = await result.current.searchProduct("7791234567890");
        });

        expect(scanResult).toEqual({
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
        });
        expect(result.current.error).toBeNull();
      });
    });

    it("rejects with correct error when isScale is true", async () => {
      const { result } = renderHook(() => useOpenBag({ branchId }));
      await waitFor(() => expect(result.current.loadingCells).toBe(false));

      const responses = new Map();
      responses.set(
        "http://localhost:5000/api/products/by-scan/2012345678901",
        {
          status: 200,
          data: {
            isScale: true,
            weightKg: 1.5,
            cell: { id: "cell-1", priceKg: 800 },
            looseName: "Test Product",
            priceKg: 800,
            total: 1200,
          },
        },
      );

      await withMockFetch(responses, async () => {
        await expect(
          act(async () => {
            await result.current.searchProduct("2012345678901");
          }),
        ).rejects.toThrow("Las etiquetas de balanza no se pueden abrir como bolsa");
      });
    });

    it("rejects with correct error when product.weightKg is null", async () => {
      const { result } = renderHook(() => useOpenBag({ branchId }));
      await waitFor(() => expect(result.current.loadingCells).toBe(false));

      const responses = new Map();
      responses.set(
        "http://localhost:5000/api/products/by-scan/7791234567890",
        {
          status: 200,
          data: {
            isScale: false,
            product: {
              _id: "p1",
              id: "p1",
              name: "Product sin peso",
              price: 10000,
              code: "7791234567890",
              weightKg: null,
            },
          },
        },
      );

      await withMockFetch(responses, async () => {
        await expect(
          act(async () => {
            await result.current.searchProduct("7791234567890");
          }),
        ).rejects.toThrow("Este producto no tiene peso configurado para abrir bolsa");
      });
    });

    it("rejects with correct error when product.weightKg is 0", async () => {
      const { result } = renderHook(() => useOpenBag({ branchId }));
      await waitFor(() => expect(result.current.loadingCells).toBe(false));

      const responses = new Map();
      responses.set(
        "http://localhost:5000/api/products/by-scan/7791234567890",
        {
          status: 200,
          data: {
            isScale: false,
            product: {
              _id: "p1",
              id: "p1",
              name: "Product peso cero",
              price: 10000,
              code: "7791234567890",
              weightKg: 0,
            },
          },
        },
      );

      await withMockFetch(responses, async () => {
        await expect(
          act(async () => {
            await result.current.searchProduct("7791234567890");
          }),
        ).rejects.toThrow("Este producto no tiene peso configurado para abrir bolsa");
      });
    });

    it("rejects with correct error when product.weightKg is negative", async () => {
      const { result } = renderHook(() => useOpenBag({ branchId }));
      await waitFor(() => expect(result.current.loadingCells).toBe(false));

      const responses = new Map();
      responses.set(
        "http://localhost:5000/api/products/by-scan/7791234567890",
        {
          status: 200,
          data: {
            isScale: false,
            product: {
              _id: "p1",
              id: "p1",
              name: "Product peso negativo",
              price: 10000,
              code: "7791234567890",
              weightKg: -1,
            },
          },
        },
      );

      await withMockFetch(responses, async () => {
        await expect(
          act(async () => {
            await result.current.searchProduct("7791234567890");
          }),
        ).rejects.toThrow("Este producto no tiene peso configurado para abrir bolsa");
      });
    });

    it("rejects with correct error on network failure", async () => {
      const { result } = renderHook(() => useOpenBag({ branchId }));
      await waitFor(() => expect(result.current.loadingCells).toBe(false));

      const responses = new Map();
      responses.set(
        "http://localhost:5000/api/products/by-scan/7791234567890",
        {
          status: 500,
          data: { message: "Server error" },
        },
      );

      await withMockFetch(responses, async () => {
        await expect(
          act(async () => {
            await result.current.searchProduct("7791234567890");
          }),
        ).rejects.toThrow("Server error");
      });
    });

    it("clears error when clearError is called", async () => {
      const { result } = renderHook(() => useOpenBag({ branchId }));
      await waitFor(() => expect(result.current.loadingCells).toBe(false));

      const responses = new Map();
      responses.set(
        "http://localhost:5000/api/products/by-scan/7791234567890",
        {
          status: 500,
          data: { message: "Server error" },
        },
      );

      await withMockFetch(responses, async () => {
        await expect(
          act(async () => {
            await result.current.searchProduct("7791234567890");
          }),
        ).rejects.toThrow("Server error");

        act(() => {
          result.current.clearError();
        });

        expect(result.current.error).toBeNull();
      });
    });
  });

  describe("openBag", () => {
    beforeEach(() => {
      // Reset the openBag mock to clear any implementations from previous tests
      openBagMock.mockReset();
      setupMocks();
    });

    it("calls looseStock.openBag with correct payload", async () => {
      const { result } = renderHook(() => useOpenBag({ branchId }));
      await waitFor(() => expect(result.current.loadingCells).toBe(false));

      let openResult: Awaited<ReturnType<typeof result.current.openBag>>;
      await act(async () => {
        openResult = await result.current.openBag("product-1", "cell-1");
      });

      expect(openBagMock).toHaveBeenCalledWith({
        productId: "product-1",
        branchId: "branch-1",
        priceKgPriceId: "cell-1",
      });
      expect(openResult).toEqual({
        id: "open-1",
        priceKgPriceId: "cell-1",
        branchId,
        quantity: 15,
        brandId: "brand-1",
        typeId: "type-1",
        species: "PERRO",
        priceKg: 1200,
      });
    });

    it("throws translated error for LOOSE_BAG_INSUFFICIENT_STOCK", async () => {
      const { result } = renderHook(() => useOpenBag({ branchId }));
      await waitFor(() => expect(result.current.loadingCells).toBe(false));

      openBagMock.mockImplementation(() => Promise.reject(new Error("LOOSE_BAG_INSUFFICIENT_STOCK")));

      await expect(
        act(async () => {
          await result.current.openBag("product-1", "cell-1");
        }),
      ).rejects.toThrow("Sin stock de bolsas en tu sucursal");
    });

    it("throws translated error for LOOSE_LINE_NOT_FOUND", async () => {
      const { result } = renderHook(() => useOpenBag({ branchId }));
      await waitFor(() => expect(result.current.loadingCells).toBe(false));

      openBagMock.mockImplementation(() => Promise.reject(new Error("LOOSE_LINE_NOT_FOUND")));

      await expect(
        act(async () => {
          await result.current.openBag("product-1", "cell-1");
        }),
      ).rejects.toThrow("Línea de planilla no existe");
    });

    it("throws generic error for other LOOSE_* errors", async () => {
      const { result } = renderHook(() => useOpenBag({ branchId }));
      await waitFor(() => expect(result.current.loadingCells).toBe(false));

      // Use an error code not in the specific mappings to test generic fallback
      openBagMock.mockImplementation(() => Promise.reject(new Error("LOOSE_UNKNOWN_ERROR")));

      await expect(
        act(async () => {
          await result.current.openBag("product-1", "cell-1");
        }),
      ).rejects.toThrow("No se pudo abrir la bolsa");
    });

    it("throws generic error for network failure", async () => {
      const { result } = renderHook(() => useOpenBag({ branchId }));
      await waitFor(() => expect(result.current.loadingCells).toBe(false));

      openBagMock.mockImplementation(() => Promise.reject(new Error("Network error")));

      await expect(
        act(async () => {
          await result.current.openBag("product-1", "cell-1");
        }),
      ).rejects.toThrow("No se pudo abrir la bolsa");
    });

    it("clears error when clearError is called after openBag failure", async () => {
      const { result } = renderHook(() => useOpenBag({ branchId }));
      await waitFor(() => expect(result.current.loadingCells).toBe(false));

      openBagMock.mockImplementation(() => Promise.reject(new Error("LOOSE_BAG_INSUFFICIENT_STOCK")));

      await expect(
        act(async () => {
          await result.current.openBag("product-1", "cell-1");
        }),
      ).rejects.toThrow("Sin stock de bolsas en tu sucursal");

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe("initial state", () => {
    it("has correct initial state", () => {
      const { result } = renderHook(() => useOpenBag({ branchId }));

      expect(result.current.cellOptions).toEqual([]);
      expect(result.current.loadingCells).toBe(true);
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(typeof result.current.searchProduct).toBe("function");
      expect(typeof result.current.openBag).toBe("function");
      expect(typeof result.current.clearError).toBe("function");
    });
  });
});
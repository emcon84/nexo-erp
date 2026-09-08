import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../contexts/OrgModulesContext", () => ({
  useOrgModulesContext: vi.fn(),
}));

vi.mock("../services/modulesService", () => ({
  updateModules: vi.fn(),
}));

import { ModulesSettings } from "../views/ModulesSettings";
import { useOrgModulesContext } from "../contexts/OrgModulesContext";
import { updateModules } from "../services/modulesService";
import type { ModuleRegistryEntry } from "../services/modulesService";

const registry: ModuleRegistryEntry[] = [
  { key: "stock", label: "Stock", minPlan: "BASICO", enabled: true },
  { key: "ventas", label: "Ventas", minPlan: "BASICO", enabled: true },
  { key: "pricing", label: "Config. de precios", minPlan: "PRO", enabled: true },
  { key: "bot", label: "Asistente IA", minPlan: "PREMIUM", enabled: false },
];

const baseContext = {
  registry,
  plan: "PRO" as const,
  planAllowed: ["stock", "ventas", "pricing"],
  enabledModules: ["stock", "ventas", "pricing"],
  hasPriceKg: false,
  isLoading: false,
  refresh: vi.fn(),
};

const renderView = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ModulesSettings />
    </QueryClientProvider>,
  );
};

describe("ModulesSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useOrgModulesContext).mockReturnValue(baseContext);
  });

  it("renderiza el título de la página", () => {
    renderView();
    expect(
      screen.getByRole("heading", { name: /módulos/i, level: 1 }),
    ).toBeInTheDocument();
  });

  it("bloquea (deshabilita) el toggle de un módulo que el plan NO permite", () => {
    renderView();
    const botSwitch = screen.getByRole("switch", { name: /asistente ia/i });
    expect(botSwitch).toBeDisabled();
  });

  it("habilita el toggle de un módulo que el plan sí permite", () => {
    renderView();
    const stockSwitch = screen.getByRole("switch", { name: /stock/i });
    expect(stockSwitch).not.toBeDisabled();
  });

  it("guarda los módulos seleccionados vía PUT al hacer clic en Guardar", async () => {
    const user = userEvent.setup();
    vi.mocked(updateModules).mockResolvedValue({
      registry,
      plan: "PRO",
      planAllowed: ["stock", "ventas", "pricing"],
      enabledModules: ["stock", "ventas", "pricing"],
      hasPriceKg: false,
    });
    renderView();

    await user.click(screen.getByRole("button", { name: /guardar módulos/i }));

    await waitFor(() => {
      expect(updateModules).toHaveBeenCalledWith(
        expect.arrayContaining(["stock", "ventas", "pricing"]),
      );
    });
  });
});

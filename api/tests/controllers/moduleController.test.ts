import { Response } from "express";
import {
  getModules,
  updateModules,
} from "../../src/controllers/moduleController";
import { basePrisma } from "../../src/config/db";
import * as tenantContext from "../../src/config/tenantContext";

jest.mock("../../src/config/db", () => ({
  basePrisma: {
    organization: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    priceKgPrice: {
      count: jest.fn(),
    },
  },
}));

jest.mock("../../src/config/tenantContext", () => ({
  requireOrganizationId: jest.fn(),
}));

const mockedDb = basePrisma as unknown as {
  organization: { findUnique: jest.Mock; update: jest.Mock };
  priceKgPrice: { count: jest.Mock };
};

const mockRequest = (body: any = {}) => ({ body } as any);
const mockResponse = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res) as any;
  res.json = jest.fn().mockReturnValue(res) as any;
  return res as Response & { status: jest.Mock; json: jest.Mock };
};

describe("moduleController", () => {
  const orgId = "org-123";

  beforeEach(() => {
    jest.clearAllMocks();
    (tenantContext.requireOrganizationId as jest.Mock).mockReturnValue(orgId);
  });

  describe("getModules", () => {
    it("devuelve registry + plan + planAllowed + enabledModules + hasPriceKg", async () => {
      mockedDb.organization.findUnique.mockResolvedValue({
        plan: "PRO",
        enabledModules: [],
      });
      mockedDb.priceKgPrice.count.mockResolvedValue(0);

      const req = mockRequest();
      const res = mockResponse();

      await getModules(req, res);

      expect(mockedDb.organization.findUnique).toHaveBeenCalledWith({
        where: { id: orgId },
        select: { plan: true, enabledModules: true },
      });
      expect(mockedDb.priceKgPrice.count).toHaveBeenCalledWith({
        where: { organizationId: orgId },
      });
      expect(res.status).toHaveBeenCalledWith(200);

      const body = res.json.mock.calls[0][0];
      expect(body.plan).toBe("PRO");
      expect(body.enabledModules).toEqual([]);
      expect(body.hasPriceKg).toBe(false);
      // planAllowed contiene todos los módulos permitidos por PRO
      expect(body.planAllowed).toContain("pricing");
      expect(body.planAllowed).toContain("tienda");
      expect(body.planAllowed).not.toContain("bot");
      // registry trae key/label/minPlan/enabled
      const suelto = body.registry.find((m: any) => m.key === "suelto");
      expect(suelto).toBeDefined();
      expect(suelto.minPlan).toBe("BASICO");
      // 0 celdas → suelto deshabilitado
      expect(suelto.enabled).toBe(false);
      const stock = body.registry.find((m: any) => m.key === "stock");
      expect(stock.enabled).toBe(true);
    });

    it("hasPriceKg true cuando la org tiene celdas de precio por kilo", async () => {
      mockedDb.organization.findUnique.mockResolvedValue({
        plan: "PREMIUM",
        enabledModules: [],
      });
      mockedDb.priceKgPrice.count.mockResolvedValue(197);

      const req = mockRequest();
      const res = mockResponse();

      await getModules(req, res);

      const body = res.json.mock.calls[0][0];
      expect(body.hasPriceKg).toBe(true);
      const suelto = body.registry.find((m: any) => m.key === "suelto");
      expect(suelto.enabled).toBe(true);
    });
  });

  describe("updateModules", () => {
    it("rechaza una key desconocida con 400 MODULE_UNKNOWN", async () => {
      mockedDb.organization.findUnique.mockResolvedValue({ plan: "PRO" });

      const req = mockRequest({ modules: ["stock", "no-existe"] });
      const res = mockResponse();

      await updateModules(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "MODULE_UNKNOWN" }),
      );
      expect(mockedDb.organization.update).not.toHaveBeenCalled();
    });

    it("rechaza un módulo por encima del plan con 400 MODULE_NOT_ALLOWED", async () => {
      mockedDb.organization.findUnique.mockResolvedValue({ plan: "PRO" });

      const req = mockRequest({ modules: ["stock", "bot"] });
      const res = mockResponse();

      await updateModules(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "MODULE_NOT_ALLOWED" }),
      );
      expect(mockedDb.organization.update).not.toHaveBeenCalled();
    });

    it("guarda la config válida y devuelve el shape actualizado", async () => {
      mockedDb.organization.findUnique
        .mockResolvedValueOnce({ plan: "PRO" }) // read plan
        .mockResolvedValueOnce({ plan: "PRO", enabledModules: ["stock"] }); // re-read for response
      mockedDb.organization.update.mockResolvedValue({
        id: orgId,
        plan: "PRO",
        enabledModules: ["stock"],
      });
      mockedDb.priceKgPrice.count.mockResolvedValue(0);

      const req = mockRequest({ modules: ["stock"] });
      const res = mockResponse();

      await updateModules(req, res);

      expect(mockedDb.organization.update).toHaveBeenCalledWith({
        where: { id: orgId },
        data: { enabledModules: ["stock"] },
      });
      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.enabledModules).toEqual(["stock"]);
      expect(body.plan).toBe("PRO");
    });

    it("maneja errores de DB con 400", async () => {
      mockedDb.organization.findUnique.mockRejectedValue(new Error("DB down"));

      const req = mockRequest({ modules: ["stock"] });
      const res = mockResponse();

      await updateModules(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: "DB down" });
    });
  });
});

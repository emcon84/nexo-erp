import { Response } from "express";
import { basePrisma } from "../config/db";
import { AuthedRequest } from "../middlewares/authMiddleware";
import { requireOrganizationId } from "../config/tenantContext";
import {
  MODULE_REGISTRY,
  PLAN_RANK,
  resolveEffectiveModules,
  validateModules,
  type ModuleRegistryEntry,
} from "../config/planLimits";
import type { Plan } from "@prisma/client";

// Módulos por negocio (sdd/modulos-por-negocio). Organization NO está en
// TENANT_MODELS (ver db.ts) — es un modelo 1:1 de plataforma, así que se
// accede SIEMPRE por organizationId vía basePrisma (mismo patrón que
// AppBranding/ArcaSetting). Nunca por id propio del body.

interface OrgModulesPayload {
  registry: Array<ModuleRegistryEntry & { enabled: boolean }>;
  plan: Plan;
  planAllowed: string[];
  enabledModules: string[];
  hasPriceKg: boolean;
}

const getOrgModules = async (organizationId: string): Promise<OrgModulesPayload> => {
  const org = await basePrisma.organization.findUnique({
    where: { id: organizationId },
    select: { plan: true, enabledModules: true },
  });
  if (!org) {
    throw new Error("Organización no encontrada");
  }
  const plan = org.plan as Plan;
  const enabledModules = org.enabledModules ?? [];

  const hasPriceKg =
    (await basePrisma.priceKgPrice.count({ where: { organizationId } })) > 0;

  const effective = resolveEffectiveModules(enabledModules, plan, hasPriceKg);
  const planAllowed = MODULE_REGISTRY.filter(
    (m) => PLAN_RANK[plan] >= PLAN_RANK[m.minPlan],
  ).map((m) => m.key);
  const registry = MODULE_REGISTRY.map((m) => ({
    ...m,
    enabled: effective.includes(m.key),
  }));

  return { registry, plan, planAllowed, enabledModules, hasPriceKg };
};

/** GET /api/modules — estado de módulos de SU organización (cualquier rol). */
export const getModules = async (_req: AuthedRequest, res: Response) => {
  try {
    const organizationId = requireOrganizationId();
    res.status(200).json(await getOrgModules(organizationId));
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
};

/** PUT /api/modules — ADMIN/MANAGEMENT guarda la config de módulos (plan-cap). */
export const updateModules = async (req: AuthedRequest, res: Response) => {
  try {
    const organizationId = requireOrganizationId();
    const { modules } = req.body;

    const org = await basePrisma.organization.findUnique({
      where: { id: organizationId },
      select: { plan: true },
    });
    if (!org) {
      throw new Error("Organización no encontrada");
    }

    const { unknown, notAllowed } = validateModules(org.plan as Plan, modules);
    if (unknown.length > 0) {
      return res.status(400).json({ error: "MODULE_UNKNOWN", modules: unknown });
    }
    if (notAllowed.length > 0) {
      return res
        .status(400)
        .json({ error: "MODULE_NOT_ALLOWED", modules: notAllowed });
    }

    await basePrisma.organization.update({
      where: { id: organizationId },
      data: { enabledModules: modules },
    });

    res.status(200).json(await getOrgModules(organizationId));
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
};

export default { getModules, updateModules };

import { Request, Response } from "express";
import { prisma } from "../config/db";
import { requireOrganizationId } from "../config/tenantContext";
import {
  buildDescription,
  buildRow,
  formatPrice,
} from "../utils/scaleCsv";
import { assignMissingScaleCodes } from "../services/scaleCodeService";

/**
 * Planilla "Precios por kilo": matriz marca (filas) × tipo (columnas) →
 * precio por kilo. Cada celda es un PriceKgPrice (par marca+tipo único por
 * org Y por especie: una marca/tipo AMBOS puede tener precios distintos en la
 * planilla de Perros y en la de Gatos). A diferencia de la propagación
 * anterior, NO se matchean nombres de producto ni se toca product.priceKgSuelto:
 * acá solo se persiste la planilla.
 * Tenant-scoped: PriceKgPrice está en TENANT_MODELS (db.ts) → la extensión
 * anti-fuga inyecta organizationId en el scope del request. DENTRO del
 * $transaction el tx NO hereda el scope automático (patrón priceLooseService),
 * así que organizationId se pasa EXPLÍCITO en toda query para no filtrar
 * cross-tenant.
 */

const round2 = (n: number): number => Math.round(n * 100) / 100;

export const getPriceKgPlan = async (_req: Request, res: Response) => {
  try {
    const organizationId = requireOrganizationId();
    const items = await prisma.priceKgPrice.findMany({
      where: { organizationId },
      select: {
        id: true,
        brandId: true,
        typeId: true,
        species: true,
        priceKg: true,
        scaleCode: true,
      },
    });
    return res.status(200).json({ items });
  } catch (error: any) {
    console.error("Error listando la planilla de precios por kg:", error);
    return res.status(500).json({ message: "Error al listar la planilla de precios por kg" });
  }
};

/**
 * GET celdas con código de balanza (para el listado imprimible de códigos de la
 * balanza Systel Cuora). Devuelve las celdas con scaleCode no nulo + nombres.
 */
export const getBalanzaCodes = async (_req: Request, res: Response) => {
  try {
    const organizationId = requireOrganizationId();
    const items = await prisma.priceKgPrice.findMany({
      where: { organizationId, scaleCode: { not: null } },
      select: {
        id: true,
        scaleCode: true,
        species: true,
        priceKg: true,
        brand: { select: { name: true } },
        type: { select: { name: true } },
      },
    });
    return res.status(200).json({
      items: items
        .filter((it) => it.scaleCode)
        .map((it) => ({
          code: it.scaleCode as string,
          brand: it.brand.name,
          type: it.type.name,
          species: it.species,
          priceKg: it.priceKg,
        })),
    });
  } catch (error: any) {
    console.error("Error listando códigos de balanza:", error);
    return res.status(500).json({ message: "Error al listar los códigos de balanza" });
  }
};

export const savePriceKgPlan = async (req: Request, res: Response) => {
  try {
    const organizationId = requireOrganizationId();
    const { entries } = req.body as {
      entries: {
        brandId: string;
        typeId: string;
        species: "PERRO" | "GATO" | "AMBOS";
        priceKg: number | null;
      }[];
    };

    await prisma.$transaction(async (tx) => {
      for (const entry of entries) {
        if (entry.priceKg === null) {
          // Celda vacía → borrar si existe.
          await tx.priceKgPrice.deleteMany({
            where: {
              brandId: entry.brandId,
              typeId: entry.typeId,
              species: entry.species,
              organizationId,
            },
          });
          continue;
        }
        const priceKg = round2(entry.priceKg);
        const existing = await tx.priceKgPrice.findFirst({
          where: {
            brandId: entry.brandId,
            typeId: entry.typeId,
            species: entry.species,
            organizationId,
          },
          select: { id: true },
        });
        if (existing) {
          await tx.priceKgPrice.updateMany({
            where: {
              brandId: entry.brandId,
              typeId: entry.typeId,
              species: entry.species,
              organizationId,
            },
            data: { priceKg },
          });
        } else {
          await tx.priceKgPrice.create({
            data: {
              brandId: entry.brandId,
              typeId: entry.typeId,
              species: entry.species,
              priceKg,
              organizationId,
            },
          });
        }
      }
    });

    // Fill-only: las celdas recién creadas (scaleCode null) reciben el siguiente
    // código disponible; las que ya tienen código NO se tocan. Corre fuera del
    // $transaction anterior (ver nota de scope arriba): con `prisma` (extendido)
    // el scope org lo inyecta la extensión y además pasamos organizationId explícito.
    await assignMissingScaleCodes(prisma, organizationId);

    return res.status(200).json({ saved: entries.length });
  } catch (error: any) {
    console.error("Error guardando la planilla de precios por kg:", error);
    return res.status(400).json({ message: error.message });
  }
};

/**
 * GET /price-kg-plan/codes/csv — descarga el CSV de códigos de balanza en el
 * formato de importación de Qendra (Systel Cuora) para actualizar los precios
 * de la balanza. Reutiliza la MISMA lógica del CLI (utils/scaleCsv) y de
 * `getBalanzaCodes` (celdas con scaleCode). Sin encabezado, delimitado por ';'.
 */
export const getScaleCsv = async (_req: Request, res: Response) => {
  try {
    const organizationId = requireOrganizationId();

    const [brands, types, cells] = await Promise.all([
      prisma.priceKgBrand.findMany({ where: { organizationId }, select: { id: true, name: true } }),
      prisma.priceKgType.findMany({ where: { organizationId }, select: { id: true, name: true } }),
      prisma.priceKgPrice.findMany({
        where: { organizationId, scaleCode: { not: null } },
        select: { id: true, brandId: true, typeId: true, species: true, priceKg: true, scaleCode: true },
      }),
    ]);

    const brandById = new Map(brands.map((b) => [b.id, b.name]));
    const typeById = new Map(types.map((t) => [t.id, t.name]));

    const rows = cells
      .filter((c) => c.scaleCode)
      .map((c) =>
        buildRow({
          section: "SUELTO",
          code: c.scaleCode as string,
          description: buildDescription(
            brandById.get(c.brandId) ?? "",
            typeById.get(c.typeId) ?? "",
            c.species,
          ),
          price: formatPrice(c.priceKg),
        }),
      )
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const csv = rows.length ? rows.join("\n") + "\n" : "";
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="scale-codes-qendra.csv"`);
    return res.send(csv);
  } catch (error: any) {
    console.error("Error generando el CSV de códigos de balanza:", error);
    return res.status(500).json({ message: "Error al generar el CSV de códigos de balanza" });
  }
};

const priceKgPlanController = {
  getPriceKgPlan,
  getBalanzaCodes,
  getScaleCsv,
  savePriceKgPlan,
};
export default priceKgPlanController;

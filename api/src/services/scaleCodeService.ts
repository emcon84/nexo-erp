/**
 * Asignación de `PriceKgPrice.scaleCode` (código interno de balanza, EAN-13 = 20 +
 * scaleCode + peso en gramos + verificador) a las CELDAS de la planilla "Precios
 * por kilo" (los "productos sueltos": marca × tipo × especie).
 *
 * Esquema: códigos de 3 dígitos CORRIDOS dentro de [101, 999]. La balanza
 * Systel Cuora imprime el PLU en un campo de 4 dígitos (101 → 0101), pero el
 * scaleCode del ERP es el número de 3 dígitos que tipea el operador, en String
 * SIN relleno a 4. Si no queda código libre en el rango, la celda queda con
 * scaleCode null (no inventamos códigos).
 *
 * MULTI-TENANT DISCIPLINE: todos los modelos acá (PriceKgPrice, PriceKgBrand,
 * PriceKgType) son tenant-scoped y están en TENANT_MODELS (db.ts). La función
 * corre DOS veces en contextos distintos:
 *  - En el controller (`prisma` extendido con scope anti-fuga): el scope org lo
 *    inyecta la extensión, pero igual pasamos `organizationId` EXPLÍCITO.
 *  - En el script (`basePrisma`, sin scope): `organizationId` es la única vía
 *    de scoping, así que toda query lo lleva EXPLÍCITO. Nunca findUnique/update.
 *
 * `client` se tipa `any` (convención del repo, ver priceLooseService /
 * looseSaleService): es `PrismaClient` o el cliente de `$transaction`, y el
 * type de la transacción de Prisma 7 no expone un alias público estable.
 */

/** Primer código a usar: las etiquetas de balanza arrancan en 101. */
export const CODE_MIN = 101;
/** Último código aceptado (rango de 3 dígitos: 101..999). */
export const CODE_MAX = 999;

/** Forma mínima de celda que consume el plan puro de asignación. */
export interface ScaleCodeCell {
  id: string;
  scaleCode: string | null;
}

/** Resultado de una corrida de asignación. */
export interface AssignScaleCodeResult {
  /** Cantidad de celdas a las que se les asignó un código nuevo. */
  assigned: number;
}

/**
 * Plan puro de asignación "fill-only" (NON-DESTRUCTIVE): dado el conjunto de
 * celdas, devuelve QUÉ ids reciben qué código siguiente-disponible.
 *
 * - `used` = códigos numéricos ya ocupados (101..999). Los códigos no numéricos
 *   NO se cuentan como ocupados (no bloquean el rango) pero SÍ dejan a la celda
 *   con "código ya asignado" (no se la trata como missing → no se la toca).
 * - `missing` = celdas con `scaleCode` null o vacío/whitespace.
 * - Arranca en el siguiente libre a partir del máximo código usado + 1 y va
 *   corrido. NO rellena huecos: respeta el esquema "corridos desde el anterior".
 * - Si se agota el rango, las celdas sobrantes NO se incluyen en el resultado
 *   (quedan con scaleCode null, no inventamos).
 *
 * El orden de asignación = el orden en que vienen las celdas: el llamador debe
 * presentarlas ordenadas de forma determinista (marca → tipo → especie) para que
 * el resultado sea estable.
 */
export const planMissingScaleCodes = (cells: ScaleCodeCell[]): Array<{ id: string; scaleCode: string }> => {
  const used = new Set<number>();
  const missing: Array<{ id: string }> = [];

  for (const cell of cells) {
    const raw = cell.scaleCode;
    const s = typeof raw === "string" ? raw.trim() : "";
    if (!s) {
      missing.push({ id: cell.id });
    } else if (/^\d+$/.test(s)) {
      used.add(Number(s));
    }
  }

  if (missing.length === 0) return [];

  let next = Math.max(CODE_MIN - 1, ...used) + 1;

  const out: Array<{ id: string; scaleCode: string }> = [];
  for (const cell of missing) {
    while (next <= CODE_MAX && used.has(next)) next++;
    if (next > CODE_MAX) break;
    out.push({ id: cell.id, scaleCode: String(next) });
    used.add(next);
    next++;
  }
  return out;
};

/**
 * Asigna el siguiente código disponible a TODAS las celdas de la org con
 * `priceKg > 0` que tienen `scaleCode` null/vacío. Las celdas que YA tienen
 * código NO se tocan (fill-only). Devuelve cuántas quedaron asignadas.
 *
 * Determinista: las celdas a completar se ordenan por nombre de marca →
 * nombre de tipo → especie (localeCompare 'es', sensitivity base).
 *
 * Defensivo: si `client` u `organizationId` faltan, no hace nada.
 */
export const assignMissingScaleCodes = async (
  client: any,
  organizationId: string | null | undefined,
): Promise<AssignScaleCodeResult> => {
  if (!client || !organizationId) {
    return { assigned: 0 };
  }

  const [cells, brands, types] = await Promise.all([
    client.priceKgPrice.findMany({
      where: { organizationId, priceKg: { gt: 0 } },
      select: { id: true, brandId: true, typeId: true, species: true, scaleCode: true },
    }),
    client.priceKgBrand.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    client.priceKgType.findMany({ where: { organizationId }, select: { id: true, name: true } }),
  ]);

  const brandById = new Map<string, string>(
    (brands as Array<{ id: string; name: string }>).map((b) => [b.id, b.name] as [string, string]),
  );
  const typeById = new Map<string, string>(
    (types as Array<{ id: string; name: string }>).map((t) => [t.id, t.name] as [string, string]),
  );

  const sorted = cells
    .slice()
    .sort((a: any, b: any) => {
      const byBrand = (brandById.get(a.brandId) ?? "").localeCompare(
        brandById.get(b.brandId) ?? "",
        "es",
        { sensitivity: "base" },
      );
      if (byBrand !== 0) return byBrand;
      const byType = (typeById.get(a.typeId) ?? "").localeCompare(
        typeById.get(b.typeId) ?? "",
        "es",
        { sensitivity: "base" },
      );
      if (byType !== 0) return byType;
      return a.species.localeCompare(b.species, "es", { sensitivity: "base" });
    })
    .map((c: any) => ({ id: c.id, scaleCode: c.scaleCode ?? null }));

  const plan = planMissingScaleCodes(sorted);
  if (plan.length === 0) return { assigned: 0 };

  let assigned = 0;
  for (const row of plan) {
    await client.priceKgPrice.updateMany({
      where: { id: row.id, organizationId },
      data: { scaleCode: row.scaleCode },
    });
    assigned++;
  }

  return { assigned };
};

export default { planMissingScaleCodes, assignMissingScaleCodes, CODE_MIN, CODE_MAX };

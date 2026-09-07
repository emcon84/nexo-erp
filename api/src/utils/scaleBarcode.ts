/**
 * Utilidades para interpretar el código de barras EAN-13 que imprime la balanza
 * Systel Cuora (etiqueta FIJA de la Cuora, no Max).
 *
 * La etiqueta usa la composición configurada en Qendra → Configuración → Códigos
 * de barras (artículos de venta por PESO): "Imprimir Peso" + valor de inicio 20 +
 * formato 2 de inicio / 4 de código de PLU / 6 de peso. Resultado, 13 dígitos:
 *
 *   [20] [código interno (4)] [peso en gramos (6)] [verificador (1)]
 *
 * Confirmado en balanza real: 2000030001808 → 20 + 0003 + 000180 (=180g = 0.180kg) + 8.
 *
 * El peso va en GRAMOS en esas 6 posiciones → para kg dividimos por 1000.
 * El "código interno" es el scaleCode del producto (la llave con el ERP).
 */

export const SCALE_PREFIX = "20";

export interface ParsedScaleBarcode {
  isScale: boolean;
  /** El EAN-13 completo (13 dígitos). */
  raw: string;
  /** Código interno de balanza (scaleCode), sin ceros iniciales (ej "101"). */
  code: string;
  /** Peso en gramos (entero). */
  weightGrams: number;
  /** Peso en kg (weightGrams / 1000). */
  weightKg: number;
}

/** Verifica el dígito verificador de un EAN-13 (standard). */
export const isValidEan13 = (raw: string): boolean => {
  if (!/^\d{13}$/.test(raw)) return false;
  const digits = raw.split("").map(Number);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += digits[i] * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === digits[12];
};

/**
 * Parsea un EAN-13 de etiqueta de balanza. Devuelve `{ isScale: false }` si no
 * empieza con el prefijo de peso (`20`), para que el caller pueda caer al
 * lookup normal por barcode/code.
 */
export const parseScaleBarcode = (raw: string): ParsedScaleBarcode | null => {
  if (!raw || raw.length !== 13 || !/^\d+$/.test(raw)) return null;
  if (!raw.startsWith(SCALE_PREFIX)) return { isScale: false, raw, code: "", weightGrams: 0, weightKg: 0 };

  // El campo "código interno" ocupa 4 posiciones fijas en el EAN-13, pero el
  // scaleCode guardado en el ERP es de 3 dígitos (ej PLU 101 → la etiqueta
  // imprime 0101). Normalizamos quitando ceros iniciales para que matchee
  // contra PriceKgPrice.scaleCode (que guarda "101").
  const code = String(Number.parseInt(raw.substring(2, 6), 10));
  const weightGrams = Number.parseInt(raw.substring(6, 12), 10);
  return {
    isScale: true,
    raw,
    code,
    weightGrams,
    weightKg: weightGrams / 1000,
  };
};

export const scaleBarcode = {
  SCALE_PREFIX,
  isValidEan13,
  parseScaleBarcode,
};

export default scaleBarcode;

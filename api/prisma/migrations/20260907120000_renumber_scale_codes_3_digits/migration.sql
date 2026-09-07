-- Renumera scaleCode de 4 dígitos (1001..1196) a 3 dígitos (101..296) en las
-- celdas de la planilla "Precios por kilo" (productos sueltos, price_kg_prices).
--
-- Mapeo: nuevo = viejo - 900. El orden determinista (marca madre → tipo →
-- especie) es el mismo que usa scripts/assign-scale-codes.ts y los códigos
-- actuales salen corridos desde 1001, así el primer código (1001) pasa a 101 y
-- el último (1196) a 296. La balanza imprime el PLU en un campo EAN-13 de 4
-- posiciones (101 → 0101); el ERP guarda el número de 3 dígitos que tipea el
-- operador en la balanza.
--
-- Sólo se tocan códigos de 4 dígitos dentro del rango 1001..1196. El resto
-- (NULL, "0000" de desborde u otros esquemas previos) queda intacto.

UPDATE "price_kg_prices"
SET "scaleCode" = (CAST("scaleCode" AS INTEGER) - 900)::TEXT
WHERE "scaleCode" IS NOT NULL
  AND "scaleCode" ~ '^[0-9]{4}$'
  AND CAST("scaleCode" AS INTEGER) BETWEEN 1001 AND 1196;

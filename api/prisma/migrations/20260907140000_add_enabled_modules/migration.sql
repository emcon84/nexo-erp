-- Módulos habilitados por negocio (sdd/modulos-por-negocio).
--
-- Array TEXT[] con default '{}' (vacío = "no configurado" → el front cae al
-- comportamiento legacy por plan + suelto condicional). Reversible:
-- ALTER TABLE ... DROP COLUMN. Backwards compatible: el build anterior lee/
-- escribe sin cambios (columna nueva con default).
--
-- Generada OFFLINE (no hay DB local, CLAUDE.md): se aplica en el VPS con
-- `prisma migrate deploy` (deploy.sh paso 6).

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "enabledModules" TEXT[] NOT NULL DEFAULT '{}';

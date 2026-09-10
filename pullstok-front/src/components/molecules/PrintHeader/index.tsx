import type { ReactNode } from "react";
import orgLogoUrl from "@/assets/logo-horizontal-almacen.png";

interface PrintHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
}

/**
 * Encabezado imprimible con el logo HORIZONTAL de la organización
 * ("EL ALMACEN DE LAS MASCOTAS", assets/logo-horizontal-almacen.png). Se usa en
 * TODAS las áreas imprimibles (listado de productos, planilla mayorista, bulk
 * price y planilla por kg) con esa marca.
 */
export const PrintHeader = ({ title, subtitle }: PrintHeaderProps) => {
  const logoUrl = orgLogoUrl;

  return (
    <div className="mb-4 flex items-center gap-3">
      <img
        src={logoUrl}
        alt="Logo"
        data-testid="print-logo"
        className="h-10 w-auto max-w-full object-contain"
      />
      <div>
        <h1 className="text-lg font-bold">{title}</h1>
        {subtitle && <p className="text-sm">{subtitle}</p>}
      </div>
    </div>
  );
};

export default PrintHeader;

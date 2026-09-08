import {
  LayoutDashboard,
  FileText,
  ClipboardList,
  ShoppingCart,
  Truck,
  Users,
  Store,
  Receipt,
  Tags,
  MessageSquare,
  Bot,
  UserPlus,
  Building,
  ScanLine,
  DollarSign,
  Package,
  Settings,
  Wrench,
  Palette,
  Clock,
  Scale,
  FileSpreadsheet,
  Search,
  ClipboardCheck,
  PackageOpen,
  Wallet,
  MessageCircle,
} from "lucide-react";
import { PLAN_LIMITS, type Plan } from "@/constants/planLimits";
import type { Role } from "@/constants/rolePermissions";

export interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  moduleKey?: string | null;
  visibleRoles?: Role[];
}

export interface NavGroup {
  label: string;
  icon: typeof LayoutDashboard;
  items: NavItem[];
}

export const navGroups: NavGroup[] = [
  {
    label: "Productos",
    icon: Package,
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/categorias", label: "Categorías", icon: Tags, visibleRoles: ["ADMIN", "MANAGEMENT"] },
      { to: "/actualizar-precios", label: "Actualizar precios", icon: DollarSign, moduleKey: "suelto", visibleRoles: ["ADMIN", "SUPERADMIN"] },
      { to: "/precios-por-kilo", label: "Precios por kilo", icon: Scale, moduleKey: "suelto", visibleRoles: ["ADMIN", "SUPERADMIN"] },
      { to: "/consultar-precios", label: "Venta suelta", icon: Search, moduleKey: "suelto", visibleRoles: ["ADMIN", "MANAGEMENT", "VENDEDOR", "CASHIER"] },
      { to: "/revision-precios-kg", label: "Revisión precios kg", icon: ClipboardCheck, moduleKey: "suelto", visibleRoles: ["ADMIN"] },
      { to: "/stock-suelto", label: "Stock suelto", icon: PackageOpen, moduleKey: "suelto", visibleRoles: ["ADMIN", "MANAGEMENT"] },
      { to: "/planilla-mayorista", label: "Planilla mayorista", icon: FileSpreadsheet, moduleKey: "suelto", visibleRoles: ["ADMIN", "SUPERADMIN"] },
    ],
  },
  {
    label: "Ventas",
    icon: ShoppingCart,
    items: [
      { to: "/Ventas", label: "Ventas", icon: ShoppingCart, visibleRoles: ["ADMIN", "MANAGEMENT", "VENDEDOR", "CASHIER"] },
      { to: "/caja", label: "Caja", icon: Wallet, visibleRoles: ["ADMIN", "MANAGEMENT", "VENDEDOR", "CASHIER"] },
      { to: "/presupuestos", label: "Presupuestos", icon: FileText, visibleRoles: ["ADMIN", "MANAGEMENT", "VENDEDOR"] },
      { to: "/pedidos", label: "Pedidos", icon: ClipboardList, visibleRoles: ["ADMIN", "MANAGEMENT", "VENDEDOR"] },
      { to: "/pedidos-whatsapp", label: "Pedidos WhatsApp", icon: MessageCircle, visibleRoles: ["ADMIN", "MANAGEMENT", "VENDEDOR"] },
      { to: "/facturas", label: "Remitos", icon: Truck, visibleRoles: ["ADMIN", "MANAGEMENT", "CASHIER"] },
      { to: "/Clientes", label: "Clientes", icon: Users, visibleRoles: ["ADMIN", "MANAGEMENT", "VENDEDOR"] },
    ],
  },
  {
    label: "Tienda",
    icon: Store,
    items: [
      { to: "/tienda", label: "Configuración", icon: Store, visibleRoles: ["ADMIN", "MANAGEMENT"] },
    ],
  },
  {
    label: "Admin",
    icon: Settings,
    items: [
      { to: "/facturacion", label: "Facturación", icon: Receipt, moduleKey: "facturacion", visibleRoles: ["ADMIN", "MANAGEMENT"] },
      { to: "/usuarios", label: "Usuarios", icon: UserPlus, visibleRoles: ["ADMIN", "MANAGEMENT"] },
      { to: "/sucursales", label: "Sucursales", icon: Building, visibleRoles: ["ADMIN", "MANAGEMENT"] },
      { to: "/ajustes", label: "Ajustes", icon: Palette, moduleKey: "branding", visibleRoles: ["ADMIN"] },
      { to: "/ajustes/modulos", label: "Módulos", icon: Settings, visibleRoles: ["ADMIN"] },
      { to: "/ajustes/horarios", label: "Horario comercial", icon: Clock, visibleRoles: ["ADMIN"] },
      { to: "/configuracion-precios", label: "Configuración de precios", icon: Scale, moduleKey: "pricing", visibleRoles: ["ADMIN", "MANAGEMENT"] },
      { to: "/mensajes", label: "Mensajes", icon: MessageSquare, visibleRoles: ["ADMIN", "MANAGEMENT"] },
    ],
  },
  {
    label: "Herramientas",
    icon: Wrench,
    items: [
      { to: "/scanner", label: "Scanner", icon: ScanLine },
      { to: "/asistente-ia", label: "Asistente IA", icon: Bot, moduleKey: "bot", visibleRoles: ["ADMIN", "MANAGEMENT"] },
    ],
  },
];

// Keep navItems flat for backward compatibility with filters
export const navItems: NavItem[] = navGroups.flatMap((g) => g.items);

// Menú SIMPLE (plano, sin agrupaciones) para el rol VENDEDOR: es el usuario más
// simple, así que en vez de los acordeones PRODUCTOS/VENTAS/etc. se muestran
// links directos con labels claros orientados a la venta de mostrador.
export const vendorSimpleNav: NavItem[] = [
  { to: "/dashboard", label: "Vender", icon: ShoppingCart },
  { to: "/pedidos", label: "Pedidos", icon: ClipboardList },
  { to: "/pedidos-whatsapp", label: "Pedidos WhatsApp", icon: MessageCircle },
  { to: "/mensajes", label: "Mensajes", icon: MessageSquare },
  { to: "/Ventas", label: "Ventas", icon: ShoppingCart },
  { to: "/presupuestos", label: "Presupuestos", icon: FileText },
  { to: "/caja", label: "Caja", icon: Wallet },
  { to: "/Clientes", label: "Clientes", icon: Users },
  { to: "/scanner", label: "Scanner", icon: ScanLine },
];

export function filterNavItemsByPlan(
  items: NavItem[],
  plan: Plan | null | undefined,
): NavItem[] {
  return items.filter((item) => {
    if (!item.moduleKey) return true;
    const modules = plan ? PLAN_LIMITS[plan]?.modules : undefined;
    return !!modules?.includes(item.moduleKey);
  });
}

/**
 * Resuelve los módulos efectivos de una org (sdd/modulos-por-negocio).
 * - Si la org tiene config explícita (enabledModules no vacío) → esa lista gana.
 * - Si no (legacy) → defaults del plan, y agrega `suelto` solo si la org tiene
 *   celdas de precio por kilo (hasPriceKg).
 * Pura: la usa el sidebar y el OrgModulesContext.
 */
export function resolveEffectiveModules(
  enabledModules: string[],
  plan: Plan | null | undefined,
  hasPriceKg: boolean,
): string[] {
  if (enabledModules.length > 0) return enabledModules;
  const base = plan ? PLAN_LIMITS[plan]?.modules ?? [] : [];
  if (hasPriceKg && !base.includes("suelto")) return [...base, "suelto"];
  return base;
}

/**
 * Filtra ítems de navegación por los módulos efectivos. Un ítem se muestra si
 * no tiene moduleKey (siempre visible) o si su moduleKey está en la lista.
 * Se compone con filterNavItemsByRole para armar el menú final.
 */
export function filterNavItemsByModules(
  items: NavItem[],
  effectiveModules: string[],
): NavItem[] {
  return items.filter((item) => {
    if (!item.moduleKey) return true;
    return effectiveModules.includes(item.moduleKey);
  });
}

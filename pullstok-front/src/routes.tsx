import { Suspense, lazy } from "react";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
import AuthLayout from "./layouts/AuthLayout";
import ProtectedLayout from "./layouts/ProtectedLayout";
import OnboardingLayout from "./layouts/OnboardingLayout";
import SuperadminLayout from "./layouts/SuperadminLayout";
import { Loader } from "./components/atoms/loader";

const LoginPage = lazy(() =>
  import("./views/LoginPage").then((m) => ({ default: m.LoginPage })),
);
const ForgotPasswordPage = lazy(() =>
  import("./views/ForgotPasswordPage").then((m) => ({
    default: m.ForgotPasswordPage,
  })),
);
const ResetPasswordPage = lazy(() =>
  import("./views/ResetPasswordPage").then((m) => ({
    default: m.ResetPasswordPage,
  })),
);
const ChangePassword = lazy(() =>
  import("./views/ChangePassword").then((m) => ({ default: m.ChangePassword })),
);
const Wizard = lazy(() =>
  import("./views/Onboarding/Wizard").then((m) => ({ default: m.Wizard })),
);
const OrganizationSuspended = lazy(() =>
  import("./views/OrganizationSuspended").then((m) => ({
    default: m.OrganizationSuspended,
  })),
);
const OutsideBusinessHours = lazy(() =>
  import("./views/OutsideBusinessHours").then((m) => ({
    default: m.OutsideBusinessHours,
  })),
);
const Dashboard = lazy(() =>
  import("./views/Dashboard").then((m) => ({ default: m.Dashboard })),
);
const Quotations = lazy(() =>
  import("./views/Quotations").then((m) => ({ default: m.Quotations })),
);
const Orders = lazy(() =>
  import("./views/Orders").then((m) => ({ default: m.Orders })),
);
const WhatsappOrders = lazy(() =>
  import("./views/WhatsappOrders").then((m) => ({ default: m.WhatsappOrders })),
);
const Comprobations = lazy(() =>
  import("./views/Comprobations").then((m) => ({ default: m.Comprobations })),
);
const SalesPage = lazy(() =>
  import("./views/Sales").then((m) => ({ default: m.SalesPage })),
);
const Customers = lazy(() =>
  import("./views/Customers").then((m) => ({ default: m.Customers })),
);
const Categories = lazy(() =>
  import("./views/Categories").then((m) => ({ default: m.Categories })),
);
const Tienda = lazy(() =>
  import("./views/Tienda").then((m) => ({ default: m.Tienda })),
);
const OrganizationsList = lazy(() =>
  import("./views/superadmin/OrganizationsList").then((m) => ({
    default: m.OrganizationsList,
  })),
);
const Invoices = lazy(() =>
  import("./views/Invoices").then((m) => ({ default: m.Invoices })),
);
const InvoiceForm = lazy(() =>
  import("./views/InvoiceForm").then((m) => ({ default: m.InvoiceForm })),
);
const InvoiceDetail = lazy(() =>
  import("./views/InvoiceDetail").then((m) => ({ default: m.InvoiceDetail })),
);
const Messages = lazy(() =>
  import("./views/Messages").then((m) => ({ default: m.Messages })),
);
const BotConfig = lazy(() =>
  import("./views/BotConfig").then((m) => ({ default: m.BotConfig })),
);
const UsersPage = lazy(() =>
  import("./views/UsersPage").then((m) => ({ default: m.UsersPage })),
);
const SuperadminUsersPage = lazy(() =>
  import("./views/superadmin/SuperadminUsersPage").then((m) => ({
    default: m.SuperadminUsersPage,
  })),
);
const BranchesPage = lazy(() =>
  import("./views/BranchesPage").then((m) => ({ default: m.BranchesPage })),
);

const StockScannerPage = lazy(() =>
  import("./views/StockScannerPage").then((m) => ({ default: m.StockScannerPage })),
);
const BulkPriceUpdate = lazy(() =>
  import("./views/BulkPriceUpdate").then((m) => ({ default: m.BulkPriceUpdate })),
);
const PriceKgUpdate = lazy(() =>
  import("./views/PriceKgUpdate").then((m) => ({ default: m.PriceKgUpdate })),
);
const BalanzaCodes = lazy(() =>
  import("./views/BalanzaCodes").then((m) => ({ default: m.BalanzaCodes })),
);
const PriceKgLookup = lazy(() =>
  import("./views/PriceKgLookup").then((m) => ({ default: m.PriceKgLookup })),
);
const AdminReviewQueue = lazy(() =>
  import("./views/AdminReviewQueue").then((m) => ({ default: m.AdminReviewQueue })),
);
const LooseStockAdmin = lazy(() =>
  import("./views/LooseStockAdmin").then((m) => ({ default: m.LooseStockAdmin })),
);

const CashSessionPage = lazy(() =>
  import("./views/CashSessionPage").then((m) => ({ default: m.CashSessionPage })),
);

const BrandingSettings = lazy(() =>
  import("./views/BrandingSettings").then((m) => ({ default: m.BrandingSettings })),
);

const BusinessHoursSettings = lazy(() =>
  import("./views/BusinessHoursSettings").then((m) => ({
    default: m.BusinessHoursSettings,
  })),
);

const ModulesSettings = lazy(() =>
  import("./views/ModulesSettings").then((m) => ({
    default: m.ModulesSettings,
  })),
);

const PricingSettings = lazy(() =>
  import("./views/PricingSettings").then((m) => ({
    default: m.PricingSettings,
  })),
);

const PriceListImport = lazy(() =>
  import("./views/PriceListImport").then((m) => ({ default: m.PriceListImport })),
);

const PriceListDetail = lazy(() =>
  import("./views/PriceListDetail").then((m) => ({ default: m.PriceListDetail })),
);

const PriceListList = lazy(() =>
  import("./views/PriceListList").then((m) => ({ default: m.PriceListList })),
);

const AppRoutes = () => (
  <Router>
    <Routes>
      {/* Login (público) */}
      <Route
        path="/"
        element={
          <AuthLayout>
            <Suspense
              fallback={
                <div className="flex min-h-[60vh] items-center justify-center">
                  <Loader />
                </div>
              }
            >
              <LoginPage />
            </Suspense>
          </AuthLayout>
        }
      />

      {/* Recuperación de contraseña (público, sin auth) */}
      <Route
        path="/forgot-password"
        element={
          <AuthLayout>
            <Suspense
              fallback={
                <div className="flex min-h-[60vh] items-center justify-center">
                  <Loader />
                </div>
              }
            >
              <ForgotPasswordPage />
            </Suspense>
          </AuthLayout>
        }
      />
      <Route
        path="/reset-password"
        element={
          <AuthLayout>
            <Suspense
              fallback={
                <div className="flex min-h-[60vh] items-center justify-center">
                  <Loader />
                </div>
              }
            >
              <ResetPasswordPage />
            </Suspense>
          </AuthLayout>
        }
      />

      {/* Gates previos al dashboard: cambio de contraseña forzado y wizard
          de onboarding. Viven fuera de ProtectedLayout (no tienen sidebar)
          pero requieren estar autenticado igual. */}
      <Route
        path="/cambiar-contrasena"
        element={
          <OnboardingLayout>
            <Suspense
              fallback={
                <div className="flex min-h-[60vh] items-center justify-center">
                  <Loader />
                </div>
              }
            >
              <ChangePassword />
            </Suspense>
          </OnboardingLayout>
        }
      />
      <Route
        path="/bienvenida"
        element={
          <OnboardingLayout>
            <Suspense
              fallback={
                <div className="flex min-h-[60vh] items-center justify-center">
                  <Loader />
                </div>
              }
            >
              <Wizard />
            </Suspense>
          </OnboardingLayout>
        }
      />
      <Route
        path="/organizacion-suspendida"
        element={
          <OnboardingLayout>
            <Suspense
              fallback={
                <div className="flex min-h-[60vh] items-center justify-center">
                  <Loader />
                </div>
              }
            >
              <OrganizationSuspended />
            </Suspense>
          </OnboardingLayout>
        }
      />
      <Route
        path="/fuera-de-horario"
        element={
          <OnboardingLayout>
            <Suspense
              fallback={
                <div className="flex min-h-[60vh] items-center justify-center">
                  <Loader />
                </div>
              }
            >
              <OutsideBusinessHours />
            </Suspense>
          </OnboardingLayout>
        }
      />

      {/* Rutas autenticadas: MainLayout persistente, solo el contenido suspende */}
      <Route element={<ProtectedLayout />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/presupuestos" element={<Quotations />} />
        <Route path="/pedidos" element={<Orders />} />
        <Route path="/pedidos-whatsapp" element={<WhatsappOrders />} />
        <Route path="/facturas" element={<Comprobations />} />
        <Route path="/Ventas" element={<SalesPage />} />
        <Route path="/caja" element={<CashSessionPage />} />
        <Route path="/Clientes" element={<Customers />} />
        <Route path="/categorias" element={<Categories />} />
        <Route path="/tienda" element={<Tienda />} />
        <Route path="/mensajes" element={<Messages />} />
        <Route path="/asistente-ia" element={<BotConfig />} />
        <Route path="/facturacion" element={<Invoices />} />
        <Route path="/facturacion/nueva" element={<InvoiceForm />} />
        <Route path="/facturacion/:id" element={<InvoiceDetail />} />
        <Route path="/facturacion/:id/editar" element={<InvoiceForm />} />
        <Route path="/usuarios" element={<UsersPage />} />
        <Route path="/sucursales" element={<BranchesPage />} />
        <Route path="/scanner" element={<StockScannerPage />} />
        <Route path="/actualizar-precios" element={<BulkPriceUpdate />} />
        <Route path="/precios-por-kilo" element={<PriceKgUpdate />} />
        <Route path="/suelto-codigos" element={<BalanzaCodes />} />
        <Route path="/consultar-precios" element={<PriceKgLookup />} />
        <Route path="/revision-precios-kg" element={<AdminReviewQueue />} />
        <Route path="/stock-suelto" element={<LooseStockAdmin />} />
        <Route path="/planilla-mayorista" element={<PriceListList />} />
        <Route path="/planilla-mayorista/importar" element={<PriceListImport />} />
        <Route path="/planilla-mayorista/:id" element={<PriceListDetail />} />
        <Route path="/ajustes" element={<BrandingSettings />} />
        <Route path="/ajustes/modulos" element={<ModulesSettings />} />
        <Route path="/ajustes/horarios" element={<BusinessHoursSettings />} />
        <Route path="/configuracion-precios" element={<PricingSettings />} />
      </Route>

      {/* Panel superadmin (sdd/planes-y-billing): rutas de plataforma, fuera
          de ProtectedLayout. Guard propio en SuperadminLayout (rol !==
          SUPERADMIN -> /dashboard). */}
      <Route element={<SuperadminLayout />}>
        <Route path="/superadmin/organizaciones" element={<OrganizationsList />} />
        <Route path="/superadmin/organizaciones/:orgId/usuarios" element={<SuperadminUsersPage />} />
      </Route>
    </Routes>
  </Router>
);

export default AppRoutes;

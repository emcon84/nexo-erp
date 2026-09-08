import { Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, Outlet } from "react-router-dom";
import MainLayout from "./MainLayout";
import { Loader } from "../components/atoms/loader";
import { getMe } from "../services/onboardingService";
import { useOrdersRealtime } from "../components/hooks/useOrdersRealtime";
import { useChatConversationsRealtime } from "../components/hooks/useChatRealtime";
import { BrandingProvider } from "@/contexts/BrandingContext";
import { OrgModulesProvider } from "@/contexts/OrgModulesContext";

/**
 * Layout persistente para las rutas autenticadas. El MainLayout (sidebar) se
 * monta UNA vez y permanece; solo el contenido (Outlet) hace Suspense al
 * cargar el chunk de cada vista. Así navegar no "parpadea" toda la pantalla.
 *
 * Cascada de gates (en este orden): sin token -> login; mustChangePassword
 * -> /cambiar-contrasena; organización suspendida -> /organizacion-suspendida;
 * sin onboarding completo -> /bienvenida; si no, Outlet normal. ['me'] es la
 * fuente de verdad server-side, reemplaza el check sync anterior que solo
 * miraba el token.
 */
const ProtectedLayout = () => {
  const isAuthenticated = !!localStorage.getItem("token");

  const { data: me, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    enabled: isAuthenticated,
  });

  // Tiempo real montado UNA vez en el árbol autenticado: vive toda la sesión
  // y no se recrea al navegar. Ambos hooks comparten la MISMA conexión socket
  // (lib/socket.ts). No conectan si no hay token en localStorage.
  // - orders: invalida ['orders'] ante orders:changed (lista + badge pedidos).
  // - chat conversations: invalida ['chat','conversations'] ante
  //   chat:conversation-updated (bandeja + badge de no-leídos), incluso fuera
  //   de la vista de Mensajes.
  useOrdersRealtime();
  useChatConversationsRealtime();

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  if (isLoading || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader />
      </div>
    );
  }

  // El SUPERADMIN no pertenece a ninguna organización (organizationId null):
  // su lugar es el panel de plataforma, no el dashboard org-scoped, que
  // dispararía endpoints que el multi-tenant bloquea por falta de contexto de
  // organización (500). Lo redirigimos al panel ANTES de montar MainLayout.
  if (me.role === "SUPERADMIN") {
    return <Navigate to="/superadmin/organizaciones" replace />;
  }

  if (me.mustChangePassword) {
    return <Navigate to="/cambiar-contrasena" replace />;
  }

  // Org suspendida (kill switch, sdd/planes-y-billing): a esta altura el rol
  // ya es ADMIN o EMPLOYEE (el SUPERADMIN se redirigió arriba), así que basta
  // con mirar el estado de la organización. `isActive` es opcional porque el
  // backend de getMe podría no exponerlo en todos los casos — undefined se
  // trata como activo, solo bloquea si llega explícitamente en false.
  if (me.organization.isActive === false) {
    return <Navigate to="/organizacion-suspendida" replace />;
  }

  // El wizard es para ADMIN y MANAGEMENT: otros roles (VENDEDOR, CASHIER,
  // EMPLOYEE) nunca lo ven, sin importar el estado del onboarding.
  if (
    (me.role === "ADMIN" || me.role === "MANAGEMENT") &&
    !me.organization.onboardingCompletedAt
  ) {
    return <Navigate to="/bienvenida" replace />;
  }

  return (
    <BrandingProvider>
      <OrgModulesProvider>
        <MainLayout>
          <Suspense
          fallback={
            <div className="flex min-h-[60vh] items-center justify-center">
              <Loader />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </MainLayout>
      </OrgModulesProvider>
    </BrandingProvider>
  );
};

export default ProtectedLayout;

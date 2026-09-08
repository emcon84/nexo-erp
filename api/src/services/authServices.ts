import { basePrisma } from "../config/db";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { Role, Plan } from "@prisma/client";
import { generateAccessToken, generateRefreshToken, verifyToken } from "../utils/jwtUtils";
import { isWithinBusinessHours, DaySetting } from "../utils/businessHours";
import { sendMail } from "./mailService";
import { resetPasswordEmail } from "./mailTemplates";
import { RateLimiter } from "./rateLimiter";

class AuthService {
  static async login(login: string, password: string) {
    // Determinar si es email (tiene @) o username
    const isEmail = login.includes("@");
    const user = await basePrisma.user.findFirst({
      where: isEmail ? { email: login } : { username: login },
      include: { organization: true },
    });
    if (!user || !user.isActive) {
      throw new Error("Credenciales inválidas");
    }

    // Kill switch: si el usuario pertenece a una organización (el SUPERADMIN
    // tiene organizationId=null y nunca pasa por este chequeo) y esa
    // organización fue suspendida por el superadmin, se rechaza el login.
    // Riesgo aceptado: una sesión ya iniciada antes de la suspensión sigue
    // viva hasta que expire el access token (JWT_EXPIRES_IN, hasta 8h),
    // porque el middleware `authenticate` no vuelve a consultar la DB en
    // cada request (ver design de planes-y-billing).
    if (user.organizationId && !user.organization?.isActive) {
      throw new Error(
        "Tu organización está suspendida, contactá al administrador.",
      );
    }

    // Horario comercial (sdd/business-hours-access): fuera del horario de la
    // org, los roles operativos no reciben tokens aunque las credenciales sean
    // válidas. MANAGEMENT/ADMIN/SUPERADMIN y orgs sin config pasan directo.
    await AuthService.assertBusinessHoursOpen(user);

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new Error("Credenciales inválidas");
    }

    const accessToken = generateAccessToken({
      id: user.id,
      role: user.role,
      organizationId: user.organizationId,
    });
    const refreshToken = generateRefreshToken(user.id);
    const branchIds = await AuthService.readUserBranchIds(user.id);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        role: user.role,
        organizationId: user.organizationId,
        mustChangePassword: user.mustChangePassword,
        // BranchIds del usuario como hint UX para el front (design D3):
        // el server re-lee BranchAssignment de la DB en cada PUT de stock,
        // este valor es SOLO informativo (scanner/selector de sucursal).
        branchIds,
        // Plan de la organización para gating client-side (ej. sidebar).
        // null para SUPERADMIN (organizationId null, sin organization).
        // NO se agrega al JWT firmado a propósito (ver checkInvoicingEnabled.ts):
        // un plan cacheado en el token se desincroniza si el admin lo cambia
        // sin forzar relogin; el backend siempre revalida con query propia.
        plan: user.organization?.plan ?? null,
        // Módulos habilitados por negocio (sdd/modulos-por-negocio): el front
        // los usa para armar el sidebar sin pegarle a GET /api/modules en cada
        // login. Array vacío = "no configurado" → fallback legacy por plan.
        enabledModules: user.organization?.enabledModules ?? [],
      },
    };
  }

  /**
   * BranchIds del usuario leídos de la DB. BranchAssignment no es
   * tenant-scoped (no tiene organizationId), así que el filtro por userId es
   * seguro y global. Solo hint UX (design D3) — nunca se usa para autorizar.
   */
  private static async readUserBranchIds(userId: string): Promise<string[]> {
    const assignments = await basePrisma.branchAssignment.findMany({
      where: { userId },
      select: { branchId: true },
    });
    return assignments.map((a) => a.branchId);
  }

  /**
   * Gate de horario comercial para login/refresh (sdd/business-hours-access):
   * SÓLO roles operativos (VENDEDOR/CASHIER/EMPLOYEE) con organización. Sin
   * BusinessHourSetting → sin restricción. Fuera de horario → error tipado
   * { statusCode: 403, errorCode: "OUTSIDE_BUSINESS_HOURS" } que authController
   * propaga como 403 { error, message } para que el front distinga este caso
   * de un 401 genérico y redirija a la pantalla de bloqueo.
   */
  private static async assertBusinessHoursOpen(user: {
    role: Role;
    organizationId: string | null;
  }) {
    const OPERATIVE_ROLES = ["VENDEDOR", "CASHIER", "EMPLOYEE"];
    if (!user.organizationId || !OPERATIVE_ROLES.includes(user.role)) {
      return;
    }

    const setting = await basePrisma.businessHourSetting.findUnique({
      where: { organizationId: user.organizationId },
    });
    if (!setting) {
      return; // sin config → sin restricción
    }

    const { allowed } = isWithinBusinessHours(
      new Date(),
      setting.timezone,
      setting.days as unknown as DaySetting[],
    );
    if (allowed) {
      return;
    }

    const err: any = new Error(
      "Fuera del horario comercial. El acceso al sistema está disponible solo dentro del horario del comercio.",
    );
    err.statusCode = 403;
    err.errorCode = "OUTSIDE_BUSINESS_HOURS";
    throw err;
  }

  /** Emite un nuevo access token a partir de un refresh token válido. */
  static async refresh(refreshToken: string) {
    let payload: { id: string; type?: string };
    try {
      payload = verifyToken<{ id: string; type?: string }>(refreshToken);
    } catch {
      throw new Error("Refresh token inválido o expirado");
    }
    if (payload.type !== "refresh") {
      throw new Error("El token provisto no es un refresh token");
    }

    const user = await basePrisma.user.findUnique({
      where: { id: payload.id },
      include: { organization: true },
    });
    if (!user || !user.isActive) {
      throw new Error("Usuario no válido");
    }

    // Mismo kill switch que en login (ver comentario ahí): refresh también
    // debe rechazar usuarios de una organización suspendida, si no el access
    // token se sigue renovando indefinidamente sin re-chequear el estado.
    if (user.organizationId && !user.organization?.isActive) {
      throw new Error(
        "Tu organización está suspendida, contactá al administrador.",
      );
    }

    // Mismo gate de horario comercial que en login: el refresh NO debe renovar
    // el access token fuera del horario de la org (el front hoy no usa refresh,
    // esto es future-proofing del contrato server-side).
    await AuthService.assertBusinessHoursOpen(user);

    const accessToken = generateAccessToken({
      id: user.id,
      role: user.role,
      organizationId: user.organizationId,
    });
    return { accessToken };
  }

  static async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await basePrisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new Error("Usuario no encontrado");
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      throw new Error("La contraseña actual es incorrecta");
    }
    if (!newPassword || newPassword.length < 8) {
      throw new Error("La nueva contraseña debe tener al menos 8 caracteres");
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await basePrisma.user.update({
      where: { id: userId },
      data: { password: hashed, mustChangePassword: false },
    });
  }

  /** Devuelve el usuario autenticado + datos de su organización (gates del front: cambio de contraseña, onboarding). */
  static async me(userId: string) {
    const user = await basePrisma.user.findUnique({
      where: { id: userId },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            onboardingCompletedAt: true,
            plan: true,
            paidUntil: true,
            isActive: true,
            // Datos fiscales del emisor (sdd/facturacion-servicios, WS5):
            // el front los usa para el header del PDF de factura estándar.
            // Faltaban acá — me() nunca los devolvía aunque se guardaran.
            taxId: true,
            taxCondition: true,
            address: true,
            ingresosBrutos: true,
            inicioActividades: true,
            enabledModules: true,
          },
        },
      },
    });
    if (!user) {
      throw new Error("Usuario no encontrado");
    }

    const branchIds = await AuthService.readUserBranchIds(userId);

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.name,
      role: user.role,
      organizationId: user.organizationId,
      mustChangePassword: user.mustChangePassword,
      branchIds,
      organization: user.organization,
    };
  }

  // Rate limiter singleton para forgot-password (in-memory, una instancia por proceso).
  // Expuesto como `_rateLimiter` solo para inyección en tests.
  static _rateLimiter: RateLimiter | null = null;

  private static getRateLimiter(): RateLimiter {
    if (!AuthService._rateLimiter) {
      AuthService._rateLimiter = new RateLimiter();
    }
    return AuthService._rateLimiter;
  }

  /**
   * Recuperación de contraseña — paso 1: solicitar reset.
   *
   * - Bloquea roles EMPLOYEE (403: "Contactá a tu administrador")
   * - Rate limit: 3 intentos por email cada 15 min (429)
   * - Email inexistente → mismo 200 genérico (anti-enumeración)
   * - SMTP falla → se loguea, pero el flujo NO se rompe (200 igual)
   */
  static async forgotPassword(email: string) {
    // 1) Rate limit check
    const limiter = AuthService.getRateLimiter();
    if (limiter.isRateLimited(email, 3, 15 * 60 * 1000)) {
      const err: any = new Error(
        "Demasiados intentos. Esperá 15 minutos.",
      );
      err.statusCode = 429;
      throw err;
    }

    // 2) Lookup user
    const user = await basePrisma.user.findUnique({
      where: { email },
    });

    // 3) No user → generic response (no enumeration)
    if (!user) {
      return {
        message:
          "Si el email está registrado, recibirás un enlace de recuperación.",
      };
    }

    // 4) EMPLOYEE gate
    if (user.role === Role.EMPLOYEE) {
      const err: any = new Error(
        "Contactá a tu administrador para restablecer tu contraseña.",
      );
      err.statusCode = 403;
      throw err;
    }

    // 5) Generate token
    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");
    const expiry = new Date(Date.now() + 15 * 60 * 1000); // 15 min

    // 6) Store hashed token
    await basePrisma.user.update({
      where: { id: user.id },
      data: {
        resetToken: hashedToken,
        resetTokenExpiry: expiry,
      },
    });

    // 7) Send email — solo si el usuario tiene email (usuarios con solo username no usan recupero)
    if (!user.email) {
      return {
        message:
          "Si el email está registrado, recibirás un enlace de recuperación.",
      };
    }

    const frontendUrl =
      process.env.FRONTEND_URL || "http://localhost:5173";
    const resetLink = `${frontendUrl}/reset-password?token=${rawToken}`;

    // Nombre de la org o "Pullstok" como fallback para el template
    const orgName =
      (user as any).organization?.name ?? "Pullstok";

    const mail = resetPasswordEmail({
      org: { name: orgName },
      resetLink,
    });

    try {
      await sendMail({
        to: user.email,
        subject: mail.subject,
        html: mail.html,
      });
    } catch (mailError) {
      console.error(
        "[AuthService.forgotPassword] Error enviando email de recuperación:",
        mailError,
      );
      // No propagar: el mail NO debe romper el flujo de negocio
    }

    return {
      message:
        "Si el email está registrado, recibirás un enlace de recuperación.",
    };
  }

  /**
   * Recuperación de contraseña — paso 2: reset con token.
   *
   * - Busca el hash del token en la DB con expiración > now
   * - Usa timingSafeEqual para evitar timing attacks
   * - bcrypt-hashea la nueva contraseña y limpia los campos de reset
   * - No emite JWT ni sesión (el usuario debe loguearse manualmente)
   */
  static async resetPassword(token: string, newPassword: string) {
    // Hash del token recibido
    const hashedToken = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    // Buscar usuario con token válido (no expirado)
    const user = await basePrisma.user.findFirst({
      where: {
        resetToken: hashedToken,
        resetTokenExpiry: { gt: new Date() },
      },
    });

    if (!user) {
      throw new Error("El enlace expiró o no es válido. Pedí uno nuevo.");
    }

    // Timing-safe comparison (belt-and-suspenders sobre el hash match de Prisma)
    if (
      !crypto.timingSafeEqual(
        Buffer.from(hashedToken),
        Buffer.from(user.resetToken!),
      )
    ) {
      throw new Error("El enlace expiró o no es válido. Pedí uno nuevo.");
    }

    // Validate new password length (belt-and-suspenders; Zod ya validó en ruta)
    if (!newPassword || newPassword.length < 8) {
      throw new Error("La nueva contraseña debe tener al menos 8 caracteres");
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update user: new password + clear reset fields
    await basePrisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetToken: null,
        resetTokenExpiry: null,
      },
    });

    return { message: "Contraseña actualizada. Ya podés iniciar sesión." };
  }

  /** SUPERADMIN: crea una organización nueva junto a su usuario ADMIN. */
  static async createOrganizationWithAdmin(params: {
    organizationName: string;
    slug: string;
    adminEmail: string;
    adminPassword: string;
    plan?: Plan;
  }) {
    const { organizationName, slug, adminEmail, adminPassword, plan } = params;

    const existing = await basePrisma.user.findUnique({
      where: { email: adminEmail },
    });
    if (existing) {
      throw new Error("Ya existe un usuario con ese email");
    }

    const hashed = await bcrypt.hash(adminPassword, 10);
    return basePrisma.organization.create({
      data: {
        name: organizationName,
        slug,
        plan: plan ?? Plan.BASICO,
        users: {
          create: {
            email: adminEmail,
            password: hashed,
            role: Role.ADMIN,
            mustChangePassword: true,
          },
        },
      },
      include: {
        users: { select: { id: true, email: true, role: true } },
      },
    });
  }

  /** ADMIN: crea un usuario (empleado o admin) dentro de SU organización. */
  static async createUser(params: {
    organizationId: string;
    email?: string;
    username?: string;
    name?: string;
    phone?: string;
    address?: string;
    password: string;
    role?: Role;
  }) {
    const { organizationId, email, username, name, phone, address, password, role } = params;

    if (email) {
      const existing = await basePrisma.user.findFirst({
        where: { OR: [{ email }, ...(username ? [{ username }] : [])] },
      });
      if (existing) {
        throw new Error(
          existing.email === email
            ? "Ya existe un usuario con ese email"
            : "Ya existe un usuario con ese nombre de usuario",
        );
      }
    } else if (username) {
      const existing = await basePrisma.user.findUnique({
        where: { username },
      });
      if (existing) {
        throw new Error("Ya existe un usuario con ese nombre de usuario");
      }
    }

    const hashed = await bcrypt.hash(password, 10);
    return basePrisma.user.create({
      data: {
        email: email ?? null,
        username: username ?? null,
        name: name ?? null,
        phone: phone ?? null,
        address: address ?? null,
        password: hashed,
        role: role ?? Role.EMPLOYEE,
        organizationId,
        mustChangePassword: false,
      },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        role: true,
        organizationId: true,
      },
    });
  }
}

export default AuthService;

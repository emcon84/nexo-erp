import AuthService from '../../src/services/authServices';
import { basePrisma } from '../../src/config/db';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
} from '../../src/utils/jwtUtils';
import { sendMail } from '../../src/services/mailService';
import { resetPasswordEmail } from '../../src/services/mailTemplates';
import { RateLimiter } from '../../src/services/rateLimiter';

jest.mock('../../src/config/db', () => ({
  basePrisma: {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    branchAssignment: {
      findMany: jest.fn(),
    },
    businessHourSetting: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

jest.mock('../../src/utils/jwtUtils', () => ({
  generateAccessToken: jest.fn(),
  generateRefreshToken: jest.fn(),
  verifyToken: jest.fn(),
}));

jest.mock('../../src/services/mailService', () => ({
  sendMail: jest.fn(),
}));

jest.mock('../../src/services/mailTemplates', () => ({
  resetPasswordEmail: jest.fn(),
}));

jest.mock('../../src/services/rateLimiter', () => ({
  RateLimiter: jest.fn().mockImplementation(() => ({
    isRateLimited: jest.fn(),
    stopCleanup: jest.fn(),
  })),
}));

const mockedPrisma = basePrisma as unknown as {
  user: { findUnique: jest.Mock; findFirst: jest.Mock; update: jest.Mock; create: jest.Mock };
  branchAssignment: { findMany: jest.Mock };
  businessHourSetting: { findUnique: jest.Mock };
};
const mockedBcrypt = bcrypt as unknown as { compare: jest.Mock; hash: jest.Mock };
const mockedGenAccess = generateAccessToken as jest.Mock;
const mockedGenRefresh = generateRefreshToken as jest.Mock;
const mockedVerify = verifyToken as jest.Mock;
const mockedSendMail = sendMail as jest.Mock;
const mockedResetPasswordEmail = resetPasswordEmail as jest.Mock;

const baseUser = {
  id: 'u1',
  email: 'test@example.com',
  username: null,
  password: 'hashed-password',
  role: 'ADMIN',
  organizationId: 'org-1',
  isActive: true,
  mustChangePassword: false,
  organization: { isActive: true },
};

describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('login', () => {
    it('devuelve tokens + datos del usuario en credenciales válidas', async () => {
      mockedPrisma.user.findFirst.mockResolvedValue({ ...baseUser });
      mockedPrisma.branchAssignment.findMany.mockResolvedValue([
        { branchId: 'b-1' },
        { branchId: 'b-2' },
      ]);
      mockedBcrypt.compare.mockResolvedValue(true);
      mockedGenAccess.mockReturnValue('access-token');
      mockedGenRefresh.mockReturnValue('refresh-token');

      const result = await AuthService.login('test@example.com', 'password123');

      expect(mockedPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
        include: { organization: true },
      });
      expect(mockedBcrypt.compare).toHaveBeenCalledWith('password123', 'hashed-password');
      expect(mockedPrisma.branchAssignment.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        select: { branchId: true },
      });
      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: {
          id: 'u1',
          email: 'test@example.com',
          username: null,
          role: 'ADMIN',
          organizationId: 'org-1',
          mustChangePassword: false,
          branchIds: ['b-1', 'b-2'],
          plan: null,
          enabledModules: [],
        },
      });
    });

    it('incluye enabledModules de la organización en el payload del usuario', async () => {
      mockedPrisma.user.findFirst.mockResolvedValue({
        ...baseUser,
        organization: { isActive: true, enabledModules: ['stock', 'ventas'] },
      });
      mockedPrisma.branchAssignment.findMany.mockResolvedValue([]);
      mockedBcrypt.compare.mockResolvedValue(true);
      mockedGenAccess.mockReturnValue('access-token');
      mockedGenRefresh.mockReturnValue('refresh-token');

      const result = await AuthService.login('test@example.com', 'password123');

      expect(result.user.enabledModules).toEqual(['stock', 'ventas']);
    });

    it('lanza "Credenciales inválidas" si el usuario no existe', async () => {
      mockedPrisma.user.findFirst.mockResolvedValue(null);

      await expect(AuthService.login('nadie@example.com', 'x')).rejects.toThrow(
        'Credenciales inválidas',
      );
      expect(mockedBcrypt.compare).not.toHaveBeenCalled();
    });

    it('lanza "Credenciales inválidas" si el usuario está inactivo', async () => {
      mockedPrisma.user.findFirst.mockResolvedValue({ ...baseUser, isActive: false });

      await expect(AuthService.login('test@example.com', 'x')).rejects.toThrow(
        'Credenciales inválidas',
      );
    });

    it('kill switch: rechaza si la organización está suspendida', async () => {
      mockedPrisma.user.findFirst.mockResolvedValue({
        ...baseUser,
        organization: { isActive: false },
      });

      await expect(AuthService.login('test@example.com', 'x')).rejects.toThrow(
        'Tu organización está suspendida, contactá al administrador.',
      );
      expect(mockedBcrypt.compare).not.toHaveBeenCalled();
    });

    it('lanza "Credenciales inválidas" si la contraseña no coincide', async () => {
      mockedPrisma.user.findFirst.mockResolvedValue({ ...baseUser });
      mockedBcrypt.compare.mockResolvedValue(false);

      await expect(AuthService.login('test@example.com', 'mal')).rejects.toThrow(
        'Credenciales inválidas',
      );
      expect(mockedGenAccess).not.toHaveBeenCalled();
    });

    it('login funciona con username', async () => {
      mockedPrisma.user.findFirst.mockResolvedValue({ ...baseUser, username: 'testuser', email: null });
      mockedPrisma.branchAssignment.findMany.mockResolvedValue([]);
      mockedBcrypt.compare.mockResolvedValue(true);
      mockedGenAccess.mockReturnValue('access-token');
      mockedGenRefresh.mockReturnValue('refresh-token');

      const result = await AuthService.login('testuser', 'password123');

      expect(mockedPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { username: 'testuser' },
        include: { organization: true },
      });
      expect(result.user.username).toBe('testuser');
    });

    it('devuelve branchIds vacío si el usuario no tiene BranchAssignments', async () => {
      mockedPrisma.user.findFirst.mockResolvedValue({ ...baseUser });
      mockedPrisma.branchAssignment.findMany.mockResolvedValue([]);
      mockedBcrypt.compare.mockResolvedValue(true);
      mockedGenAccess.mockReturnValue('access-token');
      mockedGenRefresh.mockReturnValue('refresh-token');

      const result = await AuthService.login('test@example.com', 'password123');

      expect(mockedPrisma.branchAssignment.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        select: { branchId: true },
      });
      expect(result.user.branchIds).toEqual([]);
    });
  });

  describe('me', () => {
    it('devuelve el usuario con sus branchIds (hint UX del design D3)', async () => {
      mockedPrisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        organization: { id: 'org-1', name: 'Org A' },
      });
      mockedPrisma.branchAssignment.findMany.mockResolvedValue([
        { branchId: 'b-2' },
        { branchId: 'b-9' },
      ]);

      const result = await AuthService.me('u1');

      expect(mockedPrisma.branchAssignment.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        select: { branchId: true },
      });
      expect(result.id).toBe('u1');
      expect(result.branchIds).toEqual(['b-2', 'b-9']);
    });

    it('devuelve branchIds vacío cuando el usuario no tiene asignaciones', async () => {
      mockedPrisma.user.findUnique.mockResolvedValue({ ...baseUser, organization: null });
      mockedPrisma.branchAssignment.findMany.mockResolvedValue([]);

      const result = await AuthService.me('u1');

      expect(result.branchIds).toEqual([]);
    });

    it('lanza "Usuario no encontrado" si el user no existe', async () => {
      mockedPrisma.user.findUnique.mockResolvedValue(null);

      await expect(AuthService.me('nadie')).rejects.toThrow('Usuario no encontrado');
      expect(mockedPrisma.branchAssignment.findMany).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('emite un nuevo access token con un refresh token válido', async () => {
      mockedVerify.mockReturnValue({ id: 'u1', type: 'refresh' });
      mockedPrisma.user.findUnique.mockResolvedValue({ ...baseUser });
      mockedGenAccess.mockReturnValue('nuevo-access');

      const result = await AuthService.refresh('refresh-valido');

      expect(result).toEqual({ accessToken: 'nuevo-access' });
    });

    it('rechaza si el token provisto no es de tipo refresh', async () => {
      mockedVerify.mockReturnValue({ id: 'u1', type: 'access' });

      await expect(AuthService.refresh('un-access')).rejects.toThrow(
        'El token provisto no es un refresh token',
      );
    });

    it('rechaza si verifyToken lanza (token inválido o expirado)', async () => {
      mockedVerify.mockImplementation(() => {
        throw new Error('expired');
      });

      await expect(AuthService.refresh('roto')).rejects.toThrow(
        'Refresh token inválido o expirado',
      );
    });
  });

  describe('changePassword', () => {
    it('actualiza la contraseña con datos válidos', async () => {
      mockedPrisma.user.findUnique.mockResolvedValue({ ...baseUser });
      mockedBcrypt.compare.mockResolvedValue(true);
      mockedBcrypt.hash.mockResolvedValue('nuevo-hash');

      await AuthService.changePassword('u1', 'vieja1234', 'nueva12345');

      expect(mockedPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { password: 'nuevo-hash', mustChangePassword: false },
      });
    });

    it('rechaza si la contraseña actual es incorrecta', async () => {
      mockedPrisma.user.findUnique.mockResolvedValue({ ...baseUser });
      mockedBcrypt.compare.mockResolvedValue(false);

      await expect(
        AuthService.changePassword('u1', 'mal', 'nueva12345'),
      ).rejects.toThrow('La contraseña actual es incorrecta');
      expect(mockedPrisma.user.update).not.toHaveBeenCalled();
    });

    it('rechaza si la nueva contraseña tiene menos de 8 caracteres', async () => {
      mockedPrisma.user.findUnique.mockResolvedValue({ ...baseUser });
      mockedBcrypt.compare.mockResolvedValue(true);

      await expect(
        AuthService.changePassword('u1', 'vieja1234', 'corta'),
      ).rejects.toThrow('La nueva contraseña debe tener al menos 8 caracteres');
      expect(mockedPrisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('forgotPassword', () => {
    const authService = AuthService as any;

    beforeEach(() => {
      // Reset the rate limiter instance for fresh state each test
      authService._rateLimiter = null;
      jest.clearAllMocks();
    });

    it('(a) ADMIN válido → genera token, lo guarda hasheado, envía email, retorna 200 genérico', async () => {
      const adminUser = {
        ...baseUser,
        role: 'ADMIN',
        email: 'admin@demo.com',
      };
      mockedPrisma.user.findUnique.mockResolvedValue(adminUser);
      mockedPrisma.user.update.mockResolvedValue({ ...adminUser, resetToken: 'hashed-token', resetTokenExpiry: new Date() });
      mockedResetPasswordEmail.mockReturnValue({ subject: 'Reset', html: '<p>reset</p>' });
      mockedSendMail.mockResolvedValue(undefined);

      const result = await AuthService.forgotPassword('admin@demo.com');

      expect(mockedPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'admin@demo.com' },
      });
      // Debe actualizar el user con resetToken y resetTokenExpiry
      expect(mockedPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: {
          resetToken: expect.any(String),
          resetTokenExpiry: expect.any(Date),
        },
      });
      // Debe enviar el email
      expect(mockedSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'admin@demo.com',
          subject: expect.any(String),
          html: expect.any(String),
        }),
      );
      // Respuesta genérica (no revela si el email existe)
      expect(result).toEqual({
        message: 'Si el email está registrado, recibirás un enlace de recuperación.',
      });
    });

    it('(b) email desconocido → retorna el MISMO mensaje genérico, sin efectos colaterales', async () => {
      mockedPrisma.user.findUnique.mockResolvedValue(null);

      const result = await AuthService.forgotPassword('unknown@demo.com');

      expect(result).toEqual({
        message: 'Si el email está registrado, recibirás un enlace de recuperación.',
      });
      expect(mockedPrisma.user.update).not.toHaveBeenCalled();
      expect(mockedSendMail).not.toHaveBeenCalled();
    });

    it('(c) EMPLOYEE → lanza error con statusCode 403', async () => {
      mockedPrisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        role: 'EMPLOYEE',
      });

      let caught: any;
      try {
        await AuthService.forgotPassword('empleado@demo.com');
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeDefined();
      expect(caught.message).toContain('administrador');
      expect(caught.statusCode).toBe(403);
      expect(mockedPrisma.user.update).not.toHaveBeenCalled();
      expect(mockedSendMail).not.toHaveBeenCalled();
    });

    it('(d) rate-limited → lanza error con statusCode 429', async () => {
      mockedPrisma.user.findUnique.mockResolvedValue(baseUser);

      // Inyectar un rate limiter mockeado que ya bloquea
      (AuthService as any)._rateLimiter = {
        isRateLimited: jest.fn().mockReturnValue(true),
        stopCleanup: jest.fn(),
      };

      let caught: any;
      try {
        await AuthService.forgotPassword('admin@demo.com');
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeDefined();
      expect(caught.message).toContain('Demasiados intentos');
      expect(caught.statusCode).toBe(429);
      expect(mockedPrisma.user.findUnique).not.toHaveBeenCalled();
      // Reset internal instance
      (AuthService as any)._rateLimiter = null;
    });

    it('(e) fallo SMTP → igual retorna 200, no propaga el error', async () => {
      mockedPrisma.user.findUnique.mockResolvedValue(baseUser);
      mockedPrisma.user.update.mockResolvedValue({ ...baseUser, resetToken: 'x', resetTokenExpiry: new Date() });
      mockedResetPasswordEmail.mockReturnValue({ subject: 'S', html: 'H' });
      mockedSendMail.mockRejectedValue(new Error('SMTP down'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const result = await AuthService.forgotPassword('admin@demo.com');

      expect(result).toEqual({
        message: 'Si el email está registrado, recibirás un enlace de recuperación.',
      });
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('resetPassword', () => {
    // Pre-compute the SHA-256 hash for the test token so Buffer.from works
    const testToken = 'raw-token-abc123';
    const hashedTestToken = require('crypto')
      .createHash('sha256')
      .update(testToken)
      .digest('hex');

    it('token válido → actualiza password con bcrypt, limpia campos reset, retorna éxito', async () => {
      const userWithToken = {
        ...baseUser,
        resetToken: hashedTestToken,
        resetTokenExpiry: new Date(Date.now() + 600_000), // 10 min en el futuro
      };
      mockedPrisma.user.findFirst.mockResolvedValue(userWithToken);
      mockedBcrypt.hash.mockResolvedValue('new-hash');
      mockedPrisma.user.update.mockResolvedValue({ ...baseUser, password: 'new-hash' });

      const result = await AuthService.resetPassword(testToken, 'newPass123');

      expect(mockedPrisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          resetToken: hashedTestToken,
          resetTokenExpiry: { gt: expect.any(Date) },
        },
      });
      expect(mockedBcrypt.hash).toHaveBeenCalledWith('newPass123', 10);
      expect(mockedPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: {
          password: 'new-hash',
          resetToken: null,
          resetTokenExpiry: null,
        },
      });
      expect(result).toEqual({ message: 'Contraseña actualizada. Ya podés iniciar sesión.' });
    });

    it('token expirado → lanza error con mensaje de expiración', async () => {
      mockedPrisma.user.findFirst.mockResolvedValue(null); // No encuentra token no expirado

      await expect(
        AuthService.resetPassword('expired-token', 'newPass123'),
      ).rejects.toThrow('El enlace expiró o no es válido');
      expect(mockedPrisma.user.update).not.toHaveBeenCalled();
    });

    it('token inválido → lanza error', async () => {
      mockedPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        AuthService.resetPassword('fake-token', 'newPass123'),
      ).rejects.toThrow('El enlace expiró o no es válido');
    });
  });

  describe('business hours gate (sdd/business-hours-access)', () => {
    // Instante fijo: 2026-08-06T18:00:00Z = 15:00 (jueves) en Buenos Aires.
    const SETTING_INSIDE = {
      timezone: 'America/Argentina/Buenos_Aires',
      days: [
        { day: 4, enabled: true, slots: [{ open: '09:00', close: '19:00' }] },
        { day: 0, enabled: false, slots: [{ open: '09:00', close: '19:00' }] },
      ],
    };
    const SETTING_OUTSIDE = {
      timezone: 'America/Argentina/Buenos_Aires',
      days: [
        { day: 4, enabled: true, slots: [{ open: '09:00', close: '12:00' }] },
      ],
    };

    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-08-06T18:00:00.000Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
      // Limpiar implementaciones persistentes (mockReset, NO solo clear): sin
      // esto los mocks de findFirst/findUnique/businessHourSetting seteados acá
      // contaminan los describe posteriores (createUser usa findFirst para
      // detectar duplicados y fallaría con "Ya existe un usuario...").
      mockedPrisma.user.findFirst.mockReset();
      mockedPrisma.user.findUnique.mockReset();
      mockedPrisma.businessHourSetting.findUnique.mockReset();
      mockedVerify.mockReset();
    });

    it('login de rol operativo fuera de horario → typed error 403 OUTSIDE_BUSINESS_HOURS (sin tokens)', async () => {
      mockedPrisma.user.findFirst.mockResolvedValue({
        ...baseUser,
        role: 'VENDEDOR',
      });
      mockedPrisma.businessHourSetting.findUnique.mockResolvedValue(SETTING_OUTSIDE);
      mockedBcrypt.compare.mockResolvedValue(true);

      let caught: any;
      try {
        await AuthService.login('test@example.com', 'password123');
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeDefined();
      expect(caught.statusCode).toBe(403);
      expect(caught.errorCode).toBe('OUTSIDE_BUSINESS_HOURS');
      expect(caught.message).toMatch(/horario del comercio/i);
      expect(mockedGenAccess).not.toHaveBeenCalled();
    });

    it('login de rol operativo dentro de horario → emite tokens normalmente', async () => {
      mockedPrisma.user.findFirst.mockResolvedValue({
        ...baseUser,
        role: 'VENDEDOR',
      });
      mockedPrisma.businessHourSetting.findUnique.mockResolvedValue(SETTING_INSIDE);
      mockedPrisma.branchAssignment.findMany.mockResolvedValue([]);
      mockedBcrypt.compare.mockResolvedValue(true);
      mockedGenAccess.mockReturnValue('access-token');
      mockedGenRefresh.mockReturnValue('refresh-token');

      const result = await AuthService.login('test@example.com', 'password123');

      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
    });

    it('login sin setting configurado → emite tokens (org sin restricción)', async () => {
      mockedPrisma.user.findFirst.mockResolvedValue({
        ...baseUser,
        role: 'EMPLOYEE',
      });
      mockedPrisma.businessHourSetting.findUnique.mockResolvedValue(null);
      mockedPrisma.branchAssignment.findMany.mockResolvedValue([]);
      mockedBcrypt.compare.mockResolvedValue(true);
      mockedGenAccess.mockReturnValue('access-token');
      mockedGenRefresh.mockReturnValue('refresh-token');

      const result = await AuthService.login('test@example.com', 'password123');

      expect(result.accessToken).toBe('access-token');
    });

    it('login de rol NO operativo (ADMIN) → nunca consulta businessHourSetting', async () => {
      mockedPrisma.user.findFirst.mockResolvedValue({ ...baseUser });
      mockedPrisma.branchAssignment.findMany.mockResolvedValue([]);
      mockedBcrypt.compare.mockResolvedValue(true);
      mockedGenAccess.mockReturnValue('access-token');
      mockedGenRefresh.mockReturnValue('refresh-token');

      await AuthService.login('test@example.com', 'password123');

      expect(mockedPrisma.businessHourSetting.findUnique).not.toHaveBeenCalled();
    });

    it('refresh de rol operativo fuera de horario → typed error 403 OUTSIDE_BUSINESS_HOURS', async () => {
      mockedVerify.mockReturnValue({ id: 'u1', type: 'refresh' });
      mockedPrisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        role: 'CASHIER',
      });
      mockedPrisma.businessHourSetting.findUnique.mockResolvedValue(SETTING_OUTSIDE);

      let caught: any;
      try {
        await AuthService.refresh('refresh-valido');
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeDefined();
      expect(caught.statusCode).toBe(403);
      expect(caught.errorCode).toBe('OUTSIDE_BUSINESS_HOURS');
      expect(mockedGenAccess).not.toHaveBeenCalled();
    });

    it('refresh de rol operativo dentro de horario → emite access token', async () => {
      mockedVerify.mockReturnValue({ id: 'u1', type: 'refresh' });
      mockedPrisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        role: 'VENDEDOR',
      });
      mockedPrisma.businessHourSetting.findUnique.mockResolvedValue(SETTING_INSIDE);
      mockedGenAccess.mockReturnValue('nuevo-access');

      const result = await AuthService.refresh('refresh-valido');

      expect(result).toEqual({ accessToken: 'nuevo-access' });
    });

    it('refresh de rol NO operativo (ADMIN) → nunca consulta businessHourSetting', async () => {
      mockedVerify.mockReturnValue({ id: 'u1', type: 'refresh' });
      mockedPrisma.user.findUnique.mockResolvedValue({ ...baseUser });
      mockedGenAccess.mockReturnValue('nuevo-access');

      await AuthService.refresh('refresh-valido');

      expect(mockedPrisma.businessHourSetting.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('createUser — role passthrough (no binary collapse)', () => {
    const mockCreateResult = {
      id: 'new-user-id',
      email: 'newuser@example.com',
      role: 'VENDEDOR',
      organizationId: 'org-1',
    };

    beforeEach(() => {
      jest.clearAllMocks();
      mockedPrisma.user.findUnique.mockResolvedValue(null); // email not taken
      mockedBcrypt.hash.mockResolvedValue('new-hashed-password');
    });

    it('creates user with role VENDEDOR (RED: current code collapses to EMPLOYEE)', async () => {
      mockedPrisma.user.create.mockResolvedValue({
        ...mockCreateResult,
        role: 'VENDEDOR',
      });

      const result = await AuthService.createUser({
        organizationId: 'org-1',
        email: 'vendor@example.com',
        password: 'password123',
        role: 'VENDEDOR' as any,
      });

      // The key assertion: role must be passed through, not collapsed to EMPLOYEE
      expect(mockedPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            role: 'VENDEDOR',
          }),
        }),
      );
      expect(result.role).toBe('VENDEDOR');
    });

    it('creates user with role CASHIER (RED: current code collapses to EMPLOYEE)', async () => {
      mockedPrisma.user.create.mockResolvedValue({
        ...mockCreateResult,
        role: 'CASHIER',
      });

      const result = await AuthService.createUser({
        organizationId: 'org-1',
        email: 'cashier@example.com',
        password: 'password123',
        role: 'CASHIER' as any,
      });

      expect(mockedPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            role: 'CASHIER',
          }),
        }),
      );
      expect(result.role).toBe('CASHIER');
    });

    it('creates user with role MANAGEMENT (RED: current code collapses to EMPLOYEE)', async () => {
      mockedPrisma.user.create.mockResolvedValue({
        ...mockCreateResult,
        role: 'MANAGEMENT',
      });

      const result = await AuthService.createUser({
        organizationId: 'org-1',
        email: 'management@example.com',
        password: 'password123',
        role: 'MANAGEMENT' as any,
      });

      expect(mockedPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            role: 'MANAGEMENT',
          }),
        }),
      );
      expect(result.role).toBe('MANAGEMENT');
    });

    it('creates ADMIN as ADMIN (regression: existing behavior preserved)', async () => {
      mockedPrisma.user.create.mockResolvedValue({
        ...mockCreateResult,
        role: 'ADMIN',
      });

      const result = await AuthService.createUser({
        organizationId: 'org-1',
        email: 'admin2@example.com',
        password: 'password123',
        role: 'ADMIN' as any,
      });

      expect(mockedPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            role: 'ADMIN',
          }),
        }),
      );
      expect(result.role).toBe('ADMIN');
    });

    it('creates EMPLOYEE as EMPLOYEE (regression: existing behavior preserved)', async () => {
      mockedPrisma.user.create.mockResolvedValue({
        ...mockCreateResult,
        role: 'EMPLOYEE',
      });

      const result = await AuthService.createUser({
        organizationId: 'org-1',
        email: 'employee2@example.com',
        password: 'password123',
        role: 'EMPLOYEE' as any,
      });

      expect(mockedPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            role: 'EMPLOYEE',
          }),
        }),
      );
      expect(result.role).toBe('EMPLOYEE');
    });

    it('rejects duplicate email', async () => {
      mockedPrisma.user.findFirst.mockResolvedValue({ id: 'existing-id', email: 'taken@example.com' });

      await expect(
        AuthService.createUser({
          organizationId: 'org-1',
          email: 'taken@example.com',
          password: 'password123',
          role: 'EMPLOYEE' as any,
        }),
      ).rejects.toThrow('Ya existe un usuario con ese email');
      expect(mockedPrisma.user.create).not.toHaveBeenCalled();
    });
  });
});

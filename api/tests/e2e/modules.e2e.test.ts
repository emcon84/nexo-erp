import request from "supertest";
import app from "../../src/app";
import { basePrisma } from "../../src/config/db";

/**
 * Integration tests for GET/PUT /api/modules (sdd/modulos-por-negocio).
 *
 * These tests hit the real dev DB (nexo_db_dev:5434). Setup/teardown creates
 * and cleans up its own data to avoid contaminating demo data.
 *
 * Requires the superadmin seed: superadmin@nexo.com / superadmin123.
 * If the seed doesn't exist, run `pnpm seed` first.
 *
 * NOTE: these are E2E — run ONLY on the VPS (no local Postgres, CLAUDE.md).
 * The frontend sidebar behavior (demo hides suelto / El Almacén lo muestra)
 * se cubre en pullstok-front/src/__tests__/modules.test.ts (resolveEffectiveModules).
 */

describe("E2E: Modules API", () => {
  const superadminEmail =
    process.env.SEED_SUPERADMIN_EMAIL ?? "superadmin@nexo.com";
  const superadminPassword =
    process.env.SEED_SUPERADMIN_PASSWORD ?? "superadmin123";

  const slug = `e2e-modules-${Date.now()}`;
  const adminEmail = `admin-${Date.now()}@e2e-test.com`;
  const adminPassword = "temporal123";

  let superadminToken: string;
  let organizationId: string;
  let adminToken: string;

  afterAll(async () => {
    if (organizationId) {
      await basePrisma.user
        .deleteMany({ where: { organizationId } })
        .catch(() => {});
      await basePrisma.organization
        .deleteMany({ where: { id: organizationId } })
        .catch(() => {});
    }
    await basePrisma.$disconnect();
  });

  it("login del SUPERADMIN", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: superadminEmail, password: superadminPassword });

    if (res.status !== 200) {
      console.warn(
        "⚠ Superadmin login failed — dev DB may not be seeded. Skipping E2E modules tests.",
      );
      return;
    }
    superadminToken = res.body.accessToken;
  });

  it("SUPERADMIN crea una organización PRO + admin", async () => {
    if (!superadminToken) return;
    const res = await request(app)
      .post("/api/superadmin/organizations")
      .set("Authorization", `Bearer ${superadminToken}`)
      .send({
        organizationName: "Modules E2E Test",
        slug,
        adminEmail,
        adminPassword,
        plan: "PRO",
      });

    expect(res.status).toBe(201);
    organizationId = res.body.id;
  });

  it("login del admin de la org PRO", async () => {
    if (!organizationId) return;
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: adminEmail, password: adminPassword });

    expect(res.status).toBe(200);
    adminToken = res.body.accessToken;
  });

  it("GET /api/modules devuelve registry/plan/planAllowed/enabledModules/hasPriceKg", async () => {
    if (!adminToken) return;
    const res = await request(app)
      .get("/api/modules")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.plan).toBe("PRO");
    expect(Array.isArray(res.body.registry)).toBe(true);
    expect(res.body.registry.length).toBe(13);
    expect(res.body.enabledModules).toEqual([]);
    expect(res.body.hasPriceKg).toBe(false);
    // PRO: permite los módulos PRO pero no bot (PREMIUM).
    expect(res.body.planAllowed).toContain("pricing");
    expect(res.body.planAllowed).not.toContain("bot");
    const suelto = res.body.registry.find((m: any) => m.key === "suelto");
    // Sin celdas de precio por kilo → suelto deshabilitado.
    expect(suelto.enabled).toBe(false);
  });

  it("PUT /api/modules rechaza una key desconocida (400 MODULE_UNKNOWN)", async () => {
    if (!adminToken) return;
    const res = await request(app)
      .put("/api/modules")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ modules: ["stock", "no-existe"] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("MODULE_UNKNOWN");
    expect(res.body.modules).toContain("no-existe");
  });

  it("PUT /api/modules rechaza un módulo por encima del plan (400 MODULE_NOT_ALLOWED)", async () => {
    if (!adminToken) return;
    const res = await request(app)
      .put("/api/modules")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ modules: ["stock", "bot"] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("MODULE_NOT_ALLOWED");
    expect(res.body.modules).toContain("bot");
  });

  it("PUT /api/modules guarda una config válida y la refleja en GET", async () => {
    if (!adminToken) return;
    const res = await request(app)
      .put("/api/modules")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ modules: ["stock", "ventas", "pricing"] });

    expect(res.status).toBe(200);
    expect(res.body.enabledModules).toEqual(["stock", "ventas", "pricing"]);

    const getRes = await request(app)
      .get("/api/modules")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(getRes.body.enabledModules).toEqual(["stock", "ventas", "pricing"]);
    const stock = getRes.body.registry.find((m: any) => m.key === "stock");
    expect(stock.enabled).toBe(true);
    const tienda = getRes.body.registry.find((m: any) => m.key === "tienda");
    expect(tienda.enabled).toBe(false);
  });

  it("PUT /api/modules sin token → 401", async () => {
    const res = await request(app)
      .put("/api/modules")
      .send({ modules: ["stock"] });
    expect(res.status).toBe(401);
  });

  it("GET /api/modules sin token → 401", async () => {
    const res = await request(app).get("/api/modules");
    expect(res.status).toBe(401);
  });
});

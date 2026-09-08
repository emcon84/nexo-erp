import { Router } from "express";
import { authenticateJWT, requireRole } from "../middlewares/authMiddleware";
import { validate } from "../middlewares/validate";
import { updateModulesSchema } from "../validation/schemas";
import { getModules, updateModules } from "../controllers/moduleController";

// Módulos por negocio (sdd/modulos-por-negocio). GET: cualquier rol autenticado
// (el front lo usa para armar el sidebar). PUT: ADMIN/MANAGEMENT (gating por
// plan-cap se hace en el controller con MODULE_REGISTRY).
const router = Router();

router.get("/", authenticateJWT, getModules);
router.put(
  "/",
  authenticateJWT,
  requireRole("ADMIN", "MANAGEMENT"),
  validate(updateModulesSchema),
  updateModules,
);

export default router;

import { Router } from "express";
import productRoutes from "./productRoutes";
import authRoutes from "./authRoutes";
import superadminRoutes from "./superadminRoutes";
import userRoutes from "./userRoutes";
import customerRoutes from "./customerRoutes";
import orderRoutes from "./orderRoutes";
import quotationRoutes from "./quotationRoutes";
import receiptRoutes from "./receiptRoutes";
import uploadRoutes from "./cloudinaryRoutes";
import salesRoutes from "./salesRoutes";
import healthRoutes from "./healthRoutes";
import organizationRoutes from "./organizationRoutes";
import categoryRoutes from "./categoryRoutes";
import onboardingRoutes from "./onboardingRoutes";
import storeRoutes from "./store";
import storeSettingsRoutes from "./storeSettingsRoutes";
import invoiceRoutes from "./invoiceRoutes";
import chatRoutes from "./chatRoutes";
import botRoutes from "./botRoutes";
import branchRoutes from "./branchRoutes";
import brandingRoutes from "./brandingRoutes";
import backupRoutes from "./backupRoutes";
import businessHoursRoutes from "./businessHoursRoutes";
import pricingRoutes from "./pricingRoutes";
import priceListRoutes from "./priceListRoutes";
import providerRoutes from "./providerRoutes";
import priceKgTypeRoutes from "./priceKgTypeRoutes";
import priceKgBrandRoutes from "./priceKgBrandRoutes";
import priceKgPlanRoutes from "./priceKgPlanRoutes";
import priceKgReviewRoutes, {
  priceKgProductsRouter,
} from "./priceKgReviewRoutes";
import looseStockRoutes from "./looseStockRoutes";
import arcaRoutes from "./arcaRoutes";
import cashSessionRoutes from "./cashSessionRoutes";
import landingChatRoutes from "./landingChatRoutes";
import whatsappRoutes from "./whatsappRoutes";
import whatsappOrderRoutes from "./whatsappOrderRoutes";
import moduleRoutes from "./moduleRoutes";

const router = Router();

// Router público de la tienda online: sin authenticateJWT (resuelve tenant
// por slug de subdominio, ver tenantBySlug). Montado antes/separado de las
// rutas autenticadas para que quede explícito que no comparte la cadena JWT.
router.use("/store", storeRoutes);

router.use("/auth", authRoutes);
router.use("/superadmin", superadminRoutes);
router.use("/users", userRoutes);
router.use("/image", uploadRoutes);
router.use("/products", productRoutes);
router.use("/sales", salesRoutes);
router.use("/customers", customerRoutes);
router.use("/orders", orderRoutes);
router.use("/quotations", quotationRoutes);
router.use("/receipts", receiptRoutes);
router.use("/health", healthRoutes);
router.use("/organizations", organizationRoutes);
router.use("/categories", categoryRoutes);
router.use("/onboarding", onboardingRoutes);
router.use("/store-settings", storeSettingsRoutes);
router.use("/invoices", invoiceRoutes);
router.use("/chat", chatRoutes);
router.use("/bot", botRoutes);
router.use("/branches", branchRoutes);
router.use("/app-branding", brandingRoutes);
router.use("/backups", backupRoutes);
router.use("/business-hours", businessHoursRoutes);
router.use("/pricing-settings", pricingRoutes);
router.use("/price-lists", priceListRoutes);
router.use("/providers", providerRoutes);
router.use("/price-kg-types", priceKgTypeRoutes);
router.use("/price-kg-brands", priceKgBrandRoutes);
router.use("/price-kg-plan", priceKgPlanRoutes);
router.use("/price-kg-review", priceKgReviewRoutes);
router.use("/price-kg-products", priceKgProductsRouter);
router.use("/loose-stock", looseStockRoutes);
router.use("/cash-sessions", cashSessionRoutes);
router.use("/landing-chat", landingChatRoutes);
// Público SIN auth (webhook Kapso): resuelve org por slug y verifica la firma
// en el controller. Mismo espíritu que /store y /landing-chat.
router.use("/whatsapp", whatsappRoutes);
// Borradores de pedido de WhatsApp (FASE 3): autenticado, los usa el ERP.
router.use("/whatsapp-orders", whatsappOrderRoutes);
router.use("/modules", moduleRoutes);
router.use("/", arcaRoutes);

export default router;

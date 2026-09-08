import { z } from "zod";
import { isValidCuit } from "../services/arcaCalc";

// ---------- Auth ----------
export const loginSchema = z.object({
  email: z.string().min(1, "Email o usuario es requerido"),
  password: z.string().min(1, "La contraseña es requerida"),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "La contraseña actual es requerida"),
  newPassword: z
    .string()
    .min(8, "La nueva contraseña debe tener al menos 8 caracteres"),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, "refreshToken requerido"),
});

// ---------- Password Recovery ----------
export const forgotPasswordSchema = z.object({
  email: z.string().email("Email inválido"),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Token requerido"),
  newPassword: z
    .string()
    .min(8, "La contraseña debe tener al menos 8 caracteres"),
});

// ---------- Organización ----------
export const updateOrganizationSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  taxId: z.string().optional(),
  taxCondition: z.string().optional(),
  ingresosBrutos: z.string().optional(),
  inicioActividades: z.string().optional(),
  industry: z.enum(["FERRETERIA", "KIOSCO", "INDUMENTARIA", "ALMACEN", "OTHER"]).optional(),
});

// ---------- Categorías ----------
export const createCategoriesSchema = z.object({
  names: z.array(z.string().min(1)).min(1, "Debe enviar al menos una categoría"),
  parentId: z.string().uuid().optional(),
});
export const createCategorySchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  parentId: z.string().uuid().optional(),
});
export const updateCategorySchema = z.object({
  name: z.string().min(1, "El nombre es requerido").optional(),
  parentId: z.string().uuid().nullable().optional(),
});

// ---------- Variant Definitions ----------
export const createVariantSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  sortOrder: z.number().int().optional(),
});
export const updateVariantSchema = z.object({
  name: z.string().min(1, "El nombre es requerido").optional(),
  sortOrder: z.number().int().optional(),
});

// ---------- Variant Options ----------
export const createVariantOptionSchema = z.object({
  value: z.string().min(1, "El valor es requerido"),
  sortOrder: z.number().int().optional(),
});
export const updateVariantOptionSchema = z.object({
  value: z.string().min(1, "El valor es requerido").optional(),
  sortOrder: z.number().int().optional(),
});

// ---------- Plataforma / usuarios ----------
export const createOrganizationSchema = z.object({
  organizationName: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "slug: solo minúsculas, números y guiones"),
  adminEmail: z.email(),
  adminPassword: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
  plan: z.enum(["BASICO", "PRO", "PREMIUM"]).optional(),
});

export const updateOrganizationPlanSchema = z.object({
  plan: z.enum(["BASICO", "PRO", "PREMIUM"]),
});

export const registerBillingPaymentSchema = z.object({
  action: z.literal("pay"),
});

const orgRoles = ["ADMIN", "EMPLOYEE", "VENDEDOR", "CASHIER", "MANAGEMENT"] as const;

export const createUserSchema = z
  .object({
    email: z.string().email().optional(),
    username: z
      .string()
      .min(3, "El usuario debe tener al menos 3 caracteres")
      .regex(
        /^[a-z0-9._-]+$/,
        "Usuario: solo minúsculas, números, puntos, guiones y guiones bajos",
      )
      .optional(),
    name: z.string().optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
    password: z
      .string()
      .min(8, "La contraseña debe tener al menos 8 caracteres"),
    role: z.enum(orgRoles).optional(),
    branchIds: z.array(z.string()).optional(),
  })
  .refine((data) => data.email || data.username, {
    message: "Se requiere email o nombre de usuario",
    path: ["email"],
  })
  .refine(
    (data) => {
      // Si se proporciona email, validar que sea un email real
      if (data.email && !data.email.includes("@")) {
        return false;
      }
      return true;
    },
    { message: "Email inválido", path: ["email"] },
  );

// SUPERADMIN create user: same as createUserSchema but role is explicit (no SUPERADMIN)
export const superadminCreateUserSchema = createUserSchema;

// ---------- Productos ----------
// Alta manual single (form de la UI): exige categoryId real, elegido de un
// <select> poblado con GET /categories. El controller valida que pertenezca a
// la organización actual antes de crear el producto (decisión #467 — evita
// que texto libre ensucie el catálogo y evita fuga cross-tenant de categoryId).
export const createProductSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  price: z.coerce.number().nonnegative("El precio no puede ser negativo"),
  code: z.string().optional(), // Código de barras / SKU
  barcode: z.string().nullable().optional(), // EAN-13 / UPC escaneado
  description: z.string().optional(),
  categoryId: z.string().min(1, "La categoría es requerida"),
  image: z.string().optional(),
  quantity: z.coerce.number().int().nonnegative("La cantidad no puede ser negativa"),
  // Visibilidad en la tienda online (WS4). Opcional en alta/edición general;
  // el toggle dedicado de la UI usa publishProductSchema (PATCH /publish).
  publishedToStore: z.boolean().optional(),
  // Variant option IDs (categories-variants-redesign). Array de UUIDs de
  // CategoryVariantOption. El controller valida pertenencia a la categoría.
  variantOptionIds: z.array(z.string().uuid()).optional(),
  // Venta suelta (sdd/venta-alimento-suelto B-01/A-02): opcionales en el alta.
  // No hay recompute en create (regla de staleness B-05) — pesan en el PUT.
  // nullable: el drawer envía null cuando el operador los deja vacíos.
  weightKg: z.coerce.number().positive("El peso debe ser mayor a 0").multipleOf(0.01).nullable().optional(),
  bulkFactor: z.coerce.number().positive("El factor debe ser mayor a 0").multipleOf(0.01).nullable().optional(),
  // Multi-pack por unidad (sdd/venta-por-unidad-multpack): cuántas unidades
  // vienen por caja. Entero ≥ 0, opcional en el alta (ausente = box-only).
  // Por convención un pack tiene >= 1 unidad; la elegibilidad para venta
  // unitaria se define SIEMPRE en el server (unitsPerBox > 1), acá solo se
  // valida la forma (entero no negativo).
  unitsPerBox: z.coerce.number().int("unitsPerBox debe ser un entero").nonnegative("unitsPerBox no puede ser negativo").optional(),
});
// En edición, categoryId puede venir null: un producto sin categoría es válido
// (la FK es nullable en la DB). createProductSchema lo exige string min(1), así
// que lo sobrescribimos para aceptar null (desasignar) o string válido.
export const updateProductSchema = createProductSchema.partial().extend({
  categoryId: z
    .string()
    .min(1, "La categoría es requerida")
    .nullable()
    .optional(),
  variantOptionIds: z.array(z.string().uuid()).optional(),
  // bulkFactor null = usar el factor por defecto de la org (B-01/A-02).
  bulkFactor: z.coerce
    .number()
    .positive("El factor debe ser mayor a 0")
    .multipleOf(0.01)
    .nullable()
    .optional(),
  // priceKgSuelto editable manualmente (decisión: "manual gana, vacío = automático").
  // Número = precio por kg fijado a mano (se marca priceKgSueltoManual=true).
  // null = volver al cálculo automático price/weightKg×factor (flag=false).
  // ausente = no tocar el valor almacenado ni el flag.
  priceKgSuelto: z.coerce.number().nonnegative("El precio por kg no puede ser negativo").multipleOf(0.01).nullable().optional(),
  // Multi-pack por unidad (sdd/venta-por-unidad-multpack): en edición se permite
  // null (limpiar → box-only legacy). Entero ≥ 0.
  unitsPerBox: z.coerce.number().int("unitsPerBox debe ser un entero").nonnegative("unitsPerBox no puede ser negativo").nullable().optional(),
});

// Toggle dedicado "Publicar en tienda" (WS4 — UI de Tienda/listado de
// productos). Separado de updateProductSchema porque es una acción de un
// solo campo, no una edición general del producto.
export const publishProductSchema = z.object({
  publishedToStore: z.boolean(),
});

// Bulk JSON / CSV: sigue con `category` (nombre, texto libre) — find-or-create
// vía resolveCategoryId en productsService.ts. No tiene UI de dropdown.
const bulkProductSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  price: z.coerce.number().nonnegative("El precio no puede ser negativo"),
  description: z.string().optional(),
  category: z.string().min(1, "La categoría es requerida"),
  image: z.string().optional(),
  quantity: z.coerce.number().int().nonnegative("La cantidad no puede ser negativa"),
  variantOptionIds: z.array(z.string().uuid()).optional(),
});
export const bulkProductsSchema = z.array(bulkProductSchema).min(1);

// ---------- Clientes ----------
export const createCustomerSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  email: z.email().or(z.literal("")).optional(),
  phone: z.string().optional(),
  taxId: z.string().optional(),
  taxCondition: z.string().optional(),
  address: z.string().optional(),
});
export const updateCustomerSchema = createCustomerSchema.partial();

// ---------- Ventas ----------
// saleMode (sdd/venta-alimento-suelto B-08): opcional en el payload —
// ausente = legado BOLSA_CERRADA. superRefine aplica las reglas por modo:
// BOLSA_CERRADA exige cantidad entera (bolsa física) + productId; POR_PESO/
// POR_MONTO exigen decimal <= 2dp (kg o monto, B-06/B-07) y una referencia a
// la línea: loosePriceId (celda de la planilla, loose-lines-stock) o productId
// (backwards-compat). Discriminated-union rechazada: rompe backward-compat con
// payloads legacy sin saleMode (D7).
const saleProductSchema = z.object({
  // Opcional: los renglones sueltos desde la planilla mandan loosePriceId sin
  // productId físico (SaleItem.productId null en la DB).
  productId: z.string().min(1).optional(),
  name: z.string().optional(),
  // Celda de la planilla que se vende suelta (loose-lines-stock).
  loosePriceId: z.string().min(1).optional(),
  // Nombre de la línea suelta (fallback server: "MARCA · TIPO").
  looseName: z.string().optional(),
  quantity: z.coerce.number().positive("La cantidad debe ser mayor a 0"),
  price: z.coerce.number().nonnegative(),
  category: z.string().optional(),
  saleMode: z
    .enum(["BOLSA_CERRADA", "POR_PESO", "POR_MONTO", "POR_UNIDAD"], {
      message: "saleMode inválido",
    })
    .default("BOLSA_CERRADA"),
}).superRefine((item, ctx) => {
  const mode = item.saleMode ?? "BOLSA_CERRADA";
  if (mode === "BOLSA_CERRADA" || mode === "POR_UNIDAD") {
    if (!item.productId) {
      ctx.addIssue({
        code: "custom",
        path: ["productId"],
        message: "Una venta de bolsa cerrada / por unidad requiere un producto",
      });
    }
    if (!Number.isInteger(item.quantity)) {
      ctx.addIssue({
        code: "custom",
        path: ["quantity"],
        message: "La cantidad debe ser un número entero (bolsa cerrada / por unidad)",
      });
    }
    return;
  }
  // POR_PESO / POR_MONTO: la línea se identifica por loosePriceId o productId.
  if (!item.loosePriceId && !item.productId) {
    ctx.addIssue({
      code: "custom",
      path: ["productId"],
      message:
        "Las ventas sueltas requieren loosePriceId o productId para identificar la línea",
    });
  }
  // <= 2 decimales (multipleOf 0.01) y > 0 (ya garantizado por .positive()).
  if (Math.round(item.quantity * 100) !== item.quantity * 100) {
    ctx.addIssue({
      code: "custom",
      path: ["quantity"],
      message: "La cantidad suelta admite hasta 2 decimales",
    });
  }
});
// Medio de pago de una venta (sdd/caja-apertura-cierre). La suma de
// payments[].amount DEBE ser igual al total calculado server-side (nunca se
// confía en un total enviado por el cliente). Solo EFECTIVO suma al arqueo.
export const paymentSchema = z.object({
  method: z.enum(
    ["EFECTIVO", "TARJETA_CREDITO", "TARJETA_DEBITO", "TRANSFERENCIA", "QR"],
    { message: "Método de pago inválido" },
  ),
  amount: z.coerce
    .number()
    .positive("El monto debe ser mayor a 0")
    .multipleOf(0.01, "El monto admite hasta 2 decimales"),
});

export const createSaleSchema = z.object({
  products: z.array(saleProductSchema).min(1, "La venta debe tener al menos un producto"),
  // Opcional: si la venta se genera procesando un pedido de la tienda online,
  // apunta a esa Order. La venta la marca COMPLETED y dispara el mail de
  // "compra confirmada" al cliente (ver salesService.createSale).
  orderId: z.string().min(1).optional(),
  // Desglose de medios de pago (sdd/caja-apertura-cierre R6/R7). Opcional:
  // ventas legacy/admin sin payments siguen funcionando (backward-compat).
  // La suma == total se valida server-side. Se rechazan métodos duplicados.
  payments: z
    .array(paymentSchema)
    .optional()
    .superRefine((payments, ctx) => {
      if (!payments) return;
      const seen = new Set<string>();
      payments.forEach((p, i) => {
        if (seen.has(p.method)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["payments", i, "method"],
            message: "Método de pago duplicado en la lista",
          });
        }
        seen.add(p.method);
      });
    }),
  // CashSession a la que se asocia la venta (sdd/caja-apertura-cierre R8).
  cashSessionId: z.string().min(1).optional(),
  // Descuento porcentual a nivel venta (sdd/venta-descuento): 0..100. Ausente
  // = 0 = sin descuento (backward-compat). El server materializa el monto en $
  // y repondera totalAmount = subtotal − descuento.
  discountPct: z.coerce
    .number()
    .min(0, "El descuento no puede ser menor a 0")
    .max(100, "El descuento no puede superar el 100%")
    .optional(),
});

// ---------- Caja (sdd/caja-apertura-cierre) ----------
// Apertura de caja. branchId/openingAmount/observations opcionales: los
// CASHIER/VENDEDOR usan su sucursal asignada (el server la resuelve);
// ADMIN/MANAGEMENT lo mandan explícito (si falta → INVALID_BRANCH).
export const openCashSessionSchema = z
  .object({
    branchId: z.string().min(1).optional(),
    openingAmount: z.coerce
      .number()
      .nonnegative("El fondo inicial no puede ser negativo")
      .multipleOf(0.01, "El monto admite hasta 2 decimales")
      .optional(),
    observations: z.string().optional(),
  })
  .strip();

// Cierre/arqueo. closingByMethod es un record método → monto con al menos 1
// entrada (conteo real por método). closingAmount opcional (conteo total).
const PAYMENT_METHODS = [
  "EFECTIVO",
  "TARJETA_CREDITO",
  "TARJETA_DEBITO",
  "TRANSFERENCIA",
  "QR",
] as const;

export const closeCashSessionSchema = z
  .object({
    closingByMethod: z
      .record(
        z.string(),
        z.coerce
          .number()
          .nonnegative("El monto no puede ser negativo")
          .multipleOf(0.01, "El monto admite hasta 2 decimales"),
      )
      .refine((obj) => Object.keys(obj ?? {}).length >= 1, {
        message: "Debe enviar al menos un método con su conteo",
      })
      .superRefine((obj, ctx) => {
        for (const key of Object.keys(obj ?? {})) {
          if (!(PAYMENT_METHODS as readonly string[]).includes(key)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["closingByMethod", key],
              message: "Método de pago inválido",
            });
          }
        }
      }),
    closingAmount: z.coerce
      .number()
      .nonnegative("El monto no puede ser negativo")
      .multipleOf(0.01, "El monto admite hasta 2 decimales")
      .optional(),
    observations: z.string().optional(),
  })
  .strip();

// Query de listado de cajas: filtros opcionales por status/branchId.
export const cashSessionQuerySchema = z
  .object({
    status: z.enum(["OPEN", "CLOSED"]).optional(),
    branchId: z.string().min(1).optional(),
  })
  .strip();

// ---------- Órdenes ----------
const orderProductSchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().int().positive(),
  price: z.coerce.number().nonnegative(),
});
export const createOrderSchema = z.object({
  // customer opcional: el flujo de venta de mostrador (VendorDashboard) guarda
  // pedidos sin cliente cargado; el controller resuelve el genérico
  // "Consumidor final" de la org. Los flujos ERP (Orders view / presupuesto)
  // siempre mandan customer.
  customer: z.string().min(1, "El cliente es requerido").optional(),
  products: z.array(orderProductSchema).optional(),
  totalAmount: z.coerce.number().optional(),
  type: z.enum(["sale", "purchase"]),
  quotationId: z.string().nullable().optional(),
  // Sucursal del flujo vendor (VendorDashboard). null en pedidos ERP org-wide.
  branchId: z.string().optional(),
});
export const updateOrderStatusSchema = z.object({
  status: z.preprocess(
    (v) => (typeof v === "string" ? v.toUpperCase() : v),
    z.enum(["PENDING", "COMPLETED", "CANCELLED"]),
  ),
});
export const updateOrderSchema = z.object({
  products: z.array(orderProductSchema).min(1),
  totalAmount: z.coerce.number(),
  customer: z.string().optional(),
});

// ---------- Borradores de pedido de WhatsApp (FASE 3) ----------
// Aprobación de un borrador: el vendedor arma los productos reales en el ERP y
// el backend crea el Order (source WHATSAPP) + marca el draft APPROVED.
export const approveDraftSchema = z.object({
  products: z.array(orderProductSchema).min(1, "Debe incluir al menos un producto"),
  totalAmount: z.coerce.number().nonnegative("El total no puede ser negativo"),
});

// Envío de confirmación al cliente por WhatsApp (FASE 6): el front manda el texto
// (o deja que el server lo arme). Message requerido, no vacío, cap 4096.
export const sendConfirmationSchema = z.object({
  message: z
    .string()
    .min(1, "El mensaje no puede estar vacío")
    .max(4096, "El mensaje no puede superar los 4096 caracteres"),
});

// ---------- Presupuestos ----------
const quotationProductSchema = z.object({
  product: z.string().min(1),
  quantity: z.coerce.number().int().positive(),
  price: z.coerce.number().nonnegative(),
});
export const createQuotationSchema = z.object({
  customer: z.string().min(1, "El cliente es requerido"),
  products: z.array(quotationProductSchema).min(1),
  totalAmount: z.coerce.number(),
  validUntil: z.string().min(1),
});
export const updateQuotationSchema = z.object({
  products: z.array(quotationProductSchema).min(1),
  totalAmount: z.coerce.number(),
  validUntil: z.string().min(1),
});

// ---------- Comprobantes ----------
export const createReceiptSchema = z.object({
  relatedDocument: z.string().min(1),
});

// ---------- Facturación de servicios ----------
// Conceptos libres (sin productId): a diferencia de Sale/Quotation, una
// Invoice factura servicios, no productos de stock.
export const invoiceItemSchema = z.object({
  description: z.string().min(1, "La descripción es requerida"),
  quantity: z.coerce.number().positive("La cantidad debe ser mayor a 0"),
  unitPrice: z.coerce.number().nonnegative(),
  taxRate: z.coerce.number().nonnegative().default(21),
});
export const createInvoiceSchema = z.object({
  customerId: z.string().min(1, "El cliente es requerido"),
  items: z.array(invoiceItemSchema).min(1, "La factura debe tener al menos un ítem"),
  dueDate: z.string().min(1).optional(),
  notes: z.string().optional(),
  // Sucursal emisora (sdd/sucursales-pv-facturacion R3). Opcional: null/ausente
  // → la emisión cae al fallback (casa central / PV global de ArcaSetting).
  branchId: z.string().optional(),
});
export const updateInvoiceSchema = z.object({
  customerId: z.string().min(1).optional(),
  items: z.array(invoiceItemSchema).min(1, "La factura debe tener al menos un ítem"),
  dueDate: z.string().min(1).optional(),
  notes: z.string().optional(),
  branchId: z.string().optional(),
});

// ---------- Facturar desde venta ----------
// Body del endpoint POST /sales/:saleId/invoice. Los ítems se mapean de la
// venta (SaleItem → InvoiceLineInput con taxRate 21%); el body solo pide
// el cliente de facturación, vencimiento opcional y notas.
// customerId OPCIONAL desde sdd/arca-facturacion-electronica (spec 6.1): la
// Factura B de mostrador sin identificar va con DocTipo 99 / DocNro 0 (sin
// Customer asociado). Sin ARCA configurada el flujo interno no cambia.
export const createSaleInvoiceSchema = z.object({
  customerId: z.string().min(1).optional(),
  dueDate: z.string().min(1).optional(),
  notes: z.string().optional(),
});

// ---------- Tienda online (checkout público) ----------
// Sin precios en el payload: el endpoint SIEMPRE recalcula desde la DB (ver
// storeController.checkout). El cliente solo manda productId + cantidad.
const checkoutItemSchema = z.object({
  productId: z.string().min(1, "productId es requerido"),
  quantity: z.coerce.number().int().positive("La cantidad debe ser mayor a 0"),
});
export const checkoutSchema = z.object({
  customer: z.object({
    name: z.string().min(1, "El nombre es requerido"),
    email: z.email("Email inválido"),
    phone: z.string().min(1, "El teléfono es requerido"),
  }),
  items: z.array(checkoutItemSchema).min(1, "El carrito está vacío"),
});

// ---------- Tienda online (config ERP, WS4) ----------
// Badges configurables de confianza (envío gratis, garantía, etc.) — máximo 3
// (decisión de diseño: barra de confianza, no reviews/stars).
const storeBadgeSchema = z.object({
  title: z.string().min(1, "El título es requerido"),
  subtitle: z.string().min(1, "El subtítulo es requerido"),
});
export const updateStoreSettingsSchema = z.object({
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color inválido (formato #rrggbb)")
    .optional(),
  logoUrl: z.string().url("URL de logo inválida").nullable().optional(),
  bannerUrl: z.string().url("URL de banner inválida").nullable().optional(),
  tagline: z.string().nullable().optional(),
  showNewsletter: z.boolean().optional(),
  showBanner: z.boolean().optional(),
  badges: z.array(storeBadgeSchema).max(3, "Máximo 3 badges").nullable().optional(),
  contactEmail: z.email("Email inválido").nullable().optional(),
  contactPhone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  // Tienda online publicada: false = borrador. La tienda pública no sirve
  // catálogo/checkout hasta que el admin la encienda (gate STORE_NOT_PUBLISHED).
  isPublished: z.boolean().optional(),
  // Sucursal que la tienda online usa para disponibilidad/checkout (spec S1).
  // null = sin configurar → fallback casa central. La columna y el controller
  // llegan en PR 4; el campo queda aceptado en el schema desde acá para no
  // romper contratos del body (Zod lo descarta si viene de otro lado).
  storeBranchId: z.string().nullable().optional(),
});

// ---------- Chat cliente↔operador (FASE A) ----------
// Inicio de conversación desde la tienda pública: el visitante se presenta con
// nombre + email (sin cuenta). El token de invitado se emite en la respuesta.
export const chatStartSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  email: z.email("Email inválido"),
});
// Envío de un mensaje (tanto guest como operador). El conversationId NUNCA
// viaja en el body: sale del token (guest) o de la URL + ownership (operador).
export const chatMessageSchema = z.object({
  body: z.string().min(1, "El mensaje no puede estar vacío"),
});

// ---------- Bot IA (config del comercio) ----------
// Config del bot que edita el operador (PUT /api/bot/config). `enabled` y
// `knowledgeBase` son obligatorios (la KB permite vacío). `model` y `dailyLimit`
// son opcionales: si no vienen, caen en los @default del schema.prisma. Caps de
// costo/contexto: KB máx. 8000 chars, dailyLimit entre 0 y 5000.
export const botConfigSchema = z.object({
  enabled: z.boolean(),
  knowledgeBase: z
    .string()
    .max(8000, "La base de conocimiento no puede superar los 8000 caracteres"),
  model: z.string().min(1, "El modelo no puede estar vacío").optional(),
  dailyLimit: z
    .number()
    .int("El límite diario debe ser un número entero")
    .min(0, "El límite diario no puede ser negativo")
    .max(5000, "El límite diario no puede superar 5000")
    .optional(),
});

// ---------- Sucursales ----------
export const createBranchSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  address: z.string().optional(),
  phone: z.string().optional(),
  // Punto de venta fiscal de la sucursal (sdd/sucursales-pv-facturacion R1/R7).
  // Opcional y nullable: null → fallback (casa central / PV global). 1..9999;
  // el duplicado entre sucursales ACTIVAS de la misma org se valida app-level
  // (409, R7) + índice parcial raw en migración.
  puntoVenta: z.number().int().gte(1).lte(9999).nullable().optional(),
});

export const updateBranchSchema = createBranchSchema.partial();

// ---------- Stock por sucursal ----------
// Body del PUT /products/:id/stock/:branchId (spec A2). Coerción numérica +
// entero ≥ 0: quantity -3 o 2.5 → 400 vía validate().
export const updateBranchStockSchema = z.object({
  quantity: z.coerce
    .number()
    .int("La cantidad debe ser un número entero")
    .nonnegative("La cantidad no puede ser negativa"),
});

// ---------- Bulk "Lo trabajo" (carried) ----------
// Marca/desmarca el flag carried de varios productos de una (selección múltiple
// en la tabla del admin). carried=true → aparece en el filtro "solo lo que
// trabajo"; false → se oculta de la búsqueda (se puede pedir, no se vende aún).
export const bulkCarriedSchema = z.object({
  productIds: z.array(z.string().uuid("Producto inválido")).min(1),
  carried: z.boolean(),
});

// ---------- Bulk "Publicar en tienda" por marca ----------
// Publica/despublica en la tienda online todos los productos de la org que
// tengan la variante "Marca" con un valor en brandValues (mismo matching por
// marca que bulkPriceUpdate). brandValues >= 1 (no se permite barrer toda la
// org por error); .strip() descarta campos desconocidos.
export const bulkPublishSchema = z
  .object({
    brandValues: z
      .array(z.string().min(1, "La marca no puede estar vacía"))
      .min(1, "Seleccioná al menos una marca"),
    publishedToStore: z.boolean(),
  })
  .strip();

// ---------- Bulk Price Update ----------
// Selectores de alcance redefinidos (sdd/bulk-price-update-selectors): el
// cliente manda los NODE ids de categoría seleccionados (categoryIds) y el
// server expande cada subtree; excludeProductIds saca productos puntuales del
// conjunto. percentage es con signo (−100..500). roundUp y categoryId (single)
// fueron REMOVIDOS; .strip() los descarta si un cliente legacy los envía.

/** Entrada de override (categoría o producto): uuid del key + % con signo (−100..500). */
const categoryOverrideSchema = z.object({
  categoryId: z.string().uuid("Categoría inválida"),
  percentage: z.coerce.number().min(-100, "Mínimo -100%").max(500, "Máximo 500%"),
});
const productOverrideSchema = z.object({
  productId: z.string().uuid("Producto inválido"),
  percentage: z.coerce.number().min(-100, "Mínimo -100%").max(500, "Máximo 500%"),
});

export const bulkPriceUpdateSchema = z
  .object({
    // brandValues es OPCIONAL: se puede filtrar SOLO por proveedor (providerIds)
    // o por categoría (categoryIds) sin elegir marca. El superRefine de abajo
    // exige que venga al menos UN filtro de alcance (marcas, proveedores o
    // categorías) para no barrer toda la org por error.
    brandValues: z.array(z.string().min(1)).default([]),
    // percentage (global) es OPCIONAL: si no viene, el server resuelve 0 como
    // default efectivo (productos sin override no cambian). Sirve para correr
    // con SOLO overrides por categoría/producto sin default global.
    percentage: z.coerce
      .number()
      .min(-100, "Mínimo -100%")
      .max(500, "Máximo 500%")
      .optional(),
    categoryIds: z.array(z.string().uuid("Categoría inválida")).default([]),
    excludeProductIds: z.array(z.string().uuid("Producto inválido")).default([]),
    // Filtro por proveedor (sdd/alican-wholesale-price-list/providers): OPCIONAL.
    // Cuando viene, el where incluye providerId IN (…) COMBINADO con el filtro
    // de marcas como AND (marcas Y proveedor; si solo mandás providerIds y
    // brandValues trae una marca, es AND). Vacío/ausente → sin filtro (back-compat).
    providerIds: z.array(z.string().uuid("Proveedor inválido")).default([]),
    // Filtro por sección de planilla del proveedor (línea del PDF, ej.
    // "SIGER MEDICADOS"): OPCIONAL. Restringe a los productos matcheados de esas
    // secciones (PriceListEntry.productId), combinado como AND con marcas/
    // proveedores/categorías.
    priceListSectionIds: z.array(z.string().uuid("Sección de planilla inválida")).default([]),
    // Filtro por TIPO de planilla (SECO/WET): OPCIONAL. Cuando viene, el where
    // restringe a productos con entradas en planillas del/los tipo(s)
    // seleccionado(s) (Product → PriceListEntry → section → priceList.type),
    // combinado como AND con marcas/proveedores/categorías.
    priceListTypes: z.array(z.enum(["SECO", "WET"])).optional().default([]),
    // Overrides por SECCIÓN de planilla (línea del PDF): % propio por línea,
    // precedencia product > section > category > global (mismo patrón que
    // categoryPercentages/productPercentages). Vacío/ausente → sin overrides.
    sectionPercentages: z
      .array(z.object({
        sectionId: z.string().uuid("Sección de planilla inválida"),
        percentage: z.coerce.number().min(-100, "Mínimo -100%").max(500, "Máximo 500%"),
      }))
      .default([]),
    // Overrides por categoría/producto (sdd/bulk-price-overrides): % propio por
    // nodo de categoría y por fila de producto. Precedencia product > category
    // > global (percentage). 0% = incluido pero sin cambio; exclusión =
    // fuera de la corrida. Duplicados → 400 nombrando la key (sin dedupe).
    categoryPercentages: z
      .array(categoryOverrideSchema)
      .max(500, "Máximo 500 overrides por corrida")
      .default([]),
    productPercentages: z
      .array(productOverrideSchema)
      .max(500, "Máximo 500 overrides por corrida")
      .default([]),
  })
  .strip()
  .superRefine((data, ctx) => {
    if (
      data.brandValues.length === 0 &&
      data.providerIds.length === 0 &&
      data.categoryIds.length === 0 &&
      data.priceListSectionIds.length === 0 &&
      data.priceListTypes.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["brandValues"],
        message:
          "Seleccioná al menos una marca, un proveedor, una categoría, una línea de planilla o un tipo de planilla",
      });
    }
    const seenCategories = new Set<string>();
    data.categoryPercentages.forEach(({ categoryId }) => {
      if (seenCategories.has(categoryId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["categoryPercentages"],
          message: `Categoría duplicada: ${categoryId}`,
        });
      }
      seenCategories.add(categoryId);
    });
    const seenProducts = new Set<string>();
    data.productPercentages.forEach(({ productId }) => {
      if (seenProducts.has(productId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["productPercentages"],
          message: `Producto duplicado: ${productId}`,
        });
      }
      seenProducts.add(productId);
    });
  });

// ---------- Precios por kilo (PriceKgType) ----------
// Tipos de "Precios por kilo" (etapas de vida: Adulto, Cachorro, Kitten, ...).
// Cada tipo tiene `name` + `synonyms` (palabras que matchean el name del
// producto, case-insensitive). `synonyms` opcional en create (default []) y
// opcional en update (ausente = no tocar).

const priceKgTypeSynonymSchema = z
  .string()
  .trim()
  .min(1, "El sinónimo no puede estar vacío")
  .max(60, "Máximo 60 caracteres");

// Especie de la planilla (sdd/price-kg-plan): PERRO | GATO | AMBOS. Obligatoria
// en create; opcional en update (ausente = no tocar). Los valores se guardan en
// mayúscula exacta (mismo criterio que la migración TEXT y el enum Prisma).
export const priceKgSpeciesSchema = z.enum(["PERRO", "GATO", "AMBOS"]);

export const createPriceKgTypeSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "El nombre es requerido")
      .max(60, "Máximo 60 caracteres"),
    synonyms: z
      .array(priceKgTypeSynonymSchema)
      .max(50, "Máximo 50 sinónimos")
      .default([]),
    species: priceKgSpeciesSchema,
  })
  .strip();

export const updatePriceKgTypeSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "El nombre es requerido")
      .max(60, "Máximo 60 caracteres")
      .optional(),
    synonyms: z
      .array(priceKgTypeSynonymSchema)
      .max(50, "Máximo 50 sinónimos")
      .optional(),
    species: priceKgSpeciesSchema.optional(),
  })
  .strip();

// ---------- Precios por kilo (PriceKgBrand) ----------
// Marcas de "Precios por kilo" (líneas/sabores editables: MAXXIUM CORDERO,
// OLD PRINCE PREMIUM, MASTER RP, ...). Cada marca tiene `name` + `keywords`
// (palabras que matchean el name del producto con semántica AND,
// case-insensitive). `keywords` opcional en create (default []) y opcional en
// update (ausente = no tocar).

const priceKgBrandKeywordSchema = z
  .string()
  .trim()
  .min(1, "La palabra clave no puede estar vacía")
  .max(60, "Máximo 60 caracteres");

export const createPriceKgBrandSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "El nombre es requerido")
      .max(60, "Máximo 60 caracteres"),
    keywords: z
      .array(priceKgBrandKeywordSchema)
      .max(50, "Máximo 50 palabras clave")
      .default([]),
    species: priceKgSpeciesSchema,
  })
  .strip();

export const updatePriceKgBrandSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "El nombre es requerido")
      .max(60, "Máximo 60 caracteres")
      .optional(),
    keywords: z
      .array(priceKgBrandKeywordSchema)
      .max(50, "Máximo 50 palabras clave")
      .optional(),
    species: priceKgSpeciesSchema.optional(),
  })
  .strip();

// Propagación masiva de precio por kilo (POST /products/bulk-kg-price-update):
// brandId (marca editable de PriceKgBrand, matcheada por keywords sobre el name
// del producto) + entries [{ typeId, priceKg }] fijan priceKgSuelto en los
// productos que matcheen marca (AND de keywords) + tipo (OR de synonyms). El
// front manda UNA marca y MÚLTIPLES pares tipo→precio.
// ── REMOVIDO (sdd/price-kg-plan): la propagación a productos se reemplazó por
// el editor de planilla (marca × tipo → precio). Ver savePriceKgPlanSchema.

// ---------- Planilla de precios por kilo (PriceKgPrice) ----------
// Editor de planilla: guarda TODAS las celdas de la matriz marca (filas) ×
// tipo (columnas) → precio por kilo, una por especie (la planilla se edita por
// Perros/Gatos y una marca/tipo AMBOS puede tener precios distintos por
// especie). priceKg null = borrar la celda; number = upsert. Se rechazan pares
// (brandId, typeId, species) duplicados: a lo sumo una celda por par+especie
// en la org.
export const savePriceKgPlanSchema = z
  .object({
    entries: z
      .array(
        z.object({
          brandId: z.string().uuid("Marca inválida"),
          typeId: z.string().uuid("Tipo inválido"),
          species: priceKgSpeciesSchema,
          priceKg: z.coerce
            .number()
            .positive("El precio por kg debe ser mayor a 0")
            .multipleOf(0.01, "El precio admite hasta 2 decimales")
            .nullable(),
        }),
      )
      .min(1, "Debe enviar al menos una celda")
      .max(1000, "Máximo 1000 celdas por guardado"),
  })
  .strip()
  .superRefine((data, ctx) => {
    const seen = new Set<string>();
    for (const entry of data.entries) {
      const key = `${entry.brandId}:${entry.typeId}:${entry.species}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entries"],
          message: "Marca, tipo y especie duplicados en la lista",
        });
        break;
      }
      seen.add(key);
    }
  });

// ---------- Cola de revisión de precios por kilo ----------
// Query params de la cola de revisión (GET /price-kg-review/queue): filtros
// opcionales por status/reason + paginación numbered (page/limit), mismos
// límites que el resto del ERP.
export const reviewQueueQuerySchema = z
  .object({
    status: z
      .enum(["PENDING", "APPROVED", "REJECTED"])
      .optional()
      .describe("Filtro por estado de la entrada"),
    reason: z
      .enum(["FUZZY_MATCH", "MANUAL_OVERRIDE", "ORPHAN_CELL", "BRAND_NO_PLANILLA"])
      .optional()
      .describe("Filtro por motivo de la entrada"),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strip();

// ---------- Query de productos por celda (panel de venta suelta) ----------
// GET /price-kg-products?brandId&typeId&species: devuelve los productos que
// matchean la celda de la planilla. Los tres son requeridos (una celda se
// identifica por marca+tipo+especie).
export const priceKgProductsQuerySchema = z
  .object({
    brandId: z.string().min(1, "brandId es requerido"),
    typeId: z.string().min(1, "typeId es requerido"),
    species: priceKgSpeciesSchema,
  })
  .strip();

// ---------- Branding de la app (ERP) ----------
// Configuración de branding del ERP, 1:1 con Organization.
// Mismo patrón que updateStoreSettingsSchema: hex regex, URL nullable, strip.
export const updateAppBrandingSchema = z.object({
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color inválido (formato #rrggbb)")
    .optional(),
  logoUrl: z.string().url("URL de logo inválida").nullable().optional(),
  faviconUrl: z.string().url("URL de favicon inválida").nullable().optional(),
  displayName: z.string().max(100, "Máximo 100 caracteres").optional(),
  showDisplayName: z.boolean().optional(),
}).strip();

// ---------- Configuración de precios (venta suelta) ----------
// Factor de mayorista de la org (PricingSetting, 1:1 con Organization).
// Positivo, hasta 2 decimales (B-04: factor = COALESCE(product.bulkFactor,
// org.bulkFactor, 1.20)). El controller corre el recompute en el PUT.
export const updatePricingSettingSchema = z.object({
  bulkFactor: z.coerce
    .number()
    .positive("El factor debe ser mayor a 0")
    .multipleOf(0.01, "El factor admite hasta 2 decimales"),
}).strip();

// ---------- Horario comercial (business-hours-access) ----------
// Config 1:1 con Organization (BusinessHourSetting). El gate bloquea a roles
// operativos fuera del horario configurado — un schema inválido aquí NO debe
// poder inhabilitar el comercio por accidente, así que se valida duro:
//  - `timezone`: IANA válida (Intl.supportedValuesOf con fallback manual)
//  - `days`: exactamente 7 entradas, una por día 0(domingo)..6(sábado)
//  - cada día: enabled + 1..N slots (turnos) open/close "HH:MM" zero-padded,
//    con open < close por slot (comparación de strings padded: "09:00" <
//    "19:00" es correcto y evita parsear horas manualmente). Los slots
//    soportan horario cortado (ej. 08:00-12:00 y 16:00-20:00).
//  - al menos 1 día habilitado (sin días habilitados el gate bloquearía
//    SIEMPRE, incluso en el horario — un estado sin sentido)
const HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

const businessHourSlotSchema = z
  .object({
    open: z.string().regex(HHMM_REGEX, "Formato inválido (esperado HH:MM)"),
    close: z.string().regex(HHMM_REGEX, "Formato inválido (esperado HH:MM)"),
  })
  .refine((s) => s.open < s.close, {
    message: "La hora de apertura debe ser anterior al cierre",
    path: ["close"],
  });

const businessHourDaySchema = z.object({
  day: z.number().int().min(0).max(6),
  enabled: z.boolean(),
  slots: z
    .array(businessHourSlotSchema)
    .min(1, "Cada día necesita al menos un turno"),
});

// IANA timezones válidas: Intl.supportedValuesOf devuelve la lista del
// runtime, pero OMITE zonas canónicas duplicadas (alias) — por ejemplo Node 24
// excluye "America/Argentina/Buenos_Aires", la timezone por defecto de esta
// feature. La validación robusta es construir un Intl.DateTimeFormat con la
// zona: si es inválida tira RangeError. Acepta alias y canonical sin depender
// de la lista que devuelva cada runtime.
const isValidTimezone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const timezoneSchema = z
  .string()
  .min(1, "La zona horaria es requerida")
  .refine(isValidTimezone, "Zona horaria inválida (debe ser una IANA timezone)");

export const updateBusinessHoursSchema = z
  .object({
    timezone: timezoneSchema,
    days: z.array(businessHourDaySchema).length(7, "Debe haber exactamente 7 días"),
  })
  .superRefine((data, ctx) => {
    const daysByNumber = new Map(data.days.map((d) => [d.day, d]));
    for (let day = 0; day <= 6; day++) {
      if (!daysByNumber.has(day)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["days"],
          message: `Falta el día ${day} (0=domingo)`,
        });
        return;
      }
    }
    if (!data.days.some((d) => d.enabled)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["days"],
        message: "Debe haber al menos un día habilitado",
      });
    }
  });

// ---------- Import de planillas de precios Alican (sdd/alican-wholesale-price-list) ----------

/**
 * Decisión por fila del preview. `position` es el idTemporal (D6): determinista
 * entre preview y apply (mismo PDF → mismos índices), sin estado server-side.
 *
 * El payload lleva ademas el ECHO de los datos de la fila generados por el
 * server en el preview (nombre, jerarquía, precios): el apply es stateless y
 * no re-parsea el PDF, así que persiste exactamente lo que el preview devolvió.
 * suggestedPrice NO se envía: el server SIEMPRE lo recalcula con round2
 * (nunca confía en valores del cliente).
 */
const decisionSchema = z.object({
  position: z.number().int().min(0),
  accion: z.enum(["import", "omit"]),
  productId: z.string().uuid("Producto inválido").optional(), // asignación manual / default del match
  nombre: z.string().min(1, "Nombre requerido"),
  marca: z.string().nullable().optional(),
  linea: z.string().nullable().optional(),
  sublinea: z.string().nullable().optional(),
  unidadEmpaque: z.string().nullable().optional(),
  precioSinIva: z.coerce.number().nullable().optional(),
  precioConIva: z.coerce.number().nullable().optional(),
});

export const applyPriceListSchema = z
  .object({
    layout: z.enum(["SECO", "WET"]),
    period: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Período inválido (YYYY-MM-DD)").nullable().optional(),
    sourceFilename: z.string().min(1, "sourceFilename requerido"),
    // Check "Aplicar precios al catálogo" (sdd/alican-wholesale-price-list/apply-prices).
    // Default false cuando el campo está AUSENTE → back-compat total: los
    // callers existentes (y el flujo ?dryRun=false) conservan el comportamiento
    // original (no tocan product.price ni crean productos). El wizard SIEMPRE
    // envía el valor explícito (default ON en la UI).
    applyPrices: z.boolean().optional(),
    // Proveedor de la planilla (sdd/alican-wholesale-price-list/providers):
    // OPCIONAL y back-compat — sin él, providerId queda null y todo sigue igual.
    // El server crea o reutiliza el Provider de la org por nombre
    // case-insensitive y asigna providerId a todos los productos tocados.
    // trim+min(1): vacío o solo espacios → 400 (validación explícita del server).
    providerName: z.string().trim().min(1, "El proveedor no puede estar vacío").optional(),
    rows: z.array(decisionSchema).min(1, "Debe enviar al menos una decisión"),
  })
  .strip()
  .superRefine((data, ctx) => {
    const seen = new Set<number>();
    data.rows.forEach((r) => {
      if (seen.has(r.position)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rows"],
          message: `Posición duplicada: ${r.position}`,
        });
      }
      seen.add(r.position);
    });
  });

/** Override de precio sugerido por entrada (edición por fila). */
const entryOverrideSchema = z.object({
  entryId: z.string().uuid("Entrada inválida"),
  suggestedPrice: z.coerce.number().nonnegative("El precio no puede ser negativo"),
});

/**
 * Ajuste masivo de sugeridos de UNA planilla (REQ-11, patrón dryRun de
 * bulkPriceUpdate): % sobre el suggestedPrice ACTUAL de cada entrada (−100..500),
 * exclusiones por fila y overrides puntuales por entryId (max 500, sin duplicados).
 */
export const adjustPriceListSchema = z
  .object({
    percentage: z.coerce
      .number()
      .min(-100, "Mínimo -100%")
      .max(500, "Máximo 500%")
      .optional(),
    excludeEntryIds: z.array(z.string().uuid("Entrada inválida")).default([]),
    entryOverrides: z
      .array(entryOverrideSchema)
      .max(500, "Máximo 500 overrides por corrida")
      .default([]),
  })
  .strip()
  .superRefine((data, ctx) => {
    const seen = new Set<string>();
    data.entryOverrides.forEach(({ entryId }) => {
      if (seen.has(entryId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entryOverrides"],
          message: `Entrada duplicada: ${entryId}`,
        });
      }
      seen.add(entryId);
    });
  });

// ---------- Stock de alimento suelto (sdd/loose-lines-stock) ----------
// POST /loose-stock/open-bag: abrir una bolsa de un producto en una sucursal.
// branchId opcional: los VENDEDOR/CASHIER usan su sucursal asignada (el server
// la resuelve); ADMIN/MANAGEMENT lo mandan explícito (si falta → 400).
export const openBagSchema = z
  .object({
    productId: z.string().min(1, "productId es requerido"),
    branchId: z.string().min(1).optional(),
    // Celda destino (producto suelto) a la que se acreditan los kg de la bolsa.
    // Reemplaza el auto-match por nombre (resolveCellForProduct) en la apertura.
    priceKgPriceId: z.string().min(1, "La celda destino (producto suelto) es requerida"),
  })
  .strip();

// PUT /loose-stock/:lineId: ajuste manual del stock suelto de una línea (kg).
// lineId en el path es la CELDA (priceKgPriceId); branchId va en el body —
// la fila (celda, sucursal) se crea si no existe (carga inicial).
export const setLooseStockSchema = z
  .object({
    branchId: z.string().min(1, "branchId es requerido"),
    quantity: z.coerce
      .number()
      .nonnegative("La cantidad no puede ser negativa")
      .multipleOf(0.01, "La cantidad admite hasta 2 decimales"),
  })
  .strip();

// GET /loose-stock: listado filtrable por sucursal.
export const listLooseStocksQuerySchema = z
  .object({
    branchId: z.string().min(1).optional(),
  })
  .strip();

// ---------- Configuración ARCA (sdd/arca-facturacion-electronica) ----------
// CRUD 1:1 con Organization (ArcaSetting). Validación dura: un payload
// inválido aquí no debe poder romper el gate de emisión fiscal por accidente.
//  - cuitEmisor: 11 dígitos con DV mod 11 (isValidCuit normaliza guiones).
//  - puntoVenta: entero 1..9999.
//  - environment: HOMOLOGACION | PRODUCCION.
//  - certPath/keyPath: rutas no vacías (los certificados NUNCA van en la DB).
export const arcaSettingsSchema = z
  .object({
    cuitEmisor: z
      .string()
      .min(1, "El CUIT del emisor es requerido")
      .refine(isValidCuit, "CUIT inválido (formato o dígito verificador incorrecto)"),
    // CUIT con autorización del padrón A4 (autocompletar clientes). Opcional;
    // si no se manda, el padrón usa cuitEmisor (comportamiento previo).
    padronCuit: z
      .string()
      .refine((v) => v === "" || isValidCuit(v), "CUIT del padrón inválido")
      .optional(),
    puntoVenta: z
      .number()
      .int("El punto de venta debe ser un número entero")
      .min(1, "El punto de venta debe estar entre 1 y 9999")
      .max(9999, "El punto de venta debe estar entre 1 y 9999"),
    environment: z.enum(["HOMOLOGACION", "PRODUCCION"]),
    certPath: z.string().min(1, "La ruta del certificado no puede estar vacía"),
    keyPath: z.string().min(1, "La ruta de la clave no puede estar vacía"),
    enabled: z.boolean().default(false),
  })
  .strip();

// ---------- Módulos por negocio (sdd/modulos-por-negocio) ----------
// Body del PUT /api/modules: la lista de keys de módulos habilitados para la
// org. El controller valida contra MODULE_REGISTRY y el plan (rechaza keys
// desconocidas y por encima del plan). .strict() descarta campos desconocidos.
export const updateModulesSchema = z
  .object({
    modules: z.array(z.string(), "modules debe ser un array de strings"),
  })
  .strict();

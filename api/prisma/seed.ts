import "dotenv/config";
import { PrismaClient, Role } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 Seeding database...");

  // 1) SUPERADMIN (la plataforma — sin organización)
  const superadminEmail = process.env.SEED_SUPERADMIN_EMAIL ?? "superadmin@nexo.com";
  const superadminPassword = process.env.SEED_SUPERADMIN_PASSWORD ?? "superadmin123";
  await prisma.user.upsert({
    where: { email: superadminEmail },
    update: {},
    create: {
      email: superadminEmail,
      password: await bcrypt.hash(superadminPassword, 10),
      role: Role.SUPERADMIN,
      mustChangePassword: false,
      organizationId: null,
    },
  });
  console.log(`✅ SUPERADMIN: ${superadminEmail} / ${superadminPassword}`);

  // 2) Organización demo + su ADMIN
  const org = await prisma.organization.upsert({
    where: { slug: "demo" },
    update: { onboardingCompletedAt: new Date() },
    create: { name: "Negocio Demo", slug: "demo", onboardingCompletedAt: new Date() },
  });

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@demo.com";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "admin123";
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      password: await bcrypt.hash(adminPassword, 10),
      role: Role.ADMIN,
      mustChangePassword: false,
      organizationId: org.id,
    },
  });
  console.log(`✅ ADMIN (org demo): ${adminEmail} / ${adminPassword}`);

  // 3) Full category tree with variants — defined inline, shared with reset-demo.ts
  //    Structure: { name, children?: [...], variants?: [{ name, options: [...] }] }
  const CATEGORY_TREE = [
    {
      name: "COMPUTACIÓN",
      children: [
        {
          name: "Notebooks",
          variants: [
            { name: "Marca", options: ["HP", "Lenovo", "Dell", "Apple"] },
            { name: "Procesador", options: ["i3", "i5", "i7"] },
          ],
        },
        {
          name: "Periféricos",
          children: [
            { name: "Mouse", variants: [{ name: "Conexión", options: ["Cable", "Inalámbrico"] }] },
            { name: "Teclados", variants: [{ name: "Tipo", options: ["Mecánico", "Membrana"] }] },
            { name: "Auriculares", variants: [{ name: "Conexión", options: ["Cable", "Bluetooth"] }] },
          ],
        },
        {
          name: "Monitores",
          variants: [
            { name: "Tamaño", options: ["22", "24", "27", "32"] },
            { name: "Resolución", options: ["Full HD", "4K"] },
          ],
        },
        {
          name: "Accesorios",
          children: [
            { name: "Cargadores", variants: [{ name: "Potencia", options: ["30W", "65W", "100W"] }] },
          ],
        },
      ],
    },
    {
      name: "HOGAR Y OFICINA",
      children: [
        { name: "Sillas", variants: [{ name: "Material", options: ["Tela", "Cuero", "Malla"] }] },
        { name: "Escritorios", variants: [{ name: "Material", options: ["Madera", "Melamina"] }, { name: "Medida", options: ["120cm", "150cm"] }] },
        { name: "Electrodomésticos", children: [{ name: "Cafeteras", variants: [{ name: "Tipo", options: ["Express", "De Goteo"] }] }] },
      ],
    },
    {
      name: "HERRAMIENTAS",
      children: [
        { name: "Taladros", variants: [{ name: "Alimentación", options: ["Cable", "Inalámbrico"] }, { name: "Voltaje", options: ["12V", "18V", "20V"] }] },
      ],
    },
  ];
  const products = await prisma.product.createMany({
    data: baseProducts.map((p) => ({
      ...p,
      publishedToStore: true, // demo: catálogo siempre visible en la tienda pública
      organizationId: org.id,
    })),
  });
  console.log(`✅ ${products.count} productos demo creados`);

  // 6) Clientes demo (scopeados a la org)
  await prisma.customer.deleteMany({ where: { organizationId: org.id } });
  const customers = await prisma.customer.createMany({
    data: [
      { name: "Juan Pérez", email: "juan.perez@example.com", phone: "+54 11 1234 5678", organizationId: org.id },
      { name: "María García", email: "maria.garcia@example.com", phone: "+54 11 8765 4321", organizationId: org.id },
      { name: "Carlos López", email: "carlos.lopez@example.com", phone: "+54 11 2468 1357", organizationId: org.id },
    ],
  });
  console.log(`✅ ${customers.count} clientes demo creados`);

  console.log("\n🎉 Base de datos inicializada!");
}

main()
  .catch((e) => {
    console.error("❌ Error al inicializar la base de datos:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import bcrypt from 'bcryptjs';
import { PrismaClient, ProductKind, ProductStatus, Role } from '@prisma/client';

const prisma = new PrismaClient();

const main = async () => {
  const passwordHash = await bcrypt.hash('Welilink123!', 12);
  const buyer = await prisma.user.upsert({
    where: { phone: '+237690000001' },
    update: {},
    create: { name: 'Amina D.', phone: '+237690000001', email: 'amina@example.com', passwordHash, role: Role.BUYER },
  });
  const producer = await prisma.user.upsert({
    where: { phone: '+237690000002' },
    update: {},
    create: { name: 'Paul N.', phone: '+237690000002', email: 'paul@example.com', passwordHash, role: Role.PRODUCER },
  });
  const admin = await prisma.user.upsert({
    where: { phone: '+237690000003' },
    update: {},
    create: { name: 'Administration Weli', phone: '+237690000003', email: 'admin@welilink.local', passwordHash, role: Role.ADMIN },
  });

  const products = [
    { title: 'Maïs blanc', kind: ProductKind.FRESH, category: 'Céréales', unit: 'sac de 25 kg', priceXaf: 8500, quantity: 25, location: 'Bonabéri · Douala', description: 'Récolte récente, séchée et disponible.' },
    { title: 'Plantain mûr', kind: ProductKind.FRESH, category: 'Fruits', unit: 'régime', priceXaf: 7000, quantity: 18, location: 'Nkongsamba · Littoral', description: 'Plantain mûr prêt à retirer.' },
    { title: 'Miel de forêt', kind: ProductKind.PROCESSED, category: 'Produits transformés', unit: 'pot de 500 g', priceXaf: 4500, quantity: 32, location: 'Yaoundé · Centre', description: 'Miel local filtré et conditionné par la coopérative.' },
    { title: 'Beurre de karité', kind: ProductKind.PROCESSED, category: 'Produits transformés', unit: 'pot de 250 g', priceXaf: 3500, quantity: 24, location: 'Bafoussam · Ouest', description: 'Beurre de karité brut, préparé par un groupement producteur.' },
  ];

  for (const product of products) {
    const existing = await prisma.product.findFirst({ where: { title: product.title, producerId: producer.id } });
    if (existing) {
      await prisma.product.update({ where: { id: existing.id }, data: { ...product, status: ProductStatus.ACTIVE, lastStockAt: new Date() } });
    } else {
      await prisma.product.create({ data: { ...product, producerId: producer.id, status: ProductStatus.ACTIVE } });
    }
  }

  console.log(`Seed complete: buyer=${buyer.phone}, producer=${producer.phone}, admin=${admin.phone}`);
  console.log('Demo password: Welilink123!');
};

main().finally(() => prisma.$disconnect());

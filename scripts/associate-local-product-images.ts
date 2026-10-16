import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import 'dotenv/config';
import { prisma } from '../src/db.js';
import { productShowcase } from '../src/product-showcase.js';
import { isProductImageStorageConfigured, uploadProductImage } from '../src/storage.js';

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const localProduct = (title: string) => {
  const normalized = normalize(title);
  return productShowcase.find((product) => normalized.includes(normalize(product.title)) || normalize(product.title).includes(normalized));
};

if (!isProductImageStorageConfigured()) {
  throw new Error('Configurez SUPABASE_URL et SUPABASE_SECRET_KEY avant d’associer les images.');
}

try {
  const products = await prisma.product.findMany({ where: { imageUrl: null } });
  let associated = 0;
  let skipped = 0;

  for (const product of products) {
    const showcase = localProduct(product.title);
    const asset = showcase?.imageUrl.split('/').pop();
    if (!showcase || !asset) {
      skipped += 1;
      continue;
    }

    const filePath = resolve(process.cwd(), 'assets', 'products', asset);
    const buffer = await readFile(filePath);
    const extension = asset.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
    const stored = await uploadProductImage({
      filename: asset,
      mimetype: extension === 'png' ? 'image/png' : 'image/jpeg',
      buffer,
    }, {
      producerId: product.producerId,
      productId: product.id,
      objectPath: `products/${product.producerId}/${product.id}/showcase.${extension}`,
    });
    await prisma.product.update({ where: { id: product.id }, data: { imageUrl: stored.path } });
    associated += 1;
  }

  console.log(JSON.stringify({ associated, skipped, alreadyConfigured: 0 }, null, 2));
} finally {
  await prisma.$disconnect();
}

import { describe, expect, it } from 'vitest';
import { ProductKind, ProductStatus } from '@prisma/client';
import { answerWeli } from '../src/weli.js';

const product = (overrides: Record<string, unknown> = {}) => ({
  id: 'product-1',
  title: 'Miel de forêt',
  kind: ProductKind.PROCESSED,
  category: 'Produits transformés',
  unit: 'pot de 500 g',
  priceXaf: 4500,
  quantity: 12,
  reservedQuantity: 0,
  location: 'Yaoundé · Centre',
  description: 'Miel local',
  imageUrl: null,
  status: ProductStatus.ACTIVE,
  lastStockAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  producerId: 'producer-1',
  producer: { id: 'producer-1', name: 'Paul N.' },
  ...overrides,
});

describe('Weli catalogue assistant', () => {
  it('confirms a product from the actual catalogue when it is available', async () => {
    const answer = await answerWeli({
      message: 'Le miel est-il disponible à Yaoundé ?',
      products: [product()] as never,
      history: [],
      forceCatalog: true,
    });

    expect(answer.provider).toBe('catalog');
    expect(answer.reply).toContain('Miel de forêt est enregistré comme disponible');
    expect(answer.products[0]?.title).toBe('Miel de forêt');
  });

  it('does not pretend that an out-of-stock product can be ordered', async () => {
    const answer = await answerWeli({
      message: 'Le miel est-il disponible ?',
      products: [product({ status: ProductStatus.SOLD_OUT, quantity: 0 })] as never,
      history: [],
      forceCatalog: true,
    });

    expect(answer.reply).toContain('n’est pas disponible');
    expect(answer.requiresProducerConfirmation).toBe(false);
  });
});

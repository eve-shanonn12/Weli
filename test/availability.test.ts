import { describe, expect, it } from 'vitest';
import { ProductKind, ProductStatus } from '@prisma/client';
import { config } from '../src/config.js';
import { getAvailability } from '../src/availability.js';

const baseProduct = {
  kind: ProductKind.FRESH,
  quantity: 20,
  reservedQuantity: 0,
  lastStockAt: new Date(),
  status: ProductStatus.ACTIVE,
};

describe('availability rules', () => {
  it('marks fresh stock as available when it was updated recently', () => {
    expect(getAvailability(baseProduct)).toMatchObject({ state: 'AVAILABLE', availableQuantity: 20 });
  });

  it('marks a product for confirmation when fresh stock is stale', () => {
    const staleDate = new Date(Date.now() - (config.freshStockTtlHours + 1) * 3_600_000);
    expect(getAvailability({ ...baseProduct, lastStockAt: staleDate }).state).toBe('CHECK_REQUIRED');
  });

  it('accounts for reservations and low stock', () => {
    expect(getAvailability({ ...baseProduct, quantity: 8, reservedQuantity: 4 })).toMatchObject({
      state: 'LOW_STOCK',
      availableQuantity: 4,
    });
  });

  it('does not apply fresh-stock TTL to processed products', () => {
    const staleDate = new Date(Date.now() - (config.processedStockTtlHours + 1) * 3_600_000);
    expect(getAvailability({ ...baseProduct, kind: ProductKind.PROCESSED, lastStockAt: staleDate }).state).toBe('CHECK_REQUIRED');
  });
});

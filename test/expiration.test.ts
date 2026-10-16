import { describe, expect, it, vi } from 'vitest';
import { RequestStatus } from '@prisma/client';
import { expirePendingRequests } from '../src/expiration.js';

describe('request expiry job', () => {
  it('releases a pending reservation and marks the request expired', async () => {
    const tx = {
      purchaseRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'request-1',
          status: RequestStatus.PENDING,
          quantity: 3,
          productId: 'product-1',
          buyerId: 'buyer-1',
        }),
        update: vi.fn(),
      },
      product: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      notification: { create: vi.fn() },
    };
    const prisma = {
      purchaseRequest: { findMany: vi.fn().mockResolvedValue([{ id: 'request-1' }]) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<boolean>) => callback(tx)),
    } as never;

    await expect(expirePendingRequests(prisma)).resolves.toBe(1);
    expect(tx.product.updateMany).toHaveBeenCalled();
    expect(tx.purchaseRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-1' },
      data: { status: RequestStatus.EXPIRED },
    });
  });
});

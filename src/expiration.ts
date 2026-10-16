import { PrismaClient, RequestStatus, NotificationType } from '@prisma/client';

/** Releases stock held by purchase requests that were not handled in time. */
export async function expirePendingRequests(prisma: PrismaClient, now = new Date()) {
  const candidates = await prisma.purchaseRequest.findMany({
    where: { status: RequestStatus.PENDING, expiresAt: { lt: now } },
    select: { id: true },
  });

  let expiredCount = 0;

  for (const candidate of candidates) {
    const expired = await prisma.$transaction(async (tx) => {
      const purchaseRequest = await tx.purchaseRequest.findUnique({
        where: { id: candidate.id },
        select: { id: true, status: true, quantity: true, productId: true, buyerId: true },
      });

      if (!purchaseRequest || purchaseRequest.status !== RequestStatus.PENDING) return false;

      const released = await tx.product.updateMany({
        where: { id: purchaseRequest.productId, reservedQuantity: { gte: purchaseRequest.quantity } },
        data: { reservedQuantity: { decrement: purchaseRequest.quantity } },
      });

      if (released.count !== 1) return false;

      await tx.purchaseRequest.update({ where: { id: purchaseRequest.id }, data: { status: RequestStatus.EXPIRED } });
      await tx.notification.create({
        data: {
          userId: purchaseRequest.buyerId,
          requestId: purchaseRequest.id,
          type: NotificationType.SYSTEM,
          title: 'Demande expirée',
          body: 'La demande n’a pas été confirmée à temps. La quantité a été libérée.',
        },
      });

      return true;
    });

    if (expired) expiredCount += 1;
  }

  return expiredCount;
}

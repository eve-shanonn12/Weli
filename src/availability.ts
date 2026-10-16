import type { Product, ProductKind, ProductStatus } from '@prisma/client';
import { config } from './config.js';
import { getProductImageUrl } from './product-showcase.js';

export type AvailabilityState = 'AVAILABLE' | 'LOW_STOCK' | 'CHECK_REQUIRED' | 'OUT_OF_STOCK' | 'PAUSED';

export function getAvailability(product: Pick<Product, 'kind' | 'quantity' | 'reservedQuantity' | 'lastStockAt' | 'status'>) {
  const availableQuantity = Math.max(0, product.quantity - product.reservedQuantity);

  if (product.status === 'PAUSED') {
    return { state: 'PAUSED' as AvailabilityState, availableQuantity, lastStockAt: product.lastStockAt };
  }

  if (availableQuantity <= 0 || product.status === 'SOLD_OUT') {
    return { state: 'OUT_OF_STOCK' as AvailabilityState, availableQuantity, lastStockAt: product.lastStockAt };
  }

  const ttlHours = product.kind === 'FRESH' ? config.freshStockTtlHours : config.processedStockTtlHours;
  const ageHours = (Date.now() - product.lastStockAt.getTime()) / 3_600_000;

  if (ageHours > ttlHours) {
    return { state: 'CHECK_REQUIRED' as AvailabilityState, availableQuantity, lastStockAt: product.lastStockAt };
  }

  return {
    state: availableQuantity <= 5 ? 'LOW_STOCK' as AvailabilityState : 'AVAILABLE' as AvailabilityState,
    availableQuantity,
    lastStockAt: product.lastStockAt,
  };
}

export function publicProduct(product: Product & { producer?: { id: string; name: string } | null }) {
  const imageSource = product.imageUrl
    ? (product.imageUrl.startsWith('products/') ? 'storage' : 'external')
    : 'fallback';
  const savedImageUrl = product.imageUrl?.startsWith('products/')
    ? `/api/products/${encodeURIComponent(product.id)}/image`
    : product.imageUrl;

  return {
    id: product.id,
    title: product.title,
    kind: product.kind,
    category: product.category,
    unit: product.unit,
    priceXaf: product.priceXaf,
    location: product.location,
    description: product.description,
    imageUrl: getProductImageUrl(product.title, savedImageUrl),
    imageSource,
    status: product.status,
    producer: product.producer ? { id: product.producer.id, name: product.producer.name } : undefined,
    availability: getAvailability(product),
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

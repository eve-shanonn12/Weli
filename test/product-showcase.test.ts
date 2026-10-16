import { describe, expect, it } from 'vitest';
import { findProductImageAsset, getProductImageUrl, productShowcase } from '../src/product-showcase.js';

describe('product showcase', () => {
  it('exposes every supplied product with a distinct local image URL', () => {
    expect(productShowcase).toHaveLength(17);
    expect(new Set(productShowcase.map((product) => product.imageUrl)).size).toBe(17);
    expect(productShowcase.every((product) => product.imageUrl.startsWith('/assets/products/'))).toBe(true);
  });

  it('uses the supplied visual as a fallback for matching live offers', () => {
    expect(getProductImageUrl('Maïs blanc', null)).toBe('/assets/products/mais.png');
    expect(getProductImageUrl('Miel de forêt', null)).toBe('/assets/products/miel.jpg');
    expect(getProductImageUrl('Produit sans photo', null)).toBeNull();
    expect(getProductImageUrl('Maïs blanc', 'https://example.test/custom.jpg')).toBe('https://example.test/custom.jpg');
  });

  it('only resolves known product assets for the static route', () => {
    expect(findProductImageAsset('arachide.jpg')).toMatchObject({ mimeType: 'image/jpeg' });
    expect(findProductImageAsset('../secret.txt')).toBeUndefined();
  });
});

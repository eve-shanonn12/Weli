import { describe, expect, it } from 'vitest';
import { productImagePathFromUrl, validateProductImage } from '../src/storage.js';

describe('product image storage validation', () => {
  it('accepts a real JPEG signature within the supported formats', () => {
    const file = validateProductImage({
      filename: 'arachide.jpg',
      mimetype: 'image/jpeg',
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]),
    });

    expect(file).toEqual({ mimeType: 'image/jpeg', extension: 'jpg' });
  });

  it('rejects a renamed or unsupported file', () => {
    expect(() => validateProductImage({
      filename: 'script.svg',
      mimetype: 'image/svg+xml',
      buffer: Buffer.from('<svg></svg>'),
    })).toThrowError('Utilisez une image JPG, PNG ou WebP.');

    expect(() => validateProductImage({
      filename: 'fake.jpg',
      mimetype: 'image/jpeg',
      buffer: Buffer.from('not-a-jpeg'),
    })).toThrowError('Le fichier ne correspond pas à son format déclaré.');
  });

  it('normalises only managed product object paths', () => {
    expect(productImagePathFromUrl('products/producer/product/photo.jpg')).toBe('products/producer/product/photo.jpg');
    expect(productImagePathFromUrl('../private.txt')).toBeNull();
    expect(productImagePathFromUrl('https://example.com/photo.jpg')).toBeNull();
  });
});

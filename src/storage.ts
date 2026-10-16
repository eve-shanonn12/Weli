import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { HttpError } from './errors.js';

const acceptedMimeTypes = new Map([
  ['image/jpeg', { extension: 'jpg' }],
  ['image/jpg', { extension: 'jpg' }],
  ['image/png', { extension: 'png' }],
  ['image/webp', { extension: 'webp' }],
]);

export type ProductImageFile = {
  filename: string;
  mimetype: string;
  buffer: Buffer;
};

export type StoredProductImage = {
  path: string;
};

let supabaseClient: SupabaseClient | null = null;

export function isProductImageStorageConfigured() {
  return Boolean(config.supabaseUrl && config.supabaseServerKey);
}

function storageClient() {
  if (!config.supabaseUrl || !config.supabaseServerKey) {
    throw new HttpError(503, 'PRODUCT_IMAGE_STORAGE_NOT_CONFIGURED', 'Le stockage des images n’est pas encore configuré.');
  }

  if (!supabaseClient) {
    supabaseClient = createClient(config.supabaseUrl, config.supabaseServerKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
  }

  return supabaseClient;
}

function hasJpegSignature(buffer: Buffer) {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function hasPngSignature(buffer: Buffer) {
  return buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function hasWebpSignature(buffer: Buffer) {
  return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
}

export function validateProductImage(file: ProductImageFile) {
  const mimeType = file.mimetype.toLowerCase().split(';', 1)[0];
  const format = acceptedMimeTypes.get(mimeType);

  if (!format) {
    throw new HttpError(400, 'PRODUCT_IMAGE_FORMAT_INVALID', 'Utilisez une image JPG, PNG ou WebP.');
  }
  if (!file.buffer.length) {
    throw new HttpError(400, 'PRODUCT_IMAGE_EMPTY', 'L’image sélectionnée est vide.');
  }
  if (file.buffer.length > config.productImageMaxBytes) {
    throw new HttpError(413, 'PRODUCT_IMAGE_TOO_LARGE', 'L’image doit peser 5 Mo maximum.');
  }

  const signatureMatches = mimeType === 'image/png'
    ? hasPngSignature(file.buffer)
    : mimeType === 'image/webp'
      ? hasWebpSignature(file.buffer)
      : hasJpegSignature(file.buffer);

  if (!signatureMatches) {
    throw new HttpError(400, 'PRODUCT_IMAGE_CONTENT_INVALID', 'Le fichier ne correspond pas à son format déclaré.');
  }

  return { mimeType, extension: format.extension };
}

function normaliseObjectPath(path: string) {
  try {
    const normalized = path.replace(/^\/+/, '').split('/').map((segment) => decodeURIComponent(segment)).join('/');
    if (!normalized.startsWith('products/') || normalized.includes('..')) return null;
    return normalized;
  } catch {
    return null;
  }
}

export function productImagePathFromUrl(imageUrl: string | null | undefined) {
  if (!imageUrl) return null;
  const prefix = `${config.supabaseUrl}/storage/v1/object/public/${config.supabaseStorageBucket}/`;
  if (config.supabaseUrl && imageUrl.startsWith(prefix)) {
    return normaliseObjectPath(imageUrl.slice(prefix.length));
  }
  if (imageUrl.startsWith('products/')) return normaliseObjectPath(imageUrl);
  return null;
}

export async function uploadProductImage(
  file: ProductImageFile,
  options: { producerId: string; productId: string; objectPath?: string },
): Promise<StoredProductImage> {
  const { mimeType, extension } = validateProductImage(file);
  const objectPath = options.objectPath ?? `products/${options.producerId}/${options.productId}/${randomUUID()}.${extension}`;
  const bucket = storageClient().storage.from(config.supabaseStorageBucket);
  const { error } = await bucket.upload(objectPath, file.buffer, {
    contentType: mimeType,
    cacheControl: '31536000',
    upsert: Boolean(options.objectPath),
  });

  if (error) {
    throw new HttpError(502, 'PRODUCT_IMAGE_UPLOAD_FAILED', 'L’image n’a pas pu être enregistrée. Réessayez.');
  }

  return { path: objectPath };
}

export async function downloadProductImage(imageUrl: string | null | undefined) {
  const objectPath = productImagePathFromUrl(imageUrl);
  if (!objectPath) throw new HttpError(404, 'PRODUCT_IMAGE_NOT_FOUND', 'Image produit introuvable.');
  const { data, error } = await storageClient().storage.from(config.supabaseStorageBucket).download(objectPath);
  if (error || !data) throw new HttpError(404, 'PRODUCT_IMAGE_NOT_FOUND', 'Image produit introuvable.');
  return { buffer: Buffer.from(await data.arrayBuffer()), contentType: data.type || 'application/octet-stream' };
}

export async function removeProductImage(imageUrl: string | null | undefined) {
  const objectPath = productImagePathFromUrl(imageUrl);
  if (!objectPath) return;

  const { error } = await storageClient().storage.from(config.supabaseStorageBucket).remove([objectPath]);
  if (error) {
    throw new HttpError(502, 'PRODUCT_IMAGE_DELETE_FAILED', 'L’ancienne image n’a pas pu être supprimée.');
  }
}

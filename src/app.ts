import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyMultipart from '@fastify/multipart';
import bcrypt from 'bcryptjs';
import { Prisma, PrismaClient, ProductKind, ProductStatus, RequestStatus, Role, PaymentStatus, NotificationType } from '@prisma/client';
import { z } from 'zod';
import { config } from './config.js';
import { prisma as defaultPrisma } from './db.js';
import { getAvailability, publicProduct } from './availability.js';
import { AssistantRateLimiter } from './assistant-rate-limit.js';
import { HttpError } from './errors.js';
import { findProductImageAsset, productShowcase } from './product-showcase.js';
import { downloadProductImage, isProductImageStorageConfigured, removeProductImage, type ProductImageFile, uploadProductImage } from './storage.js';
import { homeScript, renderAdminPage, renderAssistantPage, renderAuthPage, renderBuyerPage, renderCataloguePage, renderNotificationsPage, renderOrderPage, renderProducerPage, renderProductDetailPage } from './web.js';
import { answerWeli, WeliProviderError } from './weli.js';

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(6).max(24),
  email: z.string().email().optional(),
  password: z.string().min(8).max(100),
  role: z.enum(['BUYER', 'PRODUCER']).default('BUYER'),
});

const loginSchema = z.object({
  identifier: z.string().trim().min(3),
  password: z.string().min(1),
});

const productSchema = z.object({
  title: z.string().trim().min(2).max(120),
  kind: z.nativeEnum(ProductKind).default(ProductKind.FRESH),
  category: z.string().trim().min(2).max(80),
  unit: z.string().trim().min(1).max(60),
  priceXaf: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().nonnegative(),
  location: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional(),
  imageUrl: z.string().url().optional(),
});

const productFiltersSchema = z.object({
  q: z.string().trim().optional(),
  kind: z.nativeEnum(ProductKind).optional(),
  category: z.string().trim().optional(),
  region: z.string().trim().optional(),
  status: z.nativeEnum(ProductStatus).optional(),
});

const requestSchema = z.object({
  quantity: z.coerce.number().int().positive(),
  requestedPickup: z.string().trim().max(120).optional(),
  message: z.string().trim().max(1000).optional(),
});

const checkoutSchema = z.object({
  items: z.array(z.object({ productId: z.string().min(1), quantity: z.coerce.number().int().positive() })).min(1).max(30),
  requestedPickup: z.string().trim().max(120).optional(),
}).superRefine((value, context) => {
  const ids = value.items.map((item) => item.productId);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'Un produit ne peut apparaître qu’une seule fois dans la commande.' });
});

const requestDecisionSchema = z.object({
  status: z.enum(['ACCEPTED', 'REJECTED']),
});

const cancellationEvidenceSchema = z.object({
  evidence: z.string().trim().min(10, 'Expliquez le motif avec au moins 10 caractères.').max(1000),
});

const cancellationDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
});

const stockSchema = z.object({
  quantity: z.coerce.number().int().nonnegative(),
  status: z.nativeEnum(ProductStatus).optional(),
});

const pushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(8),
  auth: z.string().min(4),
});

const assistantSchema = z.object({
  message: z.string().trim().min(2).max(500),
  conversationKey: z.string().uuid().optional(),
});

const assistantHistorySchema = z.object({
  conversationKey: z.string().uuid(),
});

type AuthUser = { sub: string; role: Role; name: string };

type ProductPayload = {
  body: unknown;
  image?: ProductImageFile;
};

async function readProductPayload(request: FastifyRequest): Promise<ProductPayload> {
  if (!request.isMultipart()) return { body: request.body };

  const fields: Record<string, string> = {};
  let image: ProductImageFile | undefined;

  try {
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        const buffer = await part.toBuffer();
        if (part.fieldname === 'image' && part.filename) {
          if (image) throw new HttpError(400, 'PRODUCT_IMAGE_MULTIPLE', 'Une seule image principale est autorisée.');
          image = { filename: part.filename, mimetype: part.mimetype, buffer };
        }
        continue;
      }
      fields[part.fieldname] = String(part.value);
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error && typeof error === 'object' && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') {
      throw new HttpError(413, 'PRODUCT_IMAGE_TOO_LARGE', 'L’image doit peser 5 Mo maximum.');
    }
    throw error;
  }

  return { body: fields, image };
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Les informations envoyées sont invalides.', result.error.flatten());
  }
  return result.data;
}

function publicUser(user: { id: string; name: string; phone: string; email: string | null; role: Role }) {
  return { id: user.id, name: user.name, phone: user.phone, email: user.email, role: user.role };
}

function managedProductView(product: Prisma.ProductGetPayload<{
  include: { producer: { select: { id: true; name: true } } };
}>) {
  return {
    ...publicProduct(product),
    quantity: product.quantity,
    reservedQuantity: product.reservedQuantity,
    lastStockAt: product.lastStockAt,
  };
}

function requestView(request: Prisma.PurchaseRequestGetPayload<{
  include: { product: true; buyer: true; producer: true; payment: true };
}>) {
  return {
    id: request.id,
    quantity: request.quantity,
    unitPriceXaf: request.unitPriceXaf,
    totalXaf: request.totalXaf,
    message: request.message,
    requestedPickup: request.requestedPickup,
    status: request.status,
    paymentStatus: request.paymentStatus,
    cancellationEvidence: request.cancellationEvidence,
    cancellationRequestedAt: request.cancellationRequestedAt,
    completedAt: request.completedAt,
    expiresAt: request.expiresAt,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    product: publicProduct({ ...request.product, producer: { id: request.producer.id, name: request.producer.name } }),
    buyer: publicUser(request.buyer),
    producer: publicUser(request.producer),
    payment: request.payment
      ? { provider: request.payment.provider, amountXaf: request.payment.amountXaf, status: request.payment.status, externalReference: request.payment.externalReference }
      : null,
  };
}

export async function buildApp(prisma: PrismaClient = defaultPrisma): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  const assistantRateLimiter = new AssistantRateLimiter();

  await app.register(cors, { origin: true });
  await app.register(fastifyJwt, { secret: config.jwtSecret });
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: config.productImageMaxBytes,
      files: 1,
      fields: 20,
      parts: 25,
    },
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details } });
    }
    if (error && typeof error === 'object' && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({ error: { code: 'PRODUCT_IMAGE_TOO_LARGE', message: 'L’image doit peser 5 Mo maximum.' } });
    }
    request.log.error(error);
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Une erreur interne est survenue.' } });
  });

  const authenticate = async (request: FastifyRequest, reply: FastifyReply): Promise<AuthUser | null> => {
    try {
      await request.jwtVerify();
      return request.user;
    } catch {
      reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Connexion requise.' } });
      return null;
    }
  };

  const optionalAuthenticate = async (request: FastifyRequest): Promise<AuthUser | null> => {
    if (!request.headers.authorization) return null;
    try {
      await request.jwtVerify();
      return request.user;
    } catch {
      return null;
    }
  };

  const requireRole = (user: AuthUser, ...roles: Role[]) => {
    if (!roles.includes(user.role)) {
      throw new HttpError(403, 'FORBIDDEN', 'Vous n’avez pas les droits pour cette action.');
    }
  };

  app.get('/', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!config.frontendPath) {
      return reply.code(404).send({
        error: {
          code: 'FRONTEND_NOT_CONFIGURED',
          message: 'Le backend fonctionne. Configurez WELILINK_FRONTEND_PATH pour servir l’interface Web.',
        },
      });
    }

    try {
      const html = await readFile(config.frontendPath, 'utf8');
      return reply.type('text/html; charset=utf-8').send(`${html}<script>${homeScript()}</script>`);
    } catch {
      return reply.code(404).send({
        error: {
          code: 'FRONTEND_NOT_FOUND',
          message: 'Le fichier de l’interface Web est introuvable.',
        },
      });
    }
  });

  app.get('/assets/welilink-logo.png', async (_request, reply) => {
    if (!config.logoPath) return reply.code(404).send({ error: { code: 'LOGO_NOT_CONFIGURED', message: 'Logo introuvable.' } });
    try {
      return reply.type(/\.jpe?g$/i.test(config.logoPath) ? 'image/jpeg' : 'image/png').header('Cache-Control', 'public, max-age=3600').send(await readFile(config.logoPath));
    } catch {
      return reply.code(404).send({ error: { code: 'LOGO_NOT_FOUND', message: 'Logo introuvable.' } });
    }
  });

  app.get('/assets/products/:asset', async (request, reply) => {
    const { asset } = request.params as { asset: string };
    const image = findProductImageAsset(asset);
    if (!image) return reply.code(404).send({ error: { code: 'PRODUCT_IMAGE_NOT_FOUND', message: 'Image produit introuvable.' } });

    try {
      const path = resolve(process.cwd(), 'assets', 'products', image.asset);
      return reply.type(image.mimeType).header('Cache-Control', 'public, max-age=3600').send(await readFile(path));
    } catch {
      return reply.code(404).send({ error: { code: 'PRODUCT_IMAGE_NOT_FOUND', message: 'Image produit introuvable.' } });
    }
  });

  app.get('/health', async () => ({ status: 'ok', service: 'welilink-market-api', time: new Date().toISOString() }));
  app.get('/api/showcase-products', async () => ({ products: productShowcase }));

  app.get('/connexion', async (_request, reply) => reply.type('text/html; charset=utf-8').send(renderAuthPage('login')));
  app.get('/inscription', async (_request, reply) => reply.type('text/html; charset=utf-8').send(renderAuthPage('register')));
  app.get('/catalogue', async (_request, reply) => reply.type('text/html; charset=utf-8').send(renderCataloguePage()));
  app.get('/produit/:id', async (_request, reply) => reply.type('text/html; charset=utf-8').send(renderProductDetailPage()));
  app.get('/assistant', async (_request, reply) => reply.type('text/html; charset=utf-8').send(renderAssistantPage()));
  app.get('/notifications', async (_request, reply) => reply.type('text/html; charset=utf-8').send(renderNotificationsPage()));
  app.get('/commande', async (_request, reply) => reply.type('text/html; charset=utf-8').send(renderOrderPage()));
  app.get('/acheteur', async (_request, reply) => reply.type('text/html; charset=utf-8').send(renderBuyerPage()));
  app.get('/producteur', async (_request, reply) => reply.type('text/html; charset=utf-8').send(renderProducerPage()));
  app.get('/admin', async (_request, reply) => reply.type('text/html; charset=utf-8').send(renderAdminPage()));

  app.post('/api/auth/register', async (request, reply) => {
    const body = parse(registerSchema, request.body);
    const passwordHash = await bcrypt.hash(body.password, 12);
    try {
      const user = await prisma.user.create({
        data: { name: body.name, phone: body.phone, email: body.email, passwordHash, role: body.role as Role },
      });
      const token = await reply.jwtSign({ sub: user.id, role: user.role, name: user.name });
      return reply.code(201).send({ user: publicUser(user), token });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new HttpError(409, 'USER_EXISTS', 'Ce numéro ou cet e-mail est déjà utilisé.');
      }
      throw error;
    }
  });

  app.post('/api/auth/login', async (request, reply) => {
    const body = parse(loginSchema, request.body);
    const user = await prisma.user.findFirst({ where: { OR: [{ phone: body.identifier }, { email: body.identifier }] } });
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Identifiant ou mot de passe incorrect.');
    }
    const token = await reply.jwtSign({ sub: user.id, role: user.role, name: user.name });
    return { user: publicUser(user), token };
  });

  app.get('/api/me', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    const profile = await prisma.user.findUnique({ where: { id: user.sub } });
    if (!profile) throw new HttpError(404, 'USER_NOT_FOUND', 'Utilisateur introuvable.');
    return { user: publicUser(profile) };
  });

  app.get('/api/products', async (request) => {
    const filters = parse(productFiltersSchema, request.query);
    const where: Prisma.ProductWhereInput = { status: filters.status ?? ProductStatus.ACTIVE };
    if (filters.kind) where.kind = filters.kind;
    if (filters.category) where.category = filters.category;
    if (filters.region) where.location = { contains: filters.region };
    if (filters.q) {
      where.OR = [
        { title: { contains: filters.q } },
        { category: { contains: filters.q } },
        { description: { contains: filters.q } },
      ];
    }
    const products = await prisma.product.findMany({
      where,
      include: { producer: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return { products: products.map(publicProduct) };
  });

  app.get('/api/products/:id/image', async (request, reply) => {
    const { id } = request.params as { id: string };
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product?.imageUrl) throw new HttpError(404, 'PRODUCT_IMAGE_NOT_FOUND', 'Image produit introuvable.');

    const user = await optionalAuthenticate(request);
    const isOwner = user?.sub === product.producerId || user?.role === Role.ADMIN;
    if (product.status !== ProductStatus.ACTIVE && !isOwner) {
      throw new HttpError(404, 'PRODUCT_IMAGE_NOT_FOUND', 'Image produit introuvable.');
    }

    const image = await downloadProductImage(product.imageUrl);
    reply.type(image.contentType).header('Cache-Control', product.status === ProductStatus.ACTIVE ? 'public, max-age=3600' : 'private, no-store');
    return reply.send(image.buffer);
  });

  app.get('/api/products/:id', async (request) => {
    const { id } = request.params as { id: string };
    const product = await prisma.product.findUnique({ where: { id }, include: { producer: { select: { id: true, name: true } } } });
    if (!product) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Produit introuvable.');
    return { product: publicProduct(product) };
  });

  app.get('/api/products/mine', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    requireRole(user, Role.PRODUCER, Role.ADMIN);
    const products = await prisma.product.findMany({
      where: user.role === Role.ADMIN ? undefined : { producerId: user.sub },
      include: { producer: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return { products: products.map(publicProduct) };
  });

  app.get('/api/assistant/history', async (request) => {
    const { conversationKey } = parse(assistantHistorySchema, request.query);
    const user = await optionalAuthenticate(request);
    const conversation = await prisma.chatConversation.findUnique({
      where: { clientKey: conversationKey },
      include: { messages: { orderBy: { createdAt: 'asc' }, take: 40 } },
    });
    if (!conversation) return { conversationKey, messages: [] };
    if (conversation.userId && conversation.userId !== user?.sub) {
      throw new HttpError(403, 'FORBIDDEN', 'Cette conversation ne vous appartient pas.');
    }
    return {
      conversationKey,
      messages: conversation.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
      })),
    };
  });

  app.post('/api/assistant/chat', async (request, reply) => {
    const body = parse(assistantSchema, request.body);
    const user = await optionalAuthenticate(request);
    const conversationKey = body.conversationKey ?? randomUUID();
    const rateLimitKey = user ? `user:${user.sub}` : `guest:${request.ip}:${conversationKey}`;
    const rateLimit = assistantRateLimiter.consume(
      rateLimitKey,
      config.assistantRateLimitMax,
      config.assistantRateLimitWindowMs,
    );
    if (!rateLimit.allowed) {
      reply.header('Retry-After', String(rateLimit.retryAfterSeconds));
      throw new HttpError(429, 'ASSISTANT_RATE_LIMITED', `Weli reçoit beaucoup de demandes. Réessayez dans ${rateLimit.retryAfterSeconds} seconde${rateLimit.retryAfterSeconds > 1 ? 's' : ''}.`);
    }
    const existingConversation = await prisma.chatConversation.findUnique({ where: { clientKey: conversationKey } });

    if (existingConversation?.userId && existingConversation.userId !== user?.sub) {
      throw new HttpError(403, 'FORBIDDEN', 'Cette conversation ne vous appartient pas.');
    }

    const conversation = existingConversation
      ? await prisma.chatConversation.update({
        where: { id: existingConversation.id },
        data: user && !existingConversation.userId ? { userId: user.sub } : {},
      })
      : await prisma.chatConversation.create({ data: { clientKey: conversationKey, userId: user?.sub } });

    const history = await prisma.chatMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      take: 8,
    });

    await prisma.chatMessage.create({
      data: { conversationId: conversation.id, role: 'USER', content: body.message },
    });

    const products = await prisma.product.findMany({
      include: { producer: { select: { id: true, name: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    let answer: Awaited<ReturnType<typeof answerWeli>>;
    try {
      answer = await answerWeli({
        message: body.message,
        products,
        history: history.reverse().map((message) => ({ role: message.role, content: message.content })),
      });
    } catch (error) {
      if (error instanceof WeliProviderError) {
        throw new HttpError(error.statusCode, error.code, error.message);
      }
      throw error;
    }

    const assistantMessage = await prisma.chatMessage.create({
      data: { conversationId: conversation.id, role: 'ASSISTANT', content: answer.reply, provider: answer.provider },
    });

    return {
      ...answer,
      conversationKey,
      message: { id: assistantMessage.id, role: assistantMessage.role, content: assistantMessage.content, createdAt: assistantMessage.createdAt },
      liveCatalogAt: new Date().toISOString(),
    };
  });

  app.post('/api/products', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    requireRole(user, Role.PRODUCER, Role.ADMIN);
    const payload = await readProductPayload(request);
    const body = parse(productSchema, payload.body);
    if (payload.image && !isProductImageStorageConfigured()) {
      throw new HttpError(503, 'PRODUCT_IMAGE_STORAGE_NOT_CONFIGURED', 'Le stockage des images n’est pas encore configuré.');
    }

    let product = await prisma.product.create({
      data: {
        title: body.title,
        kind: body.kind,
        category: body.category,
        unit: body.unit,
        priceXaf: body.priceXaf,
        quantity: body.quantity,
        location: body.location,
        description: body.description,
        imageUrl: body.imageUrl,
        status: body.quantity > 0 ? ProductStatus.ACTIVE : ProductStatus.SOLD_OUT,
        producerId: user.sub,
      },
      include: { producer: { select: { id: true, name: true } } },
    });

    if (payload.image) {
      try {
        const storedImage = await uploadProductImage(payload.image, { producerId: user.sub, productId: product.id });
        product = await prisma.product.update({
          where: { id: product.id },
          data: { imageUrl: storedImage.path },
          include: { producer: { select: { id: true, name: true } } },
        });
      } catch (error) {
        await prisma.product.delete({ where: { id: product.id } }).catch(() => undefined);
        throw error;
      }
    }

    return reply.code(201).send({ product: publicProduct(product) });
  });

  app.post('/api/products/:id/image', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    requireRole(user, Role.PRODUCER, Role.ADMIN);
    const { id } = request.params as { id: string };
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Produit introuvable.');
    if (user.role !== Role.ADMIN && existing.producerId !== user.sub) {
      throw new HttpError(403, 'FORBIDDEN', 'Vous ne gérez pas cette offre.');
    }
    const payload = await readProductPayload(request);
    if (!payload.image) throw new HttpError(400, 'PRODUCT_IMAGE_REQUIRED', 'Sélectionnez une image à enregistrer.');
    const storedImage = await uploadProductImage(payload.image, { producerId: existing.producerId, productId: existing.id });
    const product = await prisma.product.update({
      where: { id },
      data: { imageUrl: storedImage.path },
      include: { producer: { select: { id: true, name: true } } },
    });
    if (existing.imageUrl && existing.imageUrl !== storedImage.path) {
      await removeProductImage(existing.imageUrl).catch((error) => request.log.warn({ error }, 'old product image cleanup failed'));
    }
    return { product: publicProduct(product) };
  });

  app.delete('/api/products/:id/image', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    requireRole(user, Role.PRODUCER, Role.ADMIN);
    const { id } = request.params as { id: string };
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Produit introuvable.');
    if (user.role !== Role.ADMIN && existing.producerId !== user.sub) {
      throw new HttpError(403, 'FORBIDDEN', 'Vous ne gérez pas cette offre.');
    }
    if (existing.imageUrl) await removeProductImage(existing.imageUrl);
    const product = await prisma.product.update({
      where: { id },
      data: { imageUrl: null },
      include: { producer: { select: { id: true, name: true } } },
    });
    return { product: publicProduct(product) };
  });

  app.patch('/api/products/:id/stock', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    requireRole(user, Role.PRODUCER, Role.ADMIN);
    const { id } = request.params as { id: string };
    const body = parse(stockSchema, request.body);
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Produit introuvable.');
    if (user.role !== Role.ADMIN && existing.producerId !== user.sub) throw new HttpError(403, 'FORBIDDEN', 'Vous ne gérez pas cette offre.');
    if (body.quantity < existing.reservedQuantity) {
      throw new HttpError(409, 'STOCK_BELOW_RESERVATIONS', 'La nouvelle quantité est inférieure aux demandes déjà réservées.');
    }
    const product = await prisma.product.update({
      where: { id },
      data: {
        quantity: body.quantity,
        reservedQuantity: existing.reservedQuantity,
        lastStockAt: new Date(),
        status: body.status ?? (body.quantity === 0 ? ProductStatus.SOLD_OUT : ProductStatus.ACTIVE),
      },
      include: { producer: { select: { id: true, name: true } } },
    });
    return { product: publicProduct(product) };
  });

  app.post('/api/products/:id/requests', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    requireRole(user, Role.BUYER);
    const { id } = request.params as { id: string };
    const body = parse(requestSchema, request.body);

    const created = await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id } });
      if (!product) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Produit introuvable.');
      const availability = getAvailability(product);
      if (availability.state === 'CHECK_REQUIRED') {
        throw new HttpError(409, 'AVAILABILITY_CHECK_REQUIRED', 'La disponibilité doit être reconfirmée par le producteur avant la demande.');
      }
      if (availability.state === 'PAUSED' || availability.state === 'OUT_OF_STOCK' || availability.availableQuantity < body.quantity) {
        throw new HttpError(409, 'INSUFFICIENT_STOCK', 'La quantité demandée n’est plus disponible.');
      }
      const expiresAt = new Date(Date.now() + config.requestHoldHours * 3_600_000);
      const createdRequest = await tx.purchaseRequest.create({
        data: {
          productId: product.id,
          buyerId: user.sub,
          producerId: product.producerId,
          quantity: body.quantity,
          unitPriceXaf: product.priceXaf,
          totalXaf: body.quantity * product.priceXaf,
          requestedPickup: body.requestedPickup,
          message: body.message,
          expiresAt,
        },
        include: { product: true, buyer: true, producer: true, payment: true },
      });
      await tx.product.update({ where: { id: product.id }, data: { reservedQuantity: { increment: body.quantity } } });
      await tx.notification.create({
        data: {
          userId: product.producerId,
          requestId: createdRequest.id,
          type: NotificationType.PURCHASE_REQUEST,
          title: 'Nouvelle demande d’achat',
          body: `${user.name} demande ${body.quantity} ${product.unit} de ${product.title}.`,
        },
      });
      return createdRequest;
    });

    return reply.code(201).send({ request: requestView(created) });
  });

  app.post('/api/orders/checkout', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    requireRole(user, Role.BUYER);
    const body = parse(checkoutSchema, request.body);

    const created = await prisma.$transaction(async (tx) => {
      const requests = [];
      for (const item of body.items) {
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (!product) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Un produit de la commande est introuvable.');
        const availability = getAvailability(product);
        if (availability.state === 'CHECK_REQUIRED') throw new HttpError(409, 'AVAILABILITY_CHECK_REQUIRED', `La disponibilité de ${product.title} doit être reconfirmée.`);
        if (availability.state === 'PAUSED' || availability.state === 'OUT_OF_STOCK' || availability.availableQuantity < item.quantity) {
          throw new HttpError(409, 'INSUFFICIENT_STOCK', `La quantité demandée pour ${product.title} n’est plus disponible.`);
        }
        const createdRequest = await tx.purchaseRequest.create({
          data: {
            productId: product.id,
            buyerId: user.sub,
            producerId: product.producerId,
            quantity: item.quantity,
            unitPriceXaf: product.priceXaf,
            totalXaf: item.quantity * product.priceXaf,
            requestedPickup: body.requestedPickup,
            message: 'Commande validée depuis le panier Weli-Link.',
            expiresAt: new Date(Date.now() + config.requestHoldHours * 3_600_000),
          },
          include: { product: true, buyer: true, producer: true, payment: true },
        });
        await tx.product.update({ where: { id: product.id }, data: { reservedQuantity: { increment: item.quantity } } });
        await tx.notification.create({
          data: {
            userId: product.producerId,
            requestId: createdRequest.id,
            type: NotificationType.PURCHASE_REQUEST,
            title: 'Nouvelle commande à confirmer',
            body: `${user.name} commande ${item.quantity} ${product.unit} de ${product.title}.`,
          },
        });
        requests.push(createdRequest);
      }
      return requests;
    });

    return reply.code(201).send({ requests: created.map(requestView) });
  });

  app.get('/api/requests/mine', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    requireRole(user, Role.BUYER);
    const requests = await prisma.purchaseRequest.findMany({
      where: { buyerId: user.sub },
      include: { product: true, buyer: true, producer: true, payment: true },
      orderBy: { createdAt: 'desc' },
    });
    return { requests: requests.map(requestView) };
  });

  app.get('/api/requests/received', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    requireRole(user, Role.PRODUCER, Role.ADMIN);
    const requests = await prisma.purchaseRequest.findMany({
      where: user.role === Role.ADMIN ? undefined : { producerId: user.sub },
      include: { product: true, buyer: true, producer: true, payment: true },
      orderBy: { createdAt: 'desc' },
    });
    return { requests: requests.map(requestView) };
  });

  app.get('/api/dashboard/producer', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    requireRole(user, Role.PRODUCER);

    const [products, requests, unreadNotifications] = await Promise.all([
      prisma.product.findMany({
        where: { producerId: user.sub },
        include: { producer: { select: { id: true, name: true } } },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.purchaseRequest.findMany({
        where: { producerId: user.sub },
        include: { product: true, buyer: true, producer: true, payment: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.notification.count({ where: { userId: user.sub, readAt: null } }),
    ]);

    const productViews = products.map(managedProductView);
    const requestViews = requests.map(requestView);
    const lowOrStale = productViews.filter((product) => ['LOW_STOCK', 'CHECK_REQUIRED', 'OUT_OF_STOCK', 'PAUSED'].includes(product.availability.state));
    const completedOrdersXaf = requestViews
      .filter((purchaseRequest) => purchaseRequest.status === RequestStatus.COMPLETED)
      .reduce((total, purchaseRequest) => total + purchaseRequest.totalXaf, 0);

    return {
      metrics: {
        publishedProducts: productViews.length,
        activeProducts: productViews.filter((product) => product.status === ProductStatus.ACTIVE).length,
        pendingRequests: requestViews.filter((purchaseRequest) => purchaseRequest.status === RequestStatus.PENDING).length,
        attentionProducts: lowOrStale.length,
        completedOrdersXaf,
        unreadNotifications,
      },
      products: productViews,
      requests: requestViews,
      attentionProducts: lowOrStale.slice(0, 8),
    };
  });

  app.get('/api/dashboard/admin', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    requireRole(user, Role.ADMIN);

    const [users, products, requests] = await Promise.all([
      prisma.user.findMany({ select: { id: true, name: true, role: true, phone: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 12 }),
      prisma.product.findMany({ include: { producer: { select: { id: true, name: true } } }, orderBy: { updatedAt: 'desc' }, take: 100 }),
      prisma.purchaseRequest.findMany({ include: { product: true, buyer: true, producer: true, payment: true }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);

    const productViews = products.map(managedProductView);
    const requestViews = requests.map(requestView);
    const attentionProducts = productViews.filter((product) => product.availability.state !== 'AVAILABLE');

    return {
      metrics: {
        users: await prisma.user.count(),
        producers: await prisma.user.count({ where: { role: Role.PRODUCER } }),
        buyers: await prisma.user.count({ where: { role: Role.BUYER } }),
        activeProducts: productViews.filter((product) => product.status === ProductStatus.ACTIVE).length,
        pendingRequests: requestViews.filter((purchaseRequest) => purchaseRequest.status === RequestStatus.PENDING).length,
      },
      users,
      products: productViews,
      requests: requestViews,
      attentionProducts: attentionProducts.slice(0, 10),
    };
  });

  app.patch('/api/requests/:id/status', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    requireRole(user, Role.PRODUCER, Role.ADMIN);
    const { id } = request.params as { id: string };
    const body = parse(requestDecisionSchema, request.body);

    const updated = await prisma.$transaction(async (tx) => {
      const purchaseRequest = await tx.purchaseRequest.findUnique({ where: { id }, include: { product: true, buyer: true, producer: true, payment: true } });
      if (!purchaseRequest) throw new HttpError(404, 'REQUEST_NOT_FOUND', 'Demande introuvable.');
      if (user.role !== Role.ADMIN && purchaseRequest.producerId !== user.sub) throw new HttpError(403, 'FORBIDDEN', 'Vous ne gérez pas cette demande.');
      if (purchaseRequest.status !== RequestStatus.PENDING) throw new HttpError(409, 'REQUEST_ALREADY_DECIDED', 'Cette demande a déjà été traitée.');

      if (body.status === 'ACCEPTED') {
        if (
          purchaseRequest.product.quantity < purchaseRequest.quantity ||
          purchaseRequest.product.reservedQuantity < purchaseRequest.quantity
        ) {
          throw new HttpError(409, 'STOCK_CHANGED', 'Le stock a changé. Reconfirmez la disponibilité avant d’accepter.');
        }
        await tx.notification.create({
          data: {
            userId: purchaseRequest.buyerId,
            requestId: purchaseRequest.id,
            type: NotificationType.REQUEST_ACCEPTED,
            title: 'Commande confirmée',
            body: `${purchaseRequest.producer.name} a confirmé ${purchaseRequest.product.title}. Organisez maintenant la livraison ou le retrait directement avec le producteur.`,
          },
        });
        return tx.purchaseRequest.update({
          where: { id },
          data: { status: RequestStatus.ACCEPTED, paymentStatus: PaymentStatus.NONE },
          include: { product: true, buyer: true, producer: true, payment: true },
        });
      }

      await tx.product.update({ where: { id: purchaseRequest.productId }, data: { reservedQuantity: { decrement: purchaseRequest.quantity } } });
      await tx.notification.create({
        data: {
          userId: purchaseRequest.buyerId,
          requestId: purchaseRequest.id,
          type: NotificationType.REQUEST_REJECTED,
          title: 'Commande non disponible',
          body: `${purchaseRequest.producer.name} ne peut pas confirmer cette offre pour le moment.`,
        },
      });
      return tx.purchaseRequest.update({
        where: { id },
        data: { status: RequestStatus.REJECTED },
        include: { product: true, buyer: true, producer: true, payment: true },
      });
    });

    return { request: requestView(updated) };
  });

  app.post('/api/requests/:id/cancel', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    requireRole(user, Role.BUYER);
    const { id } = request.params as { id: string };

    const updated = await prisma.$transaction(async (tx) => {
      const purchaseRequest = await tx.purchaseRequest.findUnique({ where: { id }, include: { product: true, buyer: true, producer: true, payment: true } });
      if (!purchaseRequest) throw new HttpError(404, 'REQUEST_NOT_FOUND', 'Commande introuvable.');
      if (purchaseRequest.buyerId !== user.sub) throw new HttpError(403, 'FORBIDDEN', 'Cette commande ne vous appartient pas.');
      if (purchaseRequest.status !== RequestStatus.PENDING) {
        throw new HttpError(409, 'ORDER_CANNOT_BE_CANCELLED', 'Cette commande a déjà été confirmée. Envoyez une demande d’annulation avec un justificatif.');
      }

      await tx.product.update({ where: { id: purchaseRequest.productId }, data: { reservedQuantity: { decrement: purchaseRequest.quantity } } });
      await tx.notification.create({
        data: {
          userId: purchaseRequest.producerId,
          requestId: purchaseRequest.id,
          type: NotificationType.SYSTEM,
          title: 'Commande annulée par l’acheteur',
          body: `${purchaseRequest.buyer.name} a annulé sa commande de ${purchaseRequest.product.title} avant votre confirmation.`,
        },
      });
      return tx.purchaseRequest.update({
        where: { id },
        data: { status: RequestStatus.CANCELLED },
        include: { product: true, buyer: true, producer: true, payment: true },
      });
    });

    return { request: requestView(updated) };
  });

  app.post('/api/requests/:id/cancellation', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    requireRole(user, Role.BUYER);
    const { id } = request.params as { id: string };
    const body = parse(cancellationEvidenceSchema, request.body);

    const updated = await prisma.$transaction(async (tx) => {
      const purchaseRequest = await tx.purchaseRequest.findUnique({ where: { id }, include: { product: true, buyer: true, producer: true, payment: true } });
      if (!purchaseRequest) throw new HttpError(404, 'REQUEST_NOT_FOUND', 'Commande introuvable.');
      if (purchaseRequest.buyerId !== user.sub) throw new HttpError(403, 'FORBIDDEN', 'Cette commande ne vous appartient pas.');
      if (purchaseRequest.status !== RequestStatus.ACCEPTED) {
        throw new HttpError(409, 'CANCELLATION_NOT_ALLOWED', 'Une demande d’annulation est possible après confirmation du producteur et avant la réception.');
      }

      const next = await tx.purchaseRequest.update({
        where: { id },
        data: { status: RequestStatus.CANCELLATION_REQUESTED, cancellationEvidence: body.evidence, cancellationRequestedAt: new Date() },
        include: { product: true, buyer: true, producer: true, payment: true },
      });
      await tx.notification.create({
        data: {
          userId: purchaseRequest.producerId,
          requestId: purchaseRequest.id,
          type: NotificationType.SYSTEM,
          title: 'Demande d’annulation à examiner',
          body: `${purchaseRequest.buyer.name} demande l’annulation de ${purchaseRequest.product.title}. Justificatif : ${body.evidence}`,
        },
      });
      return next;
    });

    return { request: requestView(updated) };
  });

  app.patch('/api/requests/:id/cancellation', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    requireRole(user, Role.PRODUCER, Role.ADMIN);
    const { id } = request.params as { id: string };
    const body = parse(cancellationDecisionSchema, request.body);

    const updated = await prisma.$transaction(async (tx) => {
      const purchaseRequest = await tx.purchaseRequest.findUnique({ where: { id }, include: { product: true, buyer: true, producer: true, payment: true } });
      if (!purchaseRequest) throw new HttpError(404, 'REQUEST_NOT_FOUND', 'Commande introuvable.');
      if (user.role !== Role.ADMIN && purchaseRequest.producerId !== user.sub) throw new HttpError(403, 'FORBIDDEN', 'Vous ne gérez pas cette commande.');
      if (purchaseRequest.status !== RequestStatus.CANCELLATION_REQUESTED) {
        throw new HttpError(409, 'CANCELLATION_ALREADY_DECIDED', 'Cette demande d’annulation a déjà été traitée.');
      }

      if (body.decision === 'APPROVED') {
        await tx.product.update({ where: { id: purchaseRequest.productId }, data: { reservedQuantity: { decrement: purchaseRequest.quantity } } });
      }
      const nextStatus = body.decision === 'APPROVED' ? RequestStatus.CANCELLED : RequestStatus.ACCEPTED;
      const next = await tx.purchaseRequest.update({
        where: { id },
        data: { status: nextStatus },
        include: { product: true, buyer: true, producer: true, payment: true },
      });
      await tx.notification.create({
        data: {
          userId: purchaseRequest.buyerId,
          requestId: purchaseRequest.id,
          type: NotificationType.SYSTEM,
          title: body.decision === 'APPROVED' ? 'Annulation acceptée' : 'Commande maintenue',
          body: body.decision === 'APPROVED'
            ? `Le producteur a accepté l’annulation de votre commande de ${purchaseRequest.product.title}.`
            : `Le producteur n’a pas accepté l’annulation. Contactez-le directement pour organiser la livraison de ${purchaseRequest.product.title}.`,
        },
      });
      return next;
    });

    return { request: requestView(updated) };
  });

  app.post('/api/requests/:id/confirm-receipt', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    requireRole(user, Role.BUYER);
    const { id } = request.params as { id: string };

    const updated = await prisma.$transaction(async (tx) => {
      const purchaseRequest = await tx.purchaseRequest.findUnique({ where: { id }, include: { product: true, buyer: true, producer: true, payment: true } });
      if (!purchaseRequest) throw new HttpError(404, 'REQUEST_NOT_FOUND', 'Commande introuvable.');
      if (purchaseRequest.buyerId !== user.sub) throw new HttpError(403, 'FORBIDDEN', 'Cette commande ne vous appartient pas.');
      if (purchaseRequest.status !== RequestStatus.ACCEPTED) throw new HttpError(409, 'RECEIPT_NOT_ALLOWED', 'La réception peut être confirmée uniquement pour une commande acceptée.');

      await tx.product.update({
        where: { id: purchaseRequest.productId },
        data: {
          quantity: { decrement: purchaseRequest.quantity },
          reservedQuantity: { decrement: purchaseRequest.quantity },
          status: purchaseRequest.product.quantity - purchaseRequest.quantity <= 0 ? ProductStatus.SOLD_OUT : ProductStatus.ACTIVE,
          lastStockAt: new Date(),
        },
      });
      const next = await tx.purchaseRequest.update({
        where: { id },
        data: { status: RequestStatus.COMPLETED, completedAt: new Date(), paymentStatus: PaymentStatus.NONE },
        include: { product: true, buyer: true, producer: true, payment: true },
      });
      await tx.notification.create({
        data: {
          userId: purchaseRequest.producerId,
          requestId: purchaseRequest.id,
          type: NotificationType.SYSTEM,
          title: 'Réception confirmée',
          body: `${purchaseRequest.buyer.name} a confirmé la réception de ${purchaseRequest.quantity} ${purchaseRequest.product.unit} de ${purchaseRequest.product.title}.`,
        },
      });
      return next;
    });

    return { request: requestView(updated) };
  });

  app.get('/api/notifications', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    const query = z.object({ unreadOnly: z.coerce.boolean().default(false) }).parse(request.query);
    const notifications = await prisma.notification.findMany({
      where: { userId: user.sub, ...(query.unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { notifications, unreadCount: await prisma.notification.count({ where: { userId: user.sub, readAt: null } }) };
  });

  app.patch('/api/notifications/:id/read', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const notification = await prisma.notification.findFirst({ where: { id, userId: user.sub } });
    if (!notification) throw new HttpError(404, 'NOTIFICATION_NOT_FOUND', 'Notification introuvable.');
    return { notification: await prisma.notification.update({ where: { id }, data: { readAt: new Date() } }) };
  });

  app.post('/api/notifications/push-subscriptions', async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    const body = parse(pushSubscriptionSchema, request.body);
    const subscription = await prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      update: { p256dh: body.p256dh, auth: body.auth, userId: user.sub },
      create: { ...body, userId: user.sub },
    });
    return reply.code(201).send({ subscription: { id: subscription.id, endpoint: subscription.endpoint } });
  });

  return app;
}

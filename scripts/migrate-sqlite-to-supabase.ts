import 'dotenv/config';
import { PrismaClient as SqlitePrismaClient } from '@prisma/client';
import { Pool, type PoolClient } from 'pg';

const sourceUrl = process.env.SQLITE_DATABASE_URL?.trim() || 'file:./dev.db';
const targetUrl = process.env.SUPABASE_DIRECT_URL?.trim() || process.env.SUPABASE_DATABASE_URL?.trim();

if (!sourceUrl.startsWith('file:')) {
  throw new Error('SQLITE_DATABASE_URL doit être une URL file: de SQLite.');
}
if (!targetUrl?.startsWith('postgresql://') && !targetUrl?.startsWith('postgres://')) {
  throw new Error('SUPABASE_DATABASE_URL doit être l’URL PostgreSQL de la base Supabase.');
}

const source = new SqlitePrismaClient({ datasources: { db: { url: sourceUrl } } });
const pool = new Pool({ connectionString: targetUrl, max: 1 });

async function insertRows(client: PoolClient, table: string, columns: string[], rows: unknown[][]) {
  if (!rows.length) return;
  const values: unknown[] = [];
  const placeholders = rows.map((row, rowIndex) => {
    const rowPlaceholders = row.map((value, columnIndex) => {
      values.push(value);
      return `$${rowIndex * columns.length + columnIndex + 1}`;
    });
    return `(${rowPlaceholders.join(', ')})`;
  });
  const quotedColumns = columns.map((column) => `"${column}"`).join(', ');
  await client.query(`INSERT INTO "${table}" (${quotedColumns}) VALUES ${placeholders.join(', ')} ON CONFLICT DO NOTHING`, values);
}

async function migrate() {
  const [users, products, requests, payments, notifications, pushSubscriptions, conversations, messages] = await Promise.all([
    source.user.findMany(),
    source.product.findMany(),
    source.purchaseRequest.findMany(),
    source.payment.findMany(),
    source.notification.findMany(),
    source.pushSubscription.findMany(),
    source.chatConversation.findMany(),
    source.chatMessage.findMany(),
  ]);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await insertRows(client, 'User', ['id', 'name', 'phone', 'email', 'passwordHash', 'role', 'createdAt', 'updatedAt'], users.map((row) => [row.id, row.name, row.phone, row.email, row.passwordHash, row.role, row.createdAt, row.updatedAt]));
    await insertRows(client, 'Product', ['id', 'title', 'kind', 'category', 'unit', 'priceXaf', 'quantity', 'reservedQuantity', 'location', 'description', 'imageUrl', 'status', 'lastStockAt', 'createdAt', 'updatedAt', 'producerId'], products.map((row) => [row.id, row.title, row.kind, row.category, row.unit, row.priceXaf, row.quantity, row.reservedQuantity, row.location, row.description, row.imageUrl, row.status, row.lastStockAt, row.createdAt, row.updatedAt, row.producerId]));
    await insertRows(client, 'PurchaseRequest', ['id', 'quantity', 'unitPriceXaf', 'totalXaf', 'message', 'requestedPickup', 'status', 'paymentStatus', 'cancellationEvidence', 'cancellationRequestedAt', 'completedAt', 'expiresAt', 'createdAt', 'updatedAt', 'productId', 'buyerId', 'producerId'], requests.map((row) => [row.id, row.quantity, row.unitPriceXaf, row.totalXaf, row.message, row.requestedPickup, row.status, row.paymentStatus, row.cancellationEvidence, row.cancellationRequestedAt, row.completedAt, row.expiresAt, row.createdAt, row.updatedAt, row.productId, row.buyerId, row.producerId]));
    await insertRows(client, 'Payment', ['id', 'provider', 'phone', 'amountXaf', 'externalReference', 'status', 'createdAt', 'updatedAt', 'requestId'], payments.map((row) => [row.id, row.provider, row.phone, row.amountXaf, row.externalReference, row.status, row.createdAt, row.updatedAt, row.requestId]));
    await insertRows(client, 'Notification', ['id', 'type', 'title', 'body', 'readAt', 'createdAt', 'userId', 'requestId'], notifications.map((row) => [row.id, row.type, row.title, row.body, row.readAt, row.createdAt, row.userId, row.requestId]));
    await insertRows(client, 'PushSubscription', ['id', 'endpoint', 'p256dh', 'auth', 'createdAt', 'updatedAt', 'userId'], pushSubscriptions.map((row) => [row.id, row.endpoint, row.p256dh, row.auth, row.createdAt, row.updatedAt, row.userId]));
    await insertRows(client, 'ChatConversation', ['id', 'clientKey', 'userId', 'createdAt', 'updatedAt'], conversations.map((row) => [row.id, row.clientKey, row.userId, row.createdAt, row.updatedAt]));
    await insertRows(client, 'ChatMessage', ['id', 'role', 'content', 'provider', 'createdAt', 'conversationId'], messages.map((row) => [row.id, row.role, row.content, row.provider, row.createdAt, row.conversationId]));
    await client.query('COMMIT');
    console.log(JSON.stringify({ migrated: { users: users.length, products: products.length, requests: requests.length, payments: payments.length, notifications: notifications.length, pushSubscriptions: pushSubscriptions.length, conversations: conversations.length, messages: messages.length } }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN';
    throw new Error(`La migration Supabase a échoué (${code}). Vérifiez le schéma et les URLs de connexion.`);
  } finally {
    client.release();
  }
}

try {
  await migrate();
} finally {
  await source.$disconnect();
  await pool.end();
}

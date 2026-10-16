import { buildApp } from './app.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { expirePendingRequests } from './expiration.js';

const app = await buildApp(prisma);
const expiryTimer = setInterval(() => {
  void expirePendingRequests(prisma).catch((error) => app.log.error(error, 'request expiry job failed'));
}, 60_000);
expiryTimer.unref();

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  clearInterval(expiryTimer);
  await prisma.$disconnect();
  process.exit(1);
}

const close = async () => {
  clearInterval(expiryTimer);
  await app.close();
  await prisma.$disconnect();
};

process.on('SIGINT', close);
process.on('SIGTERM', close);

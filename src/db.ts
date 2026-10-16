import { PrismaClient } from '@prisma/client';
import { config } from './config.js';

// Prefer the direct Supabase connection when the session pooler cannot be used
// from the current network. This value stays on the server and is never sent
// to the browser.
export const prisma = new PrismaClient({
  datasources: config.supabaseDirectUrl ? { db: { url: config.supabaseDirectUrl } } : undefined,
});

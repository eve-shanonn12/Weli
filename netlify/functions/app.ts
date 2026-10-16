import type { Config } from '@netlify/functions';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';

let appPromise: ReturnType<typeof buildApp> | null = null;

// Runs the whole Fastify app inside a single Netlify Function, mirroring api/index.ts on Vercel.
export default async (request: Request) => {
  if (!appPromise) {
    appPromise = buildApp(prisma).then(async (app) => {
      await app.ready();
      return app;
    });
  }
  const app = await appPromise;

  const url = new URL(request.url);
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const response = await app.inject({
    method: request.method as 'GET',
    url: `${url.pathname}${url.search}`,
    headers: Object.fromEntries(request.headers),
    payload: hasBody ? Buffer.from(await request.arrayBuffer()) : undefined,
  });

  const headers = new Headers();
  for (const [name, value] of Object.entries(response.headers)) {
    if (value === undefined || name === 'content-length' || name === 'transfer-encoding') continue;
    for (const item of Array.isArray(value) ? value : [String(value)]) headers.append(name, item);
  }
  const noBody = request.method === 'HEAD' || response.statusCode === 204 || response.statusCode === 304;
  return new Response(noBody ? null : response.rawPayload, { status: response.statusCode, headers });
};

export const config: Config = {
  path: '/*',
};

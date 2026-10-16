import type { Role } from '@prisma/client';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; role: Role; name: string };
    user: { sub: string; role: Role; name: string };
  }
}

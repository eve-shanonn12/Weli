import 'dotenv/config';
import { isAbsolute, resolve } from 'node:path';

const numberFromEnv = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const boundedNumberFromEnv = (value: string | undefined, fallback: number, minimum: number, maximum: number) => (
  Math.min(maximum, Math.max(minimum, numberFromEnv(value, fallback)))
);

const projectFile = (value: string | undefined, fallback: string) => {
  const target = value?.trim() || fallback;
  return isAbsolute(target) ? target : resolve(process.cwd(), target);
};

export const config = {
  host: process.env.HOST ?? '127.0.0.1',
  port: numberFromEnv(process.env.PORT, 3333),
  jwtSecret: process.env.JWT_SECRET ?? 'local-development-secret',
  freshStockTtlHours: numberFromEnv(process.env.FRESH_STOCK_TTL_HOURS, 6),
  processedStockTtlHours: numberFromEnv(process.env.PROCESSED_STOCK_TTL_HOURS, 72),
  requestHoldHours: numberFromEnv(process.env.REQUEST_HOLD_HOURS, 24),
  paymentWebhookSecret: process.env.PAYMENT_WEBHOOK_SECRET ?? 'local-payment-webhook-secret',
  frontendPath: projectFile(process.env.WELILINK_FRONTEND_PATH, 'frontend/welilink-web-home.html'),
  logoPath: projectFile(process.env.WELILINK_LOGO_PATH, 'assets/welilink-logo.png'),
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite',
  geminiTimeoutMs: boundedNumberFromEnv(process.env.GEMINI_TIMEOUT_MS, 12_000, 1_000, 60_000),
  geminiMaxOutputTokens: boundedNumberFromEnv(process.env.GEMINI_MAX_OUTPUT_TOKENS, 220, 32, 500),
  assistantRateLimitMax: boundedNumberFromEnv(process.env.ASSISTANT_RATE_LIMIT_MAX, 8, 1, 30),
  assistantRateLimitWindowMs: boundedNumberFromEnv(process.env.ASSISTANT_RATE_LIMIT_WINDOW_MS, 60_000, 10_000, 300_000),
  supabaseUrl: process.env.SUPABASE_URL?.trim() || undefined,
  supabaseDirectUrl: process.env.SUPABASE_DIRECT_URL?.trim() || undefined,
  // This value is read only by the backend. Never expose it through a route or frontend bundle.
  supabaseServerKey: process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined,
  supabaseStorageBucket: process.env.SUPABASE_STORAGE_BUCKET?.trim() || 'product-images',
  productImageMaxBytes: boundedNumberFromEnv(process.env.PRODUCT_IMAGE_MAX_BYTES, 5 * 1024 * 1024, 256 * 1024, 10 * 1024 * 1024),
};

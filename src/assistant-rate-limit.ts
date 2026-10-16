export type AssistantRateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

/**
 * Lightweight, process-local protection for the assistant endpoint.
 * A future multi-instance deployment can replace this with Redis without
 * changing the route contract.
 */
export class AssistantRateLimiter {
  private readonly attempts = new Map<string, number[]>();

  consume(key: string, maxAttempts: number, windowMs: number, now = Date.now()): AssistantRateLimitResult {
    const safeMaxAttempts = Math.max(1, maxAttempts);
    const safeWindowMs = Math.max(1_000, windowMs);
    const cutoff = now - safeWindowMs;
    const recentAttempts = (this.attempts.get(key) ?? []).filter((attempt) => attempt > cutoff);

    if (recentAttempts.length >= safeMaxAttempts) {
      const retryAfterSeconds = Math.max(1, Math.ceil((recentAttempts[0] + safeWindowMs - now) / 1_000));
      this.attempts.set(key, recentAttempts);
      return { allowed: false, retryAfterSeconds };
    }

    recentAttempts.push(now);
    this.attempts.set(key, recentAttempts);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

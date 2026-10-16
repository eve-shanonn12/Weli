import { describe, expect, it } from 'vitest';
import { AssistantRateLimiter } from '../src/assistant-rate-limit.js';

describe('assistant rate limiter', () => {
  it('limits a visitor then allows a new message after the time window', () => {
    const limiter = new AssistantRateLimiter();

    expect(limiter.consume('visitor-1', 2, 60_000, 1_000)).toMatchObject({ allowed: true });
    expect(limiter.consume('visitor-1', 2, 60_000, 2_000)).toMatchObject({ allowed: true });
    expect(limiter.consume('visitor-1', 2, 60_000, 3_000)).toMatchObject({ allowed: false, retryAfterSeconds: 58 });
    expect(limiter.consume('visitor-1', 2, 60_000, 61_001)).toMatchObject({ allowed: true });
  });
});

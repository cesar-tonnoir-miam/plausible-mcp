import { describe, it, expect, vi, afterEach } from "vitest";
import { RateLimiter } from "../src/rate-limiter.js";

describe("RateLimiter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests under both limits", () => {
    const limiter = new RateLimiter(10, 5);
    for (let i = 0; i < 5; i++) {
      expect(limiter.consume("key-a").allowed).toBe(true);
    }
  });

  it("blocks once the per-key limit is reached, independent of the global limit", () => {
    const limiter = new RateLimiter(100, 2);
    expect(limiter.consume("key-a").allowed).toBe(true);
    expect(limiter.consume("key-a").allowed).toBe(true);
    const third = limiter.consume("key-a");
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("blocks once the global limit is reached even for distinct keys", () => {
    const limiter = new RateLimiter(2, 100);
    expect(limiter.consume("key-a").allowed).toBe(true);
    expect(limiter.consume("key-b").allowed).toBe(true);
    expect(limiter.consume("key-c").allowed).toBe(false);
  });

  it("does not let one key's usage block another key under the per-key limit", () => {
    const limiter = new RateLimiter(100, 1);
    expect(limiter.consume("key-a").allowed).toBe(true);
    expect(limiter.consume("key-a").allowed).toBe(false);
    expect(limiter.consume("key-b").allowed).toBe(true);
  });

  it("frees up capacity once the window slides past old hits", () => {
    vi.useFakeTimers();
    const windowMs = 60_000;
    const limiter = new RateLimiter(100, 1, windowMs);
    expect(limiter.consume("key-a").allowed).toBe(true);
    expect(limiter.consume("key-a").allowed).toBe(false);
    vi.advanceTimersByTime(windowMs + 1);
    expect(limiter.consume("key-a").allowed).toBe(true);
  });
});

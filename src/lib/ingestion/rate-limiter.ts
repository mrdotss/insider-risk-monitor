import { RateLimitResult } from "@/types";

// ============================================
// In-Memory Rate Limiter (MVP)
// ============================================

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

// In-memory store for rate limiting
// Key: sourceKey, Value: rate limit tracking data
const rateLimitStore = new Map<string, RateLimitEntry>();

// Window duration in milliseconds (1 minute)
const WINDOW_MS = 60 * 1000;

/**
 * Clean up expired entries from the rate limit store
 * Called periodically to prevent memory leaks
 */
function cleanupExpiredEntries(): void {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now - entry.windowStart >= WINDOW_MS) {
      rateLimitStore.delete(key);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupExpiredEntries, 5 * 60 * 1000);

/**
 * Check and update rate limit for a source
 * Uses sliding window algorithm with in-memory storage
 *
 * @param sourceKey - The unique key identifying the source
 * @param limit - Maximum requests allowed per minute
 * @returns RateLimitResult indicating if request is allowed
 */
export function checkRateLimit(
  sourceKey: string,
  limit: number
): RateLimitResult {
  const now = Date.now();
  const entry = rateLimitStore.get(sourceKey);

  // If no entry exists or window has expired, start fresh
  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    rateLimitStore.set(sourceKey, {
      count: 1,
      windowStart: now,
    });

    return {
      allowed: true,
      remaining: limit - 1,
      resetAt: new Date(now + WINDOW_MS),
    };
  }

  // Check if limit exceeded
  if (entry.count >= limit) {
    const resetAt = new Date(entry.windowStart + WINDOW_MS);
    return {
      allowed: false,
      remaining: 0,
      resetAt,
    };
  }

  // Increment count and allow request
  entry.count += 1;
  const remaining = Math.max(0, limit - entry.count);
  const resetAt = new Date(entry.windowStart + WINDOW_MS);

  return {
    allowed: true,
    remaining,
    resetAt,
  };
}

/**
 * Get current rate limit status without incrementing counter
 * Useful for checking status without consuming a request
 */
export function getRateLimitStatus(
  sourceKey: string,
  limit: number
): RateLimitResult {
  const now = Date.now();
  const entry = rateLimitStore.get(sourceKey);

  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    return {
      allowed: true,
      remaining: limit,
      resetAt: new Date(now + WINDOW_MS),
    };
  }

  const remaining = Math.max(0, limit - entry.count);
  const resetAt = new Date(entry.windowStart + WINDOW_MS);

  return {
    allowed: entry.count < limit,
    remaining,
    resetAt,
  };
}

/**
 * Reset rate limit for a source (useful for testing)
 */
export function resetRateLimit(sourceKey: string): void {
  rateLimitStore.delete(sourceKey);
}

/**
 * Clear all rate limits (useful for testing)
 */
export function clearAllRateLimits(): void {
  rateLimitStore.clear();
}

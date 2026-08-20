import type { RateLimiter } from "./rate-limiter.js";

/**
 * Everything a tool handler needs beyond the `PlausibleClient` itself, threaded down from
 * `createServer`. `allowedSites`/`rateLimiter` are `undefined` for the STDIO entry point (a
 * single local user with their own key has no multi-tenant surface to guard); the deployed
 * HTTP server always supplies both.
 */
export interface ToolContext {
  allowedSites?: string[];
  rateLimiter?: RateLimiter;
  callerFingerprint: string;
  maxResponseBytes: number;
}

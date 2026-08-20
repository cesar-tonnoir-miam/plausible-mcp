import { parseAllowedSites } from "./site-allowlist.js";

export interface Config {
  allowedSites: string[];
  baseUrl?: string;
  rateLimitPerHour: number;
  rateLimitPerKeyPerHour: number;
  maxResponseBytes: number;
  port: number;
}

/**
 * Reads exactly the env vars in spec §5's table — no server-side Plausible API key exists
 * here or anywhere else in this file (spec §2.1). `PLAUSIBLE_ALLOWED_SITES` has no default and
 * is required: an unconfigured allowlist fails startup loudly rather than defaulting to
 * "allow everything".
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const allowedSitesRaw = env.PLAUSIBLE_ALLOWED_SITES;
  if (!allowedSitesRaw) {
    throw new Error(
      "PLAUSIBLE_ALLOWED_SITES is required: a comma-separated list of allowed Plausible site_id values."
    );
  }
  const allowedSites = parseAllowedSites(allowedSitesRaw);
  if (allowedSites.length === 0) {
    throw new Error("PLAUSIBLE_ALLOWED_SITES must list at least one site_id.");
  }

  return {
    allowedSites,
    baseUrl: env.PLAUSIBLE_BASE_URL,
    rateLimitPerHour: Number(env.RATE_LIMIT_PER_HOUR ?? 500),
    rateLimitPerKeyPerHour: Number(env.RATE_LIMIT_PER_KEY_PER_HOUR ?? 200),
    maxResponseBytes: Number(env.MAX_RESPONSE_BYTES ?? 1_048_576),
    port: Number(env.PORT ?? 8080),
  };
}

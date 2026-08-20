#!/usr/bin/env node

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server.js";
import { fingerprintOf } from "./credential.js";
import { parseAllowedSites } from "./site-allowlist.js";

const apiKey = process.env.PLAUSIBLE_API_KEY;
if (!apiKey) {
  console.error(
    "Error: PLAUSIBLE_API_KEY environment variable is required.\n" +
      "Get your API key from Plausible Settings > API Keys."
  );
  process.exit(1);
}

const MAX_RESPONSE_BYTES = Number(process.env.MAX_RESPONSE_BYTES ?? 1_048_576);

serveStdio(
  () =>
    createServer({
      apiKey,
      baseUrl: process.env.PLAUSIBLE_BASE_URL,
      context: {
        // No allowlist restriction for a single local user with direct env access — the
        // deployed HTTP server (src/http-server.ts) always sets this, STDIO does not need to.
        allowedSites: process.env.PLAUSIBLE_ALLOWED_SITES
          ? parseAllowedSites(process.env.PLAUSIBLE_ALLOWED_SITES)
          : undefined,
        // No rate limiter: this is one local user, not a shared multi-tenant relay.
        rateLimiter: undefined,
        callerFingerprint: fingerprintOf(apiKey),
        maxResponseBytes: MAX_RESPONSE_BYTES,
      },
    }),
  {
    onerror: (error) => console.error("plausible-mcp stdio error:", error),
  }
);
console.error("plausible-mcp server running on stdio");

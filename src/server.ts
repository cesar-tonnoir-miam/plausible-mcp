import { McpServer } from "@modelcontextprotocol/server";
import { PlausibleClient } from "./plausible.js";
import { register as registerQuery } from "./tools/query.js";
import { register as registerBreakdownExhaustive } from "./tools/breakdown-exhaustive.js";
import type { ToolContext } from "./tool-context.js";

export interface ServerConfig {
  apiKey: string;
  baseUrl?: string;
  context: ToolContext;
}

/**
 * Usage guidance surfaced to MCP clients during discovery/initialization and injected into the
 * model's context.
 */
const SERVER_INSTRUCTIONS = `This server queries Plausible Analytics (Stats API v2). Both tools are read-only.

plausible_query: a typed pass-through to POST /api/v2/query. Accepts arbitrary v2 filters, so any scope is expressible — exclusions, multi-value alternatives, page+event combinations. Returns aggregated rows. For an exhaustive high-cardinality breakdown, use plausible_breakdown_exhaustive instead, or a truncated result will silently under-report.

plausible_breakdown_exhaustive: pages a breakdown to exhaustion and returns either every row or a weighted sum. Use it whenever the breakdown dimension has high cardinality (e.g. cart amounts, page paths) and a truncated result would be wrong rather than merely incomplete.

DATE RANGES: either an absolute [start, end] pair of "YYYY-MM-DD" strings (both inclusive), or a Plausible preset ("7d", "30d", "12mo", "day", "month", "year", "all"). The response's date_range_resolved always states the actual dates queried — rely on it, not the input, when a preset was used.

FILTERS: pass Stats API v2 filter clauses directly, e.g. ["matches_not", "event:page", ["^/miam", "^/mon-compte"]] or ["is", "event:name", ["recipe.show"]]. Combine with "and"/"or"/"not". The server validates shape only (operator vocabulary, nesting depth, size) — Plausible validates the rest, and its error message is relayed verbatim on rejection.

TRUNCATION: plausible_query sets truncated: true whenever row_count equals the requested limit — there may be more rows. plausible_breakdown_exhaustive sets complete: false if max_rows was reached before pagination finished, in which case sum is always null. Never treat a truncated or incomplete result as a full answer.

SITE: site_id must be on the server's configured allowlist; an unlisted site is rejected with a 403 naming the allowed sites.`;

export function createServer(config: ServerConfig): McpServer {
  const server = new McpServer(
    { name: "plausible-mcp", version: "0.7.1" },
    {
      instructions: SERVER_INSTRUCTIONS,
      cacheHints: {
        "server/discover": { ttlMs: 60 * 60 * 1000, cacheScope: "public" },
        "tools/list": { ttlMs: 60 * 60 * 1000, cacheScope: "public" },
      },
    }
  );

  const client = new PlausibleClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  });

  registerQuery(server, client, config.context);
  registerBreakdownExhaustive(server, client, config.context);

  return server;
}

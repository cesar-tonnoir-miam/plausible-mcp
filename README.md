# plausible-mcp

MCP server for [Plausible Analytics](https://plausible.io) — arbitrary [Stats API v2](https://plausible.io/docs/stats-api) queries and exhaustive breakdowns, from any tool that supports [Model Context Protocol](https://modelcontextprotocol.io).

This fork of [`getsentry/plausible-mcp`](https://github.com/getsentry/plausible-mcp) replaces four fixed shortcut tools with two generic ones that accept arbitrary Stats API v2 filters — the shortcut tools' `page`/`goal` params compiled to a non-anchored `contains` match, which can't express exclusions, multi-value alternatives, or an exhaustive high-cardinality breakdown without silent truncation. See the two tools below for what that buys you.

## Tools

| Tool | Description |
|------|-------------|
| `plausible_query` | Typed pass-through to `POST /api/v2/query`. Accepts arbitrary v2 filters — exclusions, multi-value alternatives, any combination of dimensions and filters. |
| `plausible_breakdown_exhaustive` | Pages a breakdown to exhaustion and returns either every row or a weighted sum. Use it whenever the breakdown dimension has high cardinality (cart amounts, page paths) — a truncated result here would be wrong, not just incomplete. |

Both tools are **read-only**, annotated with `readOnlyHint: true`, and declare an `outputSchema` (`structuredContent` field names are a stable contract — see `AGENTS.md`).

## Quick Start

### Local (STDIO)

```bash
git clone <this repository>
cd plausible-mcp
pnpm install
pnpm build
```

```bash
claude mcp add plausible -e PLAUSIBLE_API_KEY=your-key -- node /path/to/plausible-mcp/dist/index.js
```

Or Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "plausible": {
      "command": "node",
      "args": ["/path/to/plausible-mcp/dist/index.js"],
      "env": { "PLAUSIBLE_API_KEY": "your-key" }
    }
  }
}
```

STDIO is a single local user with their own key in their own environment — there is no
allowlist requirement and no rate limiting; both exist for the deployed HTTP server's
multi-tenant relay, described next.

### Remote (Cloud Run)

Once deployed (see "Self-Hosting" below), each user brings their own Plausible API key:

```bash
claude mcp add --transport http plausible https://plausible-mcp.mealz.ai/mcp --header "Authorization: Bearer YOUR_PLAUSIBLE_API_KEY"
```

> Keep the URL **before** `--header`. `--header` is variadic, so if it comes last it swallows the URL and the CLI fails with `error: missing required argument 'commandOrUrl'`.

Or in a plugin manifest that substitutes a per-user key from `userConfig`:

```json
{
  "mcpServers": {
    "plausible-mealz": {
      "type": "http",
      "url": "https://plausible-mcp.mealz.ai/mcp",
      "headers": { "Authorization": "Bearer ${user_config.plausible_api_key}" }
    }
  }
}
```

## Self-Hosting (Cloud Run)

The HTTP entry point (`src/http-server.ts`) is a plain Node server exposing exactly two routes:

- **`POST /mcp`** — bring-your-own-key. Every caller passes their own Plausible API key via
  `Authorization: Bearer <key>`. The server holds **no** server-side Plausible key anywhere —
  not an env var, not a default, not a fallback (see "Security model" below). Missing or
  malformed `Authorization` fails with `401` before any Plausible call is made.
- **`GET /healthz`** — unauthenticated, returns `{"status":"ok"}` and nothing else.

### Deploy

```bash
docker build -t plausible-mcp .
gcloud run deploy plausible-mcp \
  --image plausible-mcp \
  --region europe-west1 \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=1 \
  --set-env-vars PLAUSIBLE_ALLOWED_SITES=miam.coursesu.web,miam.coursesu.app,mealz.intermarche.web,mealz.intermarche.app,miam.monoprix.web
```

`--allow-unauthenticated` is required — Anthropic's infrastructure must reach the endpoint
with no Google IAM layer in front of it. This is safe *because* the server holds no secret:
see "What this model does and doesn't give you" below before changing it.

`--max-instances=1` is not a cost optimization — it's what makes the in-memory rate limiter
(`src/rate-limiter.ts`) effective at all. It's per-process and unshared across instances;
running more than one instance silently disables the guard without any error. If you ever
need more throughput, move the limiter to a shared store (Redis, Firestore) before raising
this past 1.

Map your domain (`plausible-mcp.mealz.ai`) to the service in Cloud Run's console or via
`gcloud run domain-mappings create` — Google issues and manages the certificate.

### Configuration

| Environment Variable | Required | Default | Description |
|---|---|---|---|
| `PLAUSIBLE_ALLOWED_SITES` | Yes | — | Comma-separated `site_id` allowlist. A query for a site outside this list is rejected with `site_not_allowed` before any Plausible call. **Partial barrier only** — see below. |
| `PLAUSIBLE_BASE_URL` | No | `https://plausible.io` | Override for self-hosted Plausible or local testing. |
| `RATE_LIMIT_PER_HOUR` | No | `500` | Global cap on outbound Plausible requests per rolling hour (margin under Plausible's own 600/hr). |
| `RATE_LIMIT_PER_KEY_PER_HOUR` | No | `200` | Per-caller-fingerprint cap on the same window. |
| `MAX_RESPONSE_BYTES` | No | `1048576` | Serialized response size budget; rows are truncated past this with `truncated: true` and a warning. |
| `PORT` | No | `8080` | Cloud Run sets this itself. |

There is deliberately no `PLAUSIBLE_API_KEY` variable for the HTTP server, and no default or
fallback key path anywhere in `src/http-server.ts` or `src/tools/*.ts`. If you find yourself
wanting one, you're changing the security model, not configuring it — see below.

## Security model

**Each user supplies their own Plausible Stats API key**, kept client-side (e.g. in a Claude
plugin's `userConfig`, marked `sensitive: true` so it lands in the client's secure storage,
not a plaintext settings file) and sent as `Authorization: Bearer <key>` on every request. The
server relays it to Plausible and retains nothing — `src/credential.ts` is the only module
that reads the header, and it never appears in a response, a log line, or an error message
(only its first-8-hex-chars sha256 fingerprint does, for distinguishing callers in logs).

### What this gives you

- **No secret on the instance.** Nothing to steal, no Secret Manager, no rotation.
- **Immediate, individual revocation** from Plausible, with no redeploy.
- **Scope is carried by Plausible, not this server.** Invite each user as a Plausible **Guest
  Viewer** on only the sites they need — their key then can't read anything else, including
  outside this server entirely. This is the part that actually limits blast radius; the code
  in this repo cannot substitute for it.

### What this doesn't give you — worth stating plainly

- **This server is an open relay to Plausible.** Anyone who knows the URL and holds *any*
  Plausible key gets served, including for an account with nothing to do with Mealz. The harm
  is low (they'd read their own data on Mealz's compute), but it is a real abuse surface and
  it means the logs carry no evidentiary value about *who* called.
- **No trustworthy identity.** Logs know which key fingerprint was used, not who holds it —
  that mapping is kept by hand, outside this system.
- **The site allowlist (`PLAUSIBLE_ALLOWED_SITES`) is a partial barrier.** A Plausible key
  isn't scopeable to sites by Plausible itself, so the allowlist stops a site being read
  *through this server* — it does nothing against the same key used directly against
  `plausible.io`.

None of these are bugs to patch with half-measures (an allowlist of key fingerprints, an
installation secret) — the key is usable outside this server regardless, so nothing here
closes that surface, only adds friction. If these limits become a real problem, the fix is a
different model (e.g. a verified OAuth/identity-provider token exchanged server-side for one
shared key), not a patch on this one.

### Rate limiting

Plausible caps at 600 requests/hour and doesn't document whether that's per-key or
per-account. This guards as if it were per-account (conservative): a global counter capped by
`RATE_LIMIT_PER_HOUR` and a per-key-fingerprint counter capped by `RATE_LIMIT_PER_KEY_PER_HOUR`,
both in-memory sliding windows (`src/rate-limiter.ts`), checked before *every* outbound
Plausible request — a single `plausible_breakdown_exhaustive` call can consume dozens on its
own. Exceeding either returns `rate_limited` with a `Retry-After` hint; a `429` relayed from
Plausible itself is passed through as-is, with no automatic retry (a silent retry would turn a
quota problem into unexplained latency instead). **This only works with a single instance** —
see `--max-instances=1` above.

### Logging

Each tool call logs one JSON line to stdout (Cloud Run's log sink): timestamp, caller key
fingerprint, `site_id`, resolved `date_range`, tool name, row count, duration, upstream
status. The API key itself is never logged, truncated or otherwise — verified by a dedicated
test (`__tests__/http-server.test.ts`, `__tests__/credential.test.ts`), not just code review.

## Plausible API

Wraps [Stats API v2](https://plausible.io/docs/stats-api) (`POST /api/v2/query`); works with
Plausible Cloud and [self-hosted](https://plausible.io/docs/self-hosting) instances via
`PLAUSIBLE_BASE_URL`.

### Metrics

`visitors`, `visits`, `pageviews`, `views_per_visit`, `bounce_rate`, `visit_duration`, `events`, `scroll_depth`, `percentage`, `conversion_rate`, `group_conversion_rate`, `average_revenue`, `total_revenue`, `time_on_page`

### Dimensions

Not a closed list — `event:name`, `event:page`, `event:goal`, any `time:*` (timeseries granularity), any `visit:*` (session properties, e.g. `visit:country_name`, `visit:channel`), and any `event:props:<name>` custom property defined by the site's own tracker.

### Filters

Pass Stats API v2 filter clauses directly — this server validates only their *shape* (operator
vocabulary, nesting depth ≤ 4, size), not the full grammar, and relays Plausible's own error
message verbatim when it rejects one:

```json
[
  ["matches_not", "event:page", ["^/miam", "^/mon-compte"]],
  ["is", "event:name", ["recipe.show"]]
]
```

Valid operators: `is`, `is_not`, `contains`, `contains_not`, `matches`, `matches_not`, `and`,
`or`, `not`, `has_done`, `has_not_done`.

### Truncation is always explicit

- `plausible_query` sets `truncated: true` whenever `row_count === limit` (there may be more
  rows) and adds a warning suggesting pagination via `offset`.
- `plausible_breakdown_exhaustive` sets `complete: false` if `max_rows` was reached before
  pagination finished — in which case `sum` is always `null`. A partial sum would look like a
  real answer while being wrong; no sum is safer than a wrong one.
- Non-numeric values encountered while summing a dimension are never silently dropped — they're
  counted in `non_numeric_rows_skipped` and called out in `warnings`.
- A response exceeding `MAX_RESPONSE_BYTES` has its rows truncated with `truncated: true` and a
  warning suggesting a narrower filter or `sum_numeric_dimension`.

`date_range_resolved` in every response states the actual dates queried, even when the
request used a relative preset (`"30d"`) — the only way a result stays reproducible after the
fact. `filters_sent` echoes exactly what was sent to Plausible, for the same reason.

## Development

```bash
pnpm install
pnpm typecheck     # tsc --noEmit
pnpm build         # TypeScript compilation
pnpm test          # unit + integration tests (mocked fetch, no live Plausible account)
pnpm test:watch
pnpm dev           # STDIO entry point via tsx
pnpm dev:http      # HTTP entry point via tsx (needs PLAUSIBLE_ALLOWED_SITES)
```

### Testing with MCP Inspector

```bash
pnpm build
PLAUSIBLE_API_KEY=your-key npx @modelcontextprotocol/inspector node dist/index.js
```

### LLM Evals

Verifies the model picks the right tool and expresses the right filter for natural-language
analytics questions, via OpenRouter:

```bash
OPENROUTER_API_KEY=sk-or-... pnpm eval
```

### Manual integration checks (not run in CI — need a real Plausible key)

```bash
PLAUSIBLE_API_KEY=your-key pnpm dev
```

Then, via MCP Inspector or a connected client:
- `plausible_query` on a real site, a January date range, `dimensions: ["event:name"]`.
- The same with a `matches_not` exclusion filter, to confirm it round-trips to Plausible.
- A short `plausible_breakdown_exhaustive` call on a dimension with enough rows to force more
  than one page, to confirm the pagination loop and `complete: true`.

## Architecture

```
src/
├── index.ts              # STDIO entry point (local, single user)
├── http-server.ts         # Node HTTP entry point (Cloud Run) — /mcp and /healthz
├── config.ts              # Reads and validates env vars for the HTTP entry point
├── server.ts               # Creates McpServer, registers the two tools
├── plausible.ts            # PlausibleClient — standalone Stats API v2 client
├── schemas.ts               # Shared Zod schemas (metrics, dimensions, date ranges, ...)
├── filters.ts                # Shape-only validation of v2 filter clauses
├── credential.ts              # The one module allowed to read/validate the Authorization header
├── site-allowlist.ts           # PLAUSIBLE_ALLOWED_SITES parsing and enforcement
├── rate-limiter.ts              # In-memory global + per-key sliding-window limiter
├── response-size.ts              # Row truncation to a serialized byte budget
├── date-range.ts                   # Resolves a preset date_range to Plausible's actual dates
├── logging.ts                       # Structured, key-free stdout logs
├── errors.ts                         # The spec's error code contract, mapped from every failure mode
├── tool-context.ts                    # Bundles allowlist/limiter/fingerprint/size-budget for tool handlers
└── tools/
    ├── query.ts                        # plausible_query
    └── breakdown-exhaustive.ts          # plausible_breakdown_exhaustive
```

`PlausibleClient` has zero MCP dependency and can be used standalone.

## License

MIT — see [LICENSE](LICENSE).

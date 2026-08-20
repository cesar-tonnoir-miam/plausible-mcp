MCP server wrapping the Plausible Stats API v2 with two generic tools (`plausible_query`,
`plausible_breakdown_exhaustive`) instead of fixed shortcut tools. Two entry points — STDIO
(`src/index.ts`, local/single-user) and a plain Node HTTP server (`src/http-server.ts`,
deployed on Cloud Run) — so a change to shared code (`src/server.ts`, `src/schemas.ts`,
`src/tools/*.ts`, `src/plausible.ts`) usually needs both checked.

## Before calling a change green

Run `pnpm typecheck`, `pnpm build`, and `pnpm test`. There is a single `tsconfig.json` now —
no Cloudflare Worker split to worry about.

craft owns the version in `package.json` and every `CHANGELOG.md` line — leave both to the
release pipeline.

## The security model, in one paragraph

The server holds no Plausible API key anywhere — not in an env var, not as a default, not as
a fallback. Every caller supplies their own key via `Authorization: Bearer <key>` on `/mcp`,
and the server relays it to Plausible and keeps nothing. `src/credential.ts` is the only
module allowed to read that header; if you're tempted to read a key from `process.env` inside
`src/http-server.ts` or a tool handler, that's the sign something has gone wrong — see the
spec this fork was built from for why (`PLAUSIBLE_ALLOWED_SITES` is the *only* Plausible-
related env var the HTTP server reads, and it names sites, not secrets).

## Reference

- **Deploying, env vars, the HTTP server's endpoints and rate limiting** — README
  "Self-Hosting" and "Configuration".
- **The credential relay, allowlist, and logging model** — `src/credential.ts`,
  `src/site-allowlist.ts`, `src/rate-limiter.ts`, `src/logging.ts`, each documented inline;
  README "Self-Hosting" covers the deployment-level reasoning.
- Scripts are in `package.json`, contributor procedure in `CONTRIBUTING.md`.

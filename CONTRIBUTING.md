# Contributing to plausible-mcp

Thanks for your interest in contributing!

## Development Setup

```bash
git clone <this repository>
cd plausible-mcp
pnpm install
```

## Running Tests

```bash
pnpm test          # All tests
pnpm test:watch    # Watch mode
pnpm test:coverage # With coverage report
```

Tests use [Vitest](https://vitest.dev) with mocked `fetch` — no Plausible account needed to run them.

## Adding a New Tool

This fork intentionally exposes exactly two tools (`plausible_query`,
`plausible_breakdown_exhaustive`) — see the spec this fork was built from for why a wider
surface (shortcut params that compile to different filter semantics) is a correctness risk,
not a convenience. Before adding a third tool, make sure it can't be expressed as a call to
one of the existing two.

If you do add one:

1. Create `src/tools/your-tool.ts`, exporting `register(server, client, context)` — copy
   `src/tools/query.ts`. `context: ToolContext` (`src/tool-context.ts`) carries the allowlist,
   rate limiter, caller fingerprint, and response size budget; every tool handler needs it.
2. Declare an `outputSchema` and return `structuredContent` alongside the text block. Field
   names in `structuredContent` are a contract with the `stats-enseignes` skill (see spec
   §8) — don't rename one without updating the skill in the same change.
3. Call `assertSiteAllowed`, `validateFilters`, and the rate limiter the same way `query.ts`
   does — these aren't optional per-tool choices, they're the security model.
4. Register it in `src/server.ts`.
5. Add tests in `__tests__/tools/your-tool.test.ts`.
6. Add an eval case in `evals/cases.ts` if the tool is one a user would ask for in plain
   language.

## Running LLM Evals

Requires an OpenRouter API key:

```bash
OPENROUTER_API_KEY=sk-or-... pnpm eval
```

The model defaults to `anthropic/claude-sonnet-5`; override it with `OPENROUTER_MODEL`.

## Testing the MCP Server Locally

Put your Plausible key in `.env.local` (copy `.env.example`), then:

```bash
pnpm inspect       # build + open the MCP Inspector UI, auto-connected to the server
pnpm inspect:cli   # headless: build + print the tool list (handy for a quick check or CI)
```

Both read [`mcp.json`](./mcp.json), which launches the server with
`node --env-file-if-exists=.env.local` — so your key loads from `.env.local` when it's
there, and falls back to whatever `PLAUSIBLE_API_KEY` is already in the environment when
it isn't (e.g. in CI). No need to paste it anywhere. `inspect` opens the browser UI (it
prints a pre-authed `http://localhost:6274/?...` URL); `inspect:cli` just prints
`tools/list` and exits.

## Pull Requests

- Make sure `pnpm test` passes
- Make sure `pnpm build` compiles cleanly
- Keep PRs focused — one feature or fix per PR
- Your **PR title becomes the changelog line** for the next release, so write it for a reader (see Releasing below)

## Releasing

Releases are automated with [craft](https://github.com/getsentry/craft). **Don't bump the version in `package.json` or edit `CHANGELOG.md` by hand** — both are generated.

1. Merge your PR to `main`. The changelog is auto-generated from merged PR titles since the last tag (`.craft.yml` → `changelog.policy: auto`).
2. A maintainer runs the **Release** workflow (Actions → Release → *Run workflow*) and selects the bump type (`patch` / `minor` / `major`).
3. craft cuts a `release/X.Y.Z` branch, then publishes a git tag and GitHub release once CI is green.

Deploying to Cloud Run (`pnpm docker:build`, then `gcloud run deploy` — see README
"Self-Hosting") is separate from cutting a release.

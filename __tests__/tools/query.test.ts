import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/server";
import { register } from "../../src/tools/query.js";
import type { PlausibleClient } from "../../src/plausible.js";
import type { ToolContext } from "../../src/tool-context.js";
import { getToolHandler } from "./_helpers.js";

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    allowedSites: ["example.com"],
    rateLimiter: undefined,
    callerFingerprint: "abcd1234",
    maxResponseBytes: 1_048_576,
    ...overrides,
  };
}

function makeClient(returnValue?: unknown): PlausibleClient & { query: ReturnType<typeof vi.fn> } {
  return {
    query: vi.fn().mockResolvedValue(
      returnValue ?? {
        results: [{ dimensions: ["recipe.show"], metrics: [98620] }],
        meta: {},
        query: {},
      }
    ),
  } as unknown as PlausibleClient & { query: ReturnType<typeof vi.fn> };
}

function buildTool(client: PlausibleClient, context: ToolContext) {
  const server = new McpServer({ name: "test", version: "0.0.1" });
  register(server, client, context);
  return getToolHandler(server, "plausible_query");
}

describe("plausible_query", () => {
  it("returns rows, echoes filters_sent, and reports truncated: false under the limit", async () => {
    const client = makeClient();
    const call = buildTool(client, makeContext());

    const result = await call({
      site_id: "example.com",
      date_range: ["2026-01-01", "2026-01-31"],
      metrics: ["visitors", "events"],
      dimensions: ["event:name"],
      filters: [["is", "event:name", ["recipe.show"]]],
      limit: 500,
      offset: 0,
    });

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.site_id).toBe("example.com");
    expect(structured.date_range_resolved).toEqual(["2026-01-01", "2026-01-31"]);
    expect(structured.filters_sent).toEqual([["is", "event:name", ["recipe.show"]]]);
    expect(structured.row_count).toBe(1);
    expect(structured.truncated).toBe(false);
  });

  it("resolves the exclusion filter from the spec's acceptance criteria without rejecting it", async () => {
    const client = makeClient();
    const call = buildTool(client, makeContext());

    const result = await call({
      site_id: "example.com",
      date_range: "30d",
      metrics: ["visitors"],
      filters: [
        ["matches_not", "event:page", ["^/miam", "^/mon-compte"]],
        ["is", "event:name", ["recipe.show"]],
      ],
      limit: 500,
      offset: 0,
    });

    expect(result.isError).toBeFalsy();
    expect(client.query).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [
          ["matches_not", "event:page", ["^/miam", "^/mon-compte"]],
          ["is", "event:name", ["recipe.show"]],
        ],
      })
    );
  });

  it("sets truncated: true when row_count equals limit and warns about it", async () => {
    const client = makeClient({
      results: [{ dimensions: ["a"], metrics: [1] }],
      meta: {},
      query: {},
    });
    const call = buildTool(client, makeContext());

    const result = await call({
      site_id: "example.com",
      date_range: "30d",
      metrics: ["visitors"],
      limit: 1,
      offset: 0,
    });

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.truncated).toBe(true);
    expect((structured.warnings as string[]).some((w) => /paginate/i.test(w))).toBe(true);
  });

  it("resolves date_range_resolved from the Plausible response when a preset is used", async () => {
    const client = makeClient({
      results: [],
      meta: {},
      query: { date_range: ["2026-07-24", "2026-08-22"] },
    });
    const call = buildTool(client, makeContext());

    const result = await call({
      site_id: "example.com",
      date_range: "30d",
      metrics: ["visitors"],
      limit: 500,
      offset: 0,
    });

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.date_range_resolved).toEqual(["2026-07-24", "2026-08-22"]);
  });

  it("rejects a site not on the allowlist with site_not_allowed/403, without calling Plausible", async () => {
    const client = makeClient();
    const call = buildTool(client, makeContext({ allowedSites: ["only-this.com"] }));

    const result = await call({
      site_id: "not-allowed.com",
      date_range: "30d",
      metrics: ["visitors"],
      limit: 500,
      offset: 0,
    });

    expect(result.isError).toBe(true);
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(payload.error).toBe("site_not_allowed");
    expect(payload.status).toBe(403);
    expect(client.query).not.toHaveBeenCalled();
  });

  it("rejects a malformed filters clause with invalid_input/422", async () => {
    const client = makeClient();
    const call = buildTool(client, makeContext());

    const result = await call({
      site_id: "example.com",
      date_range: "30d",
      metrics: ["visitors"],
      filters: [["bogus_operator", "event:page", ["/a"]]],
      limit: 500,
      offset: 0,
    });

    expect(result.isError).toBe(true);
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(payload.error).toBe("invalid_input");
    expect(client.query).not.toHaveBeenCalled();
  });

  it("relays a Plausible upstream error verbatim", async () => {
    const { PlausibleApiError } = await import("../../src/plausible.js");
    const client = {
      query: vi.fn().mockRejectedValue(new PlausibleApiError(400, "Unknown filter operator")),
    } as unknown as PlausibleClient;
    const call = buildTool(client, makeContext());

    const result = await call({
      site_id: "example.com",
      date_range: "30d",
      metrics: ["visitors"],
      limit: 500,
      offset: 0,
    });

    expect(result.isError).toBe(true);
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(payload.error).toBe("upstream_error");
    expect(payload.message).toBe("Unknown filter operator");
  });
});

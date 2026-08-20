import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/server";
import { register } from "../../src/tools/breakdown-exhaustive.js";
import type { PlausibleClient, PlausibleQueryParams, PlausibleResponse } from "../../src/plausible.js";
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

function buildTool(client: PlausibleClient, context: ToolContext) {
  const server = new McpServer({ name: "test", version: "0.0.1" });
  register(server, client, context);
  return getToolHandler(server, "plausible_breakdown_exhaustive");
}

/** Generates `total` numeric-dimension rows, paginated by `pagination.limit/offset`. */
function makePaginatedClient(total: number, valuePerRow: (i: number) => number = () => 10) {
  const query = vi.fn().mockImplementation(async (params: PlausibleQueryParams): Promise<PlausibleResponse> => {
    const limit = params.pagination?.limit ?? total;
    const offset = params.pagination?.offset ?? 0;
    const rows = [];
    for (let i = offset; i < Math.min(offset + limit, total); i++) {
      rows.push({ dimensions: [String(valuePerRow(i))], metrics: [1] });
    }
    return { results: rows, meta: {}, query: { date_range: ["2026-06-01", "2026-06-30"] } };
  });
  return { query } as unknown as PlausibleClient & { query: typeof query };
}

describe("plausible_breakdown_exhaustive", () => {
  it("paginates across more than one page and reports complete: true", async () => {
    const client = makePaginatedClient(2500);
    const call = buildTool(client, makeContext());

    const result = await call({
      site_id: "example.com",
      date_range: "30d",
      metrics: ["events"],
      dimension: "event:props:total_amount",
      page_size: 1000,
      max_rows: 50000,
      sum_numeric_dimension: false,
    });

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.complete).toBe(true);
    expect(structured.row_count).toBe(2500);
    // 1000 + 1000 + 500 (incomplete page ends it) = 3 pages, no extra trailing call needed
    // since the last page (500 rows) is already shorter than page_size.
    expect(structured.pages_fetched).toBe(3);
  });

  it("makes one extra trailing call when the last real page is exactly page_size (documented edge case)", async () => {
    const client = makePaginatedClient(2000);
    const call = buildTool(client, makeContext());

    const result = await call({
      site_id: "example.com",
      date_range: "30d",
      metrics: ["events"],
      dimension: "event:props:total_amount",
      page_size: 1000,
      max_rows: 50000,
      sum_numeric_dimension: false,
    });

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.complete).toBe(true);
    expect(structured.row_count).toBe(2000);
    expect(structured.pages_fetched).toBe(3); // 1000 + 1000 + empty confirming page
  });

  it("stops at max_rows with complete: false and sum: null", async () => {
    const client = makePaginatedClient(50000);
    const call = buildTool(client, makeContext());

    const result = await call({
      site_id: "example.com",
      date_range: "30d",
      metrics: ["events"],
      dimension: "event:props:total_amount",
      page_size: 1000,
      max_rows: 10,
      sum_numeric_dimension: true,
    });

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.complete).toBe(false);
    expect(structured.sum).toBeNull();
    expect((structured.warnings as string[]).some((w) => /max_rows/i.test(w))).toBe(true);
  });

  it("computes a correct weighted sum over a numeric dimension when complete", async () => {
    // 5 rows: dimension values 10, 20, 30, 40, 50; metric always 2 -> sum = 2*(10+20+30+40+50) = 300
    const client = {
      query: vi.fn().mockResolvedValue({
        results: [10, 20, 30, 40, 50].map((v) => ({ dimensions: [String(v)], metrics: [2] })),
        meta: {},
        query: { date_range: ["2026-06-01", "2026-06-30"] },
      }),
    } as unknown as PlausibleClient;
    const call = buildTool(client, makeContext());

    const result = await call({
      site_id: "example.com",
      date_range: "30d",
      metrics: ["events"],
      dimension: "event:props:total_amount",
      page_size: 1000,
      max_rows: 50000,
      sum_numeric_dimension: true,
    });

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.complete).toBe(true);
    expect(structured.sum).toBe(300);
    expect(structured.sum_metric).toBe("events");
    expect(structured.rows).toBeNull();
    expect(structured.non_numeric_rows_skipped).toBe(0);
  });

  it("counts (not silently drops) non-numeric dimension values when summing", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        results: [
          { dimensions: ["10"], metrics: [2] },
          { dimensions: ["(none)"], metrics: [2] },
          { dimensions: ["20"], metrics: [2] },
        ],
        meta: {},
        query: { date_range: ["2026-06-01", "2026-06-30"] },
      }),
    } as unknown as PlausibleClient;
    const call = buildTool(client, makeContext());

    const result = await call({
      site_id: "example.com",
      date_range: "30d",
      metrics: ["events"],
      dimension: "event:props:total_amount",
      page_size: 1000,
      max_rows: 50000,
      sum_numeric_dimension: true,
    });

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.sum).toBe(60); // 2*10 + 2*20, "(none)" excluded
    expect(structured.non_numeric_rows_skipped).toBe(1);
    expect((structured.warnings as string[]).some((w) => /non-numeric/i.test(w))).toBe(true);
  });

  it("rejects sum_numeric_dimension with more than one metric", async () => {
    const client = makePaginatedClient(10);
    const call = buildTool(client, makeContext());

    const result = await call({
      site_id: "example.com",
      date_range: "30d",
      metrics: ["events", "visitors"],
      dimension: "event:props:total_amount",
      page_size: 1000,
      max_rows: 50000,
      sum_numeric_dimension: true,
    });

    expect(result.isError).toBe(true);
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(payload.error).toBe("invalid_input");
    expect(client.query).not.toHaveBeenCalled();
  });

  it("rejects a site not on the allowlist without calling Plausible", async () => {
    const client = makePaginatedClient(10);
    const call = buildTool(client, makeContext({ allowedSites: ["only-this.com"] }));

    const result = await call({
      site_id: "not-allowed.com",
      date_range: "30d",
      metrics: ["events"],
      dimension: "event:props:total_amount",
      page_size: 1000,
      max_rows: 50000,
      sum_numeric_dimension: false,
    });

    expect(result.isError).toBe(true);
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(payload.error).toBe("site_not_allowed");
    expect(client.query).not.toHaveBeenCalled();
  });

  it("date_range_resolved is taken from the first page's response", async () => {
    const client = makePaginatedClient(5);
    const call = buildTool(client, makeContext());

    const result = await call({
      site_id: "example.com",
      date_range: "30d",
      metrics: ["events"],
      dimension: "event:props:total_amount",
      page_size: 1000,
      max_rows: 50000,
      sum_numeric_dimension: false,
    });

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.date_range_resolved).toEqual(["2026-06-01", "2026-06-30"]);
  });
});

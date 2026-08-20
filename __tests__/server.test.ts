import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import {
  Client,
  InMemoryTransport,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer } from "../src/server.js";
import type { ToolContext } from "../src/tool-context.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockPlausibleOk(data?: unknown) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve(
        data ?? {
          results: [{ dimensions: ["2024-01-15"], metrics: [500] }],
          meta: {},
          query: {},
        }
      ),
  });
}

function testContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    allowedSites: ["example.com"],
    rateLimiter: undefined,
    callerFingerprint: "abcd1234",
    maxResponseBytes: 1_048_576,
    ...overrides,
  };
}

describe("MCP Server Integration", () => {
  let client: Client;

  beforeAll(async () => {
    const server = createServer({
      apiKey: "test-key-123",
      baseUrl: "https://plausible.io",
      context: testContext(),
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    client = new Client({ name: "test-client", version: "0.0.1" });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
  });

  it("exposes exactly the two contracted tools (spec §8)", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["plausible_breakdown_exhaustive", "plausible_query"]);
  });

  it("each tool has a description and input schema", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("each tool declares an output schema and read-only annotations", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.outputSchema).toBeDefined();
      expect(tool.outputSchema?.type).toBe("object");
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.idempotentHint).toBe(true);
    }
  });

  it("plausible_query's output schema declares the exact contracted field names (spec §8)", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "plausible_query")!;
    const properties = Object.keys(
      (tool.outputSchema as { properties: Record<string, unknown> }).properties
    );
    expect(properties.sort()).toEqual(
      [
        "site_id",
        "date_range_resolved",
        "metrics",
        "dimensions",
        "filters_sent",
        "rows",
        "row_count",
        "truncated",
        "warnings",
      ].sort()
    );
  });

  it("plausible_breakdown_exhaustive's output schema declares the exact contracted field names (spec §8)", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "plausible_breakdown_exhaustive")!;
    const properties = Object.keys(
      (tool.outputSchema as { properties: Record<string, unknown> }).properties
    );
    expect(properties.sort()).toEqual(
      [
        "site_id",
        "date_range_resolved",
        "dimension",
        "filters_sent",
        "pages_fetched",
        "row_count",
        "complete",
        "sum",
        "sum_metric",
        "non_numeric_rows_skipped",
        "rows",
        "warnings",
      ].sort()
    );
  });

  it("exposes server instructions documenting the API constraints", () => {
    const instructions = client.getInstructions();
    expect(instructions).toBeTruthy();
    expect(instructions).toContain("date_range_resolved");
    expect(instructions).toContain("truncated");
    expect(instructions).toContain("complete");
  });

  it("plausible_query returns structuredContent alongside the text block", async () => {
    mockPlausibleOk();

    const result = await client.callTool({
      name: "plausible_query",
      arguments: {
        site_id: "example.com",
        date_range: "30d",
        metrics: ["visitors"],
        dimensions: ["visit:country_name"],
      },
    });

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as { dimensions: string[]; site_id: string };
    expect(structured.dimensions).toEqual(["visit:country_name"]);
    expect(structured.site_id).toBe("example.com");
  });

  it("plausible_breakdown_exhaustive returns data", async () => {
    mockPlausibleOk();

    const result = await client.callTool({
      name: "plausible_breakdown_exhaustive",
      arguments: {
        site_id: "example.com",
        date_range: "30d",
        metrics: ["visitors"],
        dimension: "event:page",
      },
    });

    expect(result.isError).toBeFalsy();
  });

  it("site_id is always required (no default-site fallback in this fork)", async () => {
    const result = await client.callTool({
      name: "plausible_query",
      arguments: { date_range: "30d", metrics: ["visitors"] },
    });
    expect(result.isError).toBe(true);
  });

  it("returns a structured error when the Plausible API fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Invalid API key"),
      headers: { get: () => null },
    });

    const result = await client.callTool({
      name: "plausible_query",
      arguments: { site_id: "example.com", date_range: "30d", metrics: ["visitors"] },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    const payload = JSON.parse(content[0].text);
    expect(payload.error).toBe("plausible_unauthorized");
  });
});

describe("MCP HTTP protocol eras", () => {
  const handler = createMcpHandler(() =>
    createServer({ apiKey: "test-key-123", context: testContext() })
  );

  afterAll(async () => {
    await handler.close();
  });

  it("serves the 2026-07-28 era through server/discover", async () => {
    const methods: Array<string | null> = [];
    const transport = new StreamableHTTPClientTransport(new URL("https://test.local/mcp"), {
      fetch: (url, init) => {
        const request = new Request(url, init);
        methods.push(request.headers.get("Mcp-Method"));
        return handler.fetch(request);
      },
    });
    const modernClient = new Client(
      { name: "modern-test-client", version: "0.0.1" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } }
    );

    try {
      await modernClient.connect(transport);
      expect(modernClient.getProtocolEra()).toBe("modern");
      expect(methods).toContain("server/discover");

      const toolList = await modernClient.listTools();
      expect(methods).toContain("tools/list");
      expect(toolList.tools.map((tool) => tool.name).sort()).toEqual([
        "plausible_breakdown_exhaustive",
        "plausible_query",
      ]);
    } finally {
      await modernClient.close();
    }
  });

  it("keeps serving legacy clients from the same handler", async () => {
    const transport = new StreamableHTTPClientTransport(new URL("https://test.local/mcp"), {
      fetch: (url, init) => handler.fetch(new Request(url, init)),
    });
    const legacyClient = new Client({ name: "legacy-test-client", version: "0.0.1" });

    try {
      await legacyClient.connect(transport);
      expect(legacyClient.getProtocolEra()).toBe("legacy");
      const { tools } = await legacyClient.listTools();
      expect(tools).toHaveLength(2);
    } finally {
      await legacyClient.close();
    }
  });
});

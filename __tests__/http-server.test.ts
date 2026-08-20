import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import { createServer as createNodeServer, type Server } from "node:http";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createHttpServer } from "../src/http-server.js";
import type { Config } from "../src/config.js";

const VALID_KEY = "a".repeat(40);

describe("HTTP server (spec §5 endpoints, §3.1 credential relay)", () => {
  let appServer: Server;
  let appUrl: string;
  let mockPlausible: Server;
  let mockPlausibleUrl: string;
  let plausibleCallCount: number;
  let lastAuthHeaderSeenByPlausible: string | undefined;

  beforeAll(async () => {
    mockPlausible = createNodeServer((req, res) => {
      plausibleCallCount += 1;
      lastAuthHeaderSeenByPlausible = req.headers.authorization;
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ results: [], meta: {}, query: {} }));
      });
    });
    await new Promise<void>((resolve) => mockPlausible.listen(0, "127.0.0.1", resolve));
    const plausibleAddr = mockPlausible.address() as AddressInfo;
    // PlausibleClient only allows plain HTTP for hostname "localhost" (spec-adjacent
    // hardening against accidental cleartext elsewhere); 127.0.0.1 would be rejected.
    mockPlausibleUrl = `http://localhost:${plausibleAddr.port}`;

    const config: Config = {
      allowedSites: ["example.com"],
      baseUrl: mockPlausibleUrl,
      rateLimitPerHour: 500,
      rateLimitPerKeyPerHour: 200,
      maxResponseBytes: 1_048_576,
      port: 0,
    };
    appServer = createHttpServer(config);
    await new Promise<void>((resolve) => appServer.listen(0, "127.0.0.1", resolve));
    const appAddr = appServer.address() as AddressInfo;
    appUrl = `http://127.0.0.1:${appAddr.port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => appServer.close(resolve));
    await new Promise((resolve) => mockPlausible.close(resolve));
  });

  it("GET /healthz returns 200 {status: ok} without authentication", async () => {
    const res = await fetch(`${appUrl}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("POST /mcp without an Authorization header returns 401 missing_credential and calls Plausible zero times", async () => {
    plausibleCallCount = 0;
    const res = await fetch(`${appUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
    const payload = await res.json();
    expect(payload.error).toBe("missing_credential");
    expect(plausibleCallCount).toBe(0);
  });

  it("POST /mcp with a header missing the Bearer prefix returns 401 and calls Plausible zero times", async () => {
    plausibleCallCount = 0;
    const res = await fetch(`${appUrl}/mcp`, {
      method: "POST",
      headers: { Authorization: VALID_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
    expect(plausibleCallCount).toBe(0);
  });

  it("POST /mcp with an empty Bearer value returns 401 and calls Plausible zero times", async () => {
    plausibleCallCount = 0;
    const res = await fetch(`${appUrl}/mcp`, {
      method: "POST",
      headers: { Authorization: "Bearer ", "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
    expect(plausibleCallCount).toBe(0);
  });

  // A raw newline in a header value can't actually reach the server through any
  // spec-compliant HTTP client — fetch's own Headers implementation refuses to send it
  // (confirmed below). resolveCredential's rejection of control characters is exercised
  // directly, bypassing the transport, in __tests__/credential.test.ts.
  it("no compliant HTTP client can even transmit a header-injection value", () => {
    expect(() => new Headers({ Authorization: `Bearer ${VALID_KEY}\r\nX-Injected: evil` })).toThrow();
  });

  it("a well-formed key is relayed to Plausible byte-for-byte, unaltered", async () => {
    plausibleCallCount = 0;
    const client = new Client({ name: "test-client", version: "0.0.1" });
    const transport = new StreamableHTTPClientTransport(new URL(`${appUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${VALID_KEY}` } },
    });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "plausible_query",
        arguments: { site_id: "example.com", date_range: "30d", metrics: ["visitors"] },
      });
      expect(result.isError).toBeFalsy();
      expect(plausibleCallCount).toBe(1);
      expect(lastAuthHeaderSeenByPlausible).toBe(`Bearer ${VALID_KEY}`);
    } finally {
      await client.close();
    }
  });

  it("a site not on the allowlist is rejected without ever calling Plausible", async () => {
    plausibleCallCount = 0;
    const client = new Client({ name: "test-client", version: "0.0.1" });
    const transport = new StreamableHTTPClientTransport(new URL(`${appUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${VALID_KEY}` } },
    });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "plausible_query",
        arguments: { site_id: "not-allowed.com", date_range: "30d", metrics: ["visitors"] },
      });
      expect(result.isError).toBe(true);
      const payload = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(payload.error).toBe("site_not_allowed");
      expect(plausibleCallCount).toBe(0);
    } finally {
      await client.close();
    }
  });

  it("relays a Plausible 401 as plausible_unauthorized with a helpful hint", async () => {
    mockPlausible.removeAllListeners("request");
    mockPlausible.on("request", (req, res) => {
      plausibleCallCount += 1;
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_api_key" }));
    });
    plausibleCallCount = 0;

    const client = new Client({ name: "test-client", version: "0.0.1" });
    const transport = new StreamableHTTPClientTransport(new URL(`${appUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${VALID_KEY}` } },
    });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "plausible_query",
        arguments: { site_id: "example.com", date_range: "30d", metrics: ["visitors"] },
      });
      expect(result.isError).toBe(true);
      const payload = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(payload.error).toBe("plausible_unauthorized");
      expect(payload.hint).toBeTruthy();
    } finally {
      await client.close();
      mockPlausible.removeAllListeners("request");
      mockPlausible.on("request", (req, res) => {
        plausibleCallCount += 1;
        lastAuthHeaderSeenByPlausible = req.headers.authorization;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ results: [], meta: {}, query: {} }));
      });
    }
  });
});

describe("no server-side credential fallback exists (spec §2.1, acceptance criterion 6)", () => {
  it("loadConfig never reads a Plausible API key from the environment", async () => {
    const { loadConfig } = await import("../src/config.js");
    const env = {
      PLAUSIBLE_ALLOWED_SITES: "example.com",
      PLAUSIBLE_API_KEY: "should-never-be-read-1234567890",
    };
    const config = loadConfig(env as unknown as NodeJS.ProcessEnv);
    expect(JSON.stringify(config)).not.toContain("should-never-be-read");
  });

  it("startup fails loudly when PLAUSIBLE_ALLOWED_SITES is unset, rather than defaulting to allow-all", async () => {
    const { loadConfig } = await import("../src/config.js");
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow(/PLAUSIBLE_ALLOWED_SITES/);
  });
});

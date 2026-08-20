#!/usr/bin/env node

import { createServer as createNodeServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createMcpHandler, type AuthInfo } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createServer as createMcpServer } from "./server.js";
import { loadConfig, type Config } from "./config.js";
import { resolveCredential } from "./credential.js";
import { toErrorPayload } from "./errors.js";
import { RateLimiter } from "./rate-limiter.js";
import type { ToolContext } from "./tool-context.js";

interface RequestAuthExtra {
  apiKey: string;
  toolContext: ToolContext;
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Cache-Control": "no-store",
};

function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", ...SECURITY_HEADERS });
  res.end(JSON.stringify(payload));
}

/**
 * Builds the Node HTTP server for spec §5's two endpoints, without starting it — callers
 * (the entry point below, or a test) control when/where it listens. Each call creates its own
 * `RateLimiter`, so tests can construct isolated servers without sharing rate-limit state.
 */
export function createHttpServer(config: Config): Server {
  const rateLimiter = new RateLimiter(config.rateLimitPerHour, config.rateLimitPerKeyPerHour);

  // One handler instance owns the modern-era subscription bus; the factory still builds an
  // isolated McpServer (and, inside it, an isolated PlausibleClient) per request, keyed to
  // that request's own caller-supplied key. No server ever reuses another caller's key.
  const mcpHandler = createMcpHandler(
    ({ authInfo }) => {
      const extra = authInfo?.extra as RequestAuthExtra | undefined;
      if (!extra?.apiKey) {
        // Unreachable in practice: handleMcp always resolves a credential and attaches it
        // before calling into this handler. Fails closed if that ever changes.
        throw new Error("Missing authenticated request context.");
      }
      return createMcpServer({
        apiKey: extra.apiKey,
        baseUrl: config.baseUrl,
        context: extra.toolContext,
      });
    },
    { legacy: "stateless" }
  );

  const nodeMcpHandler = toNodeHandler(mcpHandler);

  async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        ...SECURITY_HEADERS,
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, MCP-Protocol-Version",
      });
      res.end();
      return;
    }

    // Credential check happens before anything else touches this request: on failure, no MCP
    // server is constructed and no Plausible call is possible (spec §2.1, acceptance criterion 5).
    let credential;
    try {
      credential = resolveCredential(req.headers.authorization ?? null);
    } catch (error) {
      const payload = toErrorPayload(error);
      writeJson(res, payload.status, payload);
      return;
    }

    const toolContext: ToolContext = {
      allowedSites: config.allowedSites,
      rateLimiter,
      callerFingerprint: credential.fingerprint,
      maxResponseBytes: config.maxResponseBytes,
    };

    (req as IncomingMessage & { auth?: AuthInfo }).auth = {
      token: credential.key,
      clientId: credential.fingerprint,
      scopes: ["plausible:read"],
      extra: { apiKey: credential.key, toolContext } satisfies RequestAuthExtra,
    };

    res.setHeader("Access-Control-Allow-Origin", "*");
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      res.setHeader(key, value);
    }

    await nodeMcpHandler(req, res);
  }

  return createNodeServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

        if (req.method === "GET" && url.pathname === "/healthz") {
          writeJson(res, 200, { status: "ok" });
          return;
        }

        if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
          await handleMcp(req, res);
          return;
        }

        writeJson(res, 404, { error: "internal_error", status: 404, message: "Not found." });
      } catch (error) {
        if (!res.headersSent) {
          writeJson(res, 500, toErrorPayload(error));
        } else {
          res.destroy();
        }
      }
    })();
  });
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const config = loadConfig();
  const server = createHttpServer(config);
  server.listen(config.port, () => {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        event: "server_started",
        port: config.port,
        allowed_sites: config.allowedSites,
      })
    );
  });
}

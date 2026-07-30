/**
 * Sentry privacy guardrail shared by the Worker's `beforeSend` / `beforeSendTransaction`.
 *
 * Only the Access-gated `/internal` endpoint attaches an identity (`Sentry.setUser({ email })`)
 * and records tool inputs/outputs. The bring-your-own-key `/mcp` endpoint must stay fully
 * anonymous: the querying user is a third party using their own Plausible key, and their tool
 * inputs/outputs are their own data. We never record I/O there, and this strips the signals
 * that would otherwise slip through on events: authentication headers on both endpoints,
 * plus the client IP address and JSON-RPC request body for anonymous BYOK traffic.
 */

export interface RedactableUser {
  email?: unknown;
  ip_address?: string | null;
  [key: string]: unknown;
}

export interface RedactableEvent {
  user?: RedactableUser | null;
  contexts?: { trace?: { data?: Record<string, unknown> } };
  spans?: Array<{ data?: Record<string, unknown> }>;
  request?: {
    data?: unknown;
    headers?: Record<string, string | null | undefined>;
  } | null;
}

/**
 * Always redact authentication headers. If an event has no authenticated email, also treat it
 * as BYOK/anonymous, remove its request body, and replace its `user` with an explicitly IP-less
 * object. Setting `ip_address: null` tells Sentry not to infer one at ingest. Mutates in place;
 * callers return the same event.
 */
export function anonymizeEventWithoutEmail(event: RedactableEvent): void {
  const headers = event.request?.headers;
  if (headers) {
    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase();
      if (
        lower.includes("authorization") ||
        lower.includes("cookie") ||
        lower.includes("jwt-assertion") ||
        lower.includes("cf-access")
      ) {
        headers[key] = "[Filtered]";
      }
    }
  }

  const email = event.user?.email;
  if (typeof email !== "string" || email.length === 0) {
    event.user = { ip_address: null };
    if (event.request) delete event.request.data;
    for (const data of [
      event.contexts?.trace?.data,
      ...(event.spans ?? []).map((span) => span.data),
    ]) {
      if (!data) continue;
      delete data["mcp.client.name"];
      delete data["mcp.client.title"];
      delete data["mcp.client.version"];
    }
  }
}

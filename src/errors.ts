import { PlausibleApiError } from "./plausible.js";

/**
 * The eleven-code error contract from the spec (§4). Every failure path — transport-level
 * auth rejection, tool-level validation, or a relayed Plausible error — collapses to one of
 * these, so the calling skill has a fixed, small set of cases to branch on.
 */
export type ErrorCode =
  | "missing_credential"
  | "plausible_unauthorized"
  | "site_not_allowed"
  | "invalid_input"
  | "rate_limited"
  | "upstream_error"
  | "internal_error";

export interface ErrorPayload {
  error: ErrorCode;
  status: number;
  message: string;
  hint?: string;
}

export class CredentialError extends Error {
  readonly code = "missing_credential" as const;
  readonly status = 401;
  constructor(message: string) {
    super(message);
    this.name = "CredentialError";
  }
}

export class SiteNotAllowedError extends Error {
  readonly code = "site_not_allowed" as const;
  readonly status = 403;
  constructor(siteId: string, allowedSites: string[]) {
    super(
      `Site "${siteId}" is not allowed. Allowed sites: ${allowedSites.slice().sort().join(", ")}`
    );
    this.name = "SiteNotAllowedError";
  }
}

/** Local, pre-Plausible validation failures: malformed filters, out-of-range params, etc. */
export class ValidationError extends Error {
  readonly code = "invalid_input" as const;
  readonly status = 422;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class RateLimitError extends Error {
  readonly code = "rate_limited" as const;
  readonly status = 429;
  constructor(
    message: string,
    public readonly retryAfterSeconds: number
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

/**
 * Normalize any error raised while handling a tool call into the wire format from spec §4.
 * Plausible's own message is relayed verbatim wherever we have one — it is the one piece of
 * information the caller can't get any other way, and a locally-invented paraphrase would
 * only cost accuracy.
 */
export function toErrorPayload(error: unknown): ErrorPayload {
  if (
    error instanceof CredentialError ||
    error instanceof SiteNotAllowedError ||
    error instanceof ValidationError
  ) {
    return { error: error.code, status: error.status, message: error.message };
  }

  if (error instanceof RateLimitError) {
    return {
      error: error.code,
      status: error.status,
      message: error.message,
      hint: `Retry after ${error.retryAfterSeconds} seconds.`,
    };
  }

  if (error instanceof PlausibleApiError) {
    if (error.status === 401) {
      return {
        error: "plausible_unauthorized",
        status: 401,
        message: error.body,
        hint:
          "The Plausible API key is invalid or has been revoked — replace it in the connector's configuration.",
      };
    }
    if (error.status === 429) {
      return {
        error: "rate_limited",
        status: 429,
        message: error.body,
        hint: error.retryAfterSeconds
          ? `Retry after ${error.retryAfterSeconds} seconds.`
          : undefined,
      };
    }
    return {
      error: "upstream_error",
      status: error.status,
      message: error.body,
    };
  }

  return {
    error: "internal_error",
    status: 500,
    message: error instanceof Error ? error.message : "An unexpected error occurred",
  };
}

import { describe, it, expect } from "vitest";
import { PlausibleApiError } from "../src/plausible.js";
import {
  toErrorPayload,
  CredentialError,
  SiteNotAllowedError,
  ValidationError,
  RateLimitError,
} from "../src/errors.js";

describe("toErrorPayload", () => {
  it("maps CredentialError to missing_credential/401", () => {
    const payload = toErrorPayload(new CredentialError("Missing Authorization header."));
    expect(payload).toEqual({
      error: "missing_credential",
      status: 401,
      message: "Missing Authorization header.",
    });
  });

  it("maps SiteNotAllowedError to site_not_allowed/403 and names the allowed sites", () => {
    const payload = toErrorPayload(new SiteNotAllowedError("evil.com", ["a.com", "b.com"]));
    expect(payload.error).toBe("site_not_allowed");
    expect(payload.status).toBe(403);
    expect(payload.message).toContain("a.com");
    expect(payload.message).toContain("b.com");
  });

  it("maps ValidationError to invalid_input/422", () => {
    const payload = toErrorPayload(new ValidationError("filters must be an array."));
    expect(payload).toEqual({
      error: "invalid_input",
      status: 422,
      message: "filters must be an array.",
    });
  });

  it("maps RateLimitError to rate_limited/429 with a Retry-After hint", () => {
    const payload = toErrorPayload(new RateLimitError("Local rate limit exceeded.", 42));
    expect(payload.error).toBe("rate_limited");
    expect(payload.status).toBe(429);
    expect(payload.hint).toContain("42");
  });

  it("maps a Plausible 401 to plausible_unauthorized with the verbatim message and a helpful hint", () => {
    const error = new PlausibleApiError(401, "Invalid API key or site ID");
    const payload = toErrorPayload(error);
    expect(payload.error).toBe("plausible_unauthorized");
    expect(payload.status).toBe(401);
    expect(payload.message).toBe("Invalid API key or site ID");
    expect(payload.hint).toContain("revoked");
  });

  it("maps a Plausible 429 to rate_limited and relays Retry-After", () => {
    const error = new PlausibleApiError(429, "Too many requests", 30);
    const payload = toErrorPayload(error);
    expect(payload.error).toBe("rate_limited");
    expect(payload.status).toBe(429);
    expect(payload.message).toBe("Too many requests");
    expect(payload.hint).toContain("30");
  });

  it("maps any other Plausible status to upstream_error with the verbatim message", () => {
    const error = new PlausibleApiError(400, "Unknown filter operator");
    const payload = toErrorPayload(error);
    expect(payload).toEqual({
      error: "upstream_error",
      status: 400,
      message: "Unknown filter operator",
    });
  });

  it("maps an unexpected error to internal_error/500", () => {
    const payload = toErrorPayload(new Error("some internal detail"));
    expect(payload.error).toBe("internal_error");
    expect(payload.status).toBe(500);
  });
});

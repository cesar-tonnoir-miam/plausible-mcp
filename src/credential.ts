import { createHash } from "node:crypto";
import { CredentialError } from "./errors.js";

export interface Credential {
  /** The raw Plausible API key, relayed to Plausible and never logged or echoed back. */
  key: string;
  /** First 8 hex chars of sha256(key) — safe to log, distinguishes callers without naming them. */
  fingerprint: string;
}

const BEARER_PREFIX = /^Bearer\s+(.+)$/;
const MIN_KEY_LENGTH = 16;
const MAX_KEY_LENGTH = 512;
// Printable ASCII only. Excludes control characters and newlines by construction, which is
// what makes this the header-injection check as well as the shape check — no separate scan needed.
const PRINTABLE_ASCII_ONLY = /^[\x20-\x7E]+$/;

/**
 * The single module responsible for turning an incoming `Authorization` header into a
 * usable credential (spec §3.1). Tool handlers call only this — never `process.env`, never a
 * server-side default — so the server has no code path that can serve a request without a
 * caller-supplied key.
 *
 * This checks shape only: length and character set. Whether the key is actually valid is
 * something only Plausible can answer, via the 401 it returns for a bad key.
 */
export function resolveCredential(authorizationHeader: string | null | undefined): Credential {
  if (!authorizationHeader) {
    throw new CredentialError(
      "Missing Authorization header. Pass your Plausible API key as `Bearer <key>`."
    );
  }

  const match = BEARER_PREFIX.exec(authorizationHeader);
  const key = match?.[1]?.trim();
  if (!key) {
    throw new CredentialError(
      "Malformed Authorization header. Expected `Bearer <key>`."
    );
  }

  if (key.length < MIN_KEY_LENGTH || key.length > MAX_KEY_LENGTH) {
    throw new CredentialError(
      `Invalid API key: length must be between ${MIN_KEY_LENGTH} and ${MAX_KEY_LENGTH} characters.`
    );
  }

  if (!PRINTABLE_ASCII_ONLY.test(key)) {
    throw new CredentialError(
      "Invalid API key: must contain only printable ASCII characters (no control characters or line breaks)."
    );
  }

  return { key, fingerprint: fingerprintOf(key) };
}

export function fingerprintOf(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

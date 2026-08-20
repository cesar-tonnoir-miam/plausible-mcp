import { describe, it, expect } from "vitest";
import { resolveCredential, fingerprintOf } from "../src/credential.js";
import { CredentialError } from "../src/errors.js";

const VALID_KEY = "a".repeat(40);

describe("resolveCredential", () => {
  it("rejects a missing header", () => {
    expect(() => resolveCredential(undefined)).toThrow(CredentialError);
    expect(() => resolveCredential(null)).toThrow(CredentialError);
  });

  it("rejects an empty header", () => {
    expect(() => resolveCredential("")).toThrow(CredentialError);
  });

  it("rejects a header without the Bearer prefix", () => {
    expect(() => resolveCredential(VALID_KEY)).toThrow(CredentialError);
  });

  it("rejects Bearer with nothing after it", () => {
    expect(() => resolveCredential("Bearer ")).toThrow(CredentialError);
    expect(() => resolveCredential("Bearer")).toThrow(CredentialError);
  });

  it("rejects a key shorter than 16 characters", () => {
    expect(() => resolveCredential("Bearer short")).toThrow(CredentialError);
  });

  it("rejects a key longer than 512 characters", () => {
    expect(() => resolveCredential(`Bearer ${"a".repeat(513)}`)).toThrow(CredentialError);
  });

  it("rejects a key containing a newline (header injection)", () => {
    expect(() => resolveCredential(`Bearer ${VALID_KEY}\nX-Injected: evil`)).toThrow(
      CredentialError
    );
  });

  it("rejects a key containing a control character", () => {
    expect(() => resolveCredential(`Bearer ${VALID_KEY}\x00`)).toThrow(CredentialError);
  });

  it("accepts a well-formed key and returns it byte-for-byte, untruncated", () => {
    const credential = resolveCredential(`Bearer ${VALID_KEY}`);
    expect(credential.key).toBe(VALID_KEY);
  });

  it("computes an 8-hex-char fingerprint that never contains the key", () => {
    const credential = resolveCredential(`Bearer ${VALID_KEY}`);
    expect(credential.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(credential.fingerprint).not.toContain(VALID_KEY);
  });

  it("fingerprint is stable for the same key and differs across keys", () => {
    const other = "b".repeat(40);
    expect(fingerprintOf(VALID_KEY)).toBe(fingerprintOf(VALID_KEY));
    expect(fingerprintOf(VALID_KEY)).not.toBe(fingerprintOf(other));
  });
});

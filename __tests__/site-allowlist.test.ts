import { describe, it, expect } from "vitest";
import { parseAllowedSites, assertSiteAllowed } from "../src/site-allowlist.js";
import { SiteNotAllowedError } from "../src/errors.js";

describe("parseAllowedSites", () => {
  it("splits, trims, and drops empties", () => {
    expect(parseAllowedSites(" a.com, b.com ,,c.com")).toEqual(["a.com", "b.com", "c.com"]);
  });

  it("returns an empty array for undefined", () => {
    expect(parseAllowedSites(undefined)).toEqual([]);
  });
});

describe("assertSiteAllowed", () => {
  const allowed = ["miam.monoprix.web", "miam.coursesu.web"];

  it("passes for an allowed site", () => {
    expect(() => assertSiteAllowed("miam.monoprix.web", allowed)).not.toThrow();
  });

  it("rejects a site not on the list", () => {
    expect(() => assertSiteAllowed("evil.example.com", allowed)).toThrow(SiteNotAllowedError);
  });

  it("names the allowed sites in the error", () => {
    try {
      assertSiteAllowed("evil.example.com", allowed);
      expect.unreachable();
    } catch (e) {
      expect((e as SiteNotAllowedError).message).toContain("miam.monoprix.web");
      expect((e as SiteNotAllowedError).message).toContain("miam.coursesu.web");
    }
  });

  it("skips the check entirely when allowedSites is undefined (STDIO's unrestricted posture)", () => {
    expect(() => assertSiteAllowed("anything.example.com", undefined)).not.toThrow();
  });
});

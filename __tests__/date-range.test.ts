import { describe, it, expect } from "vitest";
import { resolveDateRange } from "../src/date-range.js";
import type { PlausibleResponse } from "../src/plausible.js";

function response(dateRange?: unknown): PlausibleResponse {
  return { results: [], meta: {}, query: dateRange === undefined ? {} : { date_range: dateRange } };
}

describe("resolveDateRange", () => {
  it("echoes an explicit [start, end] input as-is, ignoring the response", () => {
    const { resolved, warning } = resolveDateRange(
      ["2026-01-01", "2026-01-31"],
      response(["irrelevant", "irrelevant"])
    );
    expect(resolved).toEqual(["2026-01-01", "2026-01-31"]);
    expect(warning).toBeUndefined();
  });

  it("takes the plain [start, end] dates straight from the response for a preset", () => {
    const { resolved, warning } = resolveDateRange("30d", response(["2026-07-24", "2026-08-22"]));
    expect(resolved).toEqual(["2026-07-24", "2026-08-22"]);
    expect(warning).toBeUndefined();
  });

  it("normalizes a full ISO-8601 timestamp-with-offset response to plain dates (observed live behavior)", () => {
    const { resolved, warning } = resolveDateRange(
      "30d",
      response(["2026-07-21T00:00:00+02:00", "2026-08-19T23:59:59+02:00"])
    );
    expect(resolved).toEqual(["2026-07-21", "2026-08-19"]);
    expect(warning).toBeUndefined();
  });

  it("falls back to the preset with a warning when the response carries no resolution", () => {
    const { resolved, warning } = resolveDateRange("30d", response());
    expect(resolved).toBe("30d");
    expect(warning).toContain("30d");
  });
});

import { describe, it, expect } from "vitest";
import {
  isCustomPropertyDimension,
  isValidDimension,
  dimensionSchema,
  dateRangeInputSchema,
  metricsSchema,
  dimensionsSchema,
  limitSchema,
  offsetSchema,
  maxRowsSchema,
  pageSizeSchema,
} from "../src/schemas.js";

describe("isCustomPropertyDimension", () => {
  it("accepts event:props:<name>", () => {
    expect(isCustomPropertyDimension("event:props:plan")).toBe(true);
  });

  it("rejects standard dimensions", () => {
    expect(isCustomPropertyDimension("event:page")).toBe(false);
    expect(isCustomPropertyDimension("visit:source")).toBe(false);
  });

  it("rejects the bare prefix with no name", () => {
    expect(isCustomPropertyDimension("event:props:")).toBe(false);
  });
});

describe("isValidDimension / dimensionSchema", () => {
  it("accepts the fixed event dimensions", () => {
    for (const dim of ["event:name", "event:page", "event:goal"]) {
      expect(isValidDimension(dim)).toBe(true);
    }
  });

  it("accepts any time: dimension", () => {
    expect(isValidDimension("time:day")).toBe(true);
    expect(isValidDimension("time:month")).toBe(true);
  });

  it("accepts any visit: dimension", () => {
    expect(isValidDimension("visit:country_name")).toBe(true);
    expect(isValidDimension("visit:anything_upstream_might_add")).toBe(true);
  });

  it("accepts a custom event:props: dimension", () => {
    expect(isValidDimension("event:props:destination_host")).toBe(true);
  });

  it("rejects the bare event:props: prefix", () => {
    expect(isValidDimension("event:props:")).toBe(false);
  });

  it("rejects an unrelated namespace", () => {
    expect(isValidDimension("segment:whatever")).toBe(false);
  });

  it("dimensionSchema mirrors isValidDimension", () => {
    expect(dimensionSchema.safeParse("event:page").success).toBe(true);
    expect(dimensionSchema.safeParse("segment:whatever").success).toBe(false);
  });
});

describe("dateRangeInputSchema", () => {
  it("accepts an absolute [start, end] tuple", () => {
    expect(dateRangeInputSchema.safeParse(["2026-01-01", "2026-01-31"]).success).toBe(true);
  });

  it("rejects a non-ISO date inside the tuple", () => {
    expect(dateRangeInputSchema.safeParse(["01/01/2026", "2026-01-31"]).success).toBe(false);
  });

  it("accepts relative and named presets", () => {
    for (const preset of ["7d", "30d", "12mo", "day", "month", "year", "all"]) {
      expect(dateRangeInputSchema.safeParse(preset).success).toBe(true);
    }
  });

  it("rejects the legacy comma-joined string format", () => {
    expect(dateRangeInputSchema.safeParse("2026-01-01,2026-01-31").success).toBe(false);
  });

  it("rejects garbage", () => {
    expect(dateRangeInputSchema.safeParse("whenever").success).toBe(false);
  });
});

describe("metricsSchema", () => {
  it("requires at least one metric", () => {
    expect(metricsSchema.safeParse([]).success).toBe(false);
  });

  it("rejects more than 10 metrics", () => {
    const metrics = Array(11).fill("visitors");
    expect(metricsSchema.safeParse(metrics).success).toBe(false);
  });

  it("rejects an unknown metric", () => {
    expect(metricsSchema.safeParse(["not_a_real_metric"]).success).toBe(false);
  });

  it("accepts a valid metrics list", () => {
    expect(metricsSchema.safeParse(["visitors", "events"]).success).toBe(true);
  });
});

describe("dimensionsSchema", () => {
  it("rejects more than 3 dimensions", () => {
    expect(
      dimensionsSchema.safeParse(["event:page", "visit:source", "visit:device", "event:name"])
        .success
    ).toBe(false);
  });

  it("is optional", () => {
    expect(dimensionsSchema.safeParse(undefined).success).toBe(true);
  });
});

describe("numeric param defaults", () => {
  it("limit defaults to 500 and is bounded 1-10000", () => {
    expect(limitSchema.parse(undefined)).toBe(500);
    expect(limitSchema.safeParse(0).success).toBe(false);
    expect(limitSchema.safeParse(10001).success).toBe(false);
  });

  it("offset defaults to 0 and rejects negatives", () => {
    expect(offsetSchema.parse(undefined)).toBe(0);
    expect(offsetSchema.safeParse(-1).success).toBe(false);
  });

  it("max_rows defaults to 50000 and is bounded 1-200000", () => {
    expect(maxRowsSchema.parse(undefined)).toBe(50000);
    expect(maxRowsSchema.safeParse(200001).success).toBe(false);
  });

  it("page_size defaults to 1000 and is bounded 1-10000", () => {
    expect(pageSizeSchema.parse(undefined)).toBe(1000);
    expect(pageSizeSchema.safeParse(10001).success).toBe(false);
  });
});

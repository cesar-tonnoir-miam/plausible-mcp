import { describe, it, expect } from "vitest";
import {
  buildPropertyFilters,
  isCustomPropertyDimension,
  dimensionSchema,
  propertyFilterSchema,
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

describe("dimensionSchema", () => {
  it("parses a standard dimension", () => {
    expect(dimensionSchema.safeParse("event:page").success).toBe(true);
    expect(dimensionSchema.safeParse("visit:country_name").success).toBe(true);
  });

  it("parses a custom property dimension", () => {
    expect(dimensionSchema.safeParse("event:props:destination_host").success).toBe(true);
  });

  it("parses a custom property name beginning with whitespace", () => {
    expect(dimensionSchema.safeParse("event:props: plan").success).toBe(true);
  });

  it("accepts a 300-character custom property name", () => {
    const propertyName = "p".repeat(300);

    expect(dimensionSchema.safeParse(`event:props:${propertyName}`).success).toBe(true);
  });

  it("rejects a custom property name longer than 300 characters", () => {
    const propertyName = "p".repeat(301);

    expect(dimensionSchema.safeParse(`event:props:${propertyName}`).success).toBe(false);
  });

  it("rejects an unknown dimension", () => {
    expect(dimensionSchema.safeParse("event:nonsense").success).toBe(false);
  });

  it("rejects the bare custom-property prefix", () => {
    expect(dimensionSchema.safeParse("event:props:").success).toBe(false);
  });
});

describe("propertyFilterSchema", () => {
  it("defaults the operator to is", () => {
    const parsed = propertyFilterSchema.parse({ property: "plan", values: ["pro"] });
    expect(parsed.operator).toBe("is");
  });

  it("rejects an empty values array", () => {
    expect(
      propertyFilterSchema.safeParse({ property: "plan", values: [] }).success
    ).toBe(false);
  });

  it("rejects an unknown operator", () => {
    expect(
      propertyFilterSchema.safeParse({
        property: "plan",
        operator: "matches",
        values: ["pro"],
      }).success
    ).toBe(false);
  });

  it("accepts a 300-character property name", () => {
    const property = "p".repeat(300);

    expect(propertyFilterSchema.safeParse({ property, values: ["enterprise"] }).success).toBe(
      true
    );
  });

  it("rejects a property name longer than 300 characters", () => {
    const property = "p".repeat(301);

    expect(propertyFilterSchema.safeParse({ property, values: ["enterprise"] }).success).toBe(
      false
    );
  });

  it("rejects a property name with the event:props: prefix", () => {
    expect(() =>
      propertyFilterSchema.parse({ property: "event:props:plan", values: ["enterprise"] })
    ).toThrow("Custom property name must not include the event:props: prefix");
  });
});

describe("buildPropertyFilters", () => {
  it("prefixes the property name and defaults the operator to is", () => {
    expect(buildPropertyFilters([{ property: "plan", values: ["pro"] }])).toEqual([
      ["is", "event:props:plan", ["pro"]],
    ]);
  });

  it("passes through explicit operators and multiple values", () => {
    expect(
      buildPropertyFilters([
        { property: "destination_host", operator: "contains", values: ["github", "gitlab"] },
      ])
    ).toEqual([["contains", "event:props:destination_host", ["github", "gitlab"]]]);
  });

  it("builds one filter per entry", () => {
    expect(
      buildPropertyFilters([
        { property: "plan", operator: "is", values: ["pro"] },
        { property: "ctry", operator: "is_not", values: ["US"] },
      ])
    ).toEqual([
      ["is", "event:props:plan", ["pro"]],
      ["is_not", "event:props:ctry", ["US"]],
    ]);
  });
});

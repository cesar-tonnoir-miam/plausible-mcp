import { describe, it, expect } from "vitest";
import { validateFilters } from "../src/filters.js";

describe("validateFilters", () => {
  it("accepts undefined (no filters)", () => {
    expect(() => validateFilters(undefined)).not.toThrow();
  });

  it("accepts a simple leaf clause", () => {
    expect(() => validateFilters([["is", "event:name", ["recipe.show"]]])).not.toThrow();
  });

  it("accepts the Mealz exclusion filter from the spec's acceptance criteria", () => {
    expect(() =>
      validateFilters([
        ["matches_not", "event:page", ["^/miam", "^/mon-compte"]],
        ["is", "event:name", ["recipe.show"]],
      ])
    ).not.toThrow();
  });

  it("accepts nested and/or/not composition within the depth limit", () => {
    expect(() =>
      validateFilters([
        [
          "and",
          [
            ["is", "event:page", ["/a"]],
            ["or", [["is", "event:name", ["x"]], ["is", "event:name", ["y"]]]],
          ],
        ],
      ])
    ).not.toThrow();
  });

  it("rejects a non-array filters value", () => {
    expect(() => validateFilters("not-an-array")).toThrow();
  });

  it("rejects a clause that isn't an array", () => {
    expect(() => validateFilters(["not-a-clause"])).toThrow();
  });

  it("rejects an unknown operator", () => {
    expect(() => validateFilters([["bogus_op", "event:page", ["/a"]]])).toThrow(/unknown filter operator/i);
  });

  it("rejects more than 20 top-level clauses", () => {
    const clauses = Array.from({ length: 21 }, () => ["is", "event:page", ["/a"]]);
    expect(() => validateFilters(clauses)).toThrow(/at most 20/);
  });

  it("rejects nesting deeper than 4, counting only logical composition", () => {
    // and(1) > and(2) > and(3) > and(4) > is(5) — the leaf lands one level past the limit.
    const leaf = ["is", "event:page", ["/a"]];
    const level4 = ["and", [leaf]];
    const level3 = ["and", [level4]];
    const level2 = ["and", [level3]];
    const level1 = ["and", [level2]];
    expect(() => validateFilters([level1])).toThrow(/nesting depth/i);
  });

  it("does not count a leaf's own values array as nesting depth", () => {
    // A single matches_not with many values is depth 1, not deep nesting.
    expect(() =>
      validateFilters([["matches_not", "event:page", ["^/a", "^/b", "^/c", "^/d"]]])
    ).not.toThrow();
  });

  it("rejects a filters payload over the serialized size budget", () => {
    const hugeValue = "x".repeat(9000);
    expect(() => validateFilters([["is", "event:page", [hugeValue]]])).toThrow(/too large/i);
  });

  it("rejects and/or whose payload isn't an array of sub-clauses", () => {
    expect(() => validateFilters([["and", "not-an-array"]])).toThrow(/sub-clauses/i);
  });
});

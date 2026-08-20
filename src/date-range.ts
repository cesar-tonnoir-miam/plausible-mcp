import type { PlausibleResponse } from "./plausible.js";

export type DateRangeInput = [string, string] | string;
export type DateRangeResolved = [string, string] | string;

/**
 * `date_range_resolved` exists so a preset like "30d" is reproducible after the fact (spec
 * §1.1) — the response must say which actual dates the numbers cover. An explicit `[start,
 * end]` input is already resolved by definition; for a preset, Plausible's own response
 * echoes the absolute range it computed in `query.date_range`, which is the only source of
 * truth for what "30d" meant at query time.
 *
 * Falls back to echoing the preset string with a warning if Plausible's response doesn't
 * carry a parseable resolution — silently returning the preset as if it were the resolved
 * range would defeat the reproducibility this field exists for.
 */
export function resolveDateRange(
  input: DateRangeInput,
  response: PlausibleResponse
): { resolved: DateRangeResolved; warning?: string } {
  if (Array.isArray(input)) {
    return { resolved: input };
  }

  const fromResponse = response.query?.date_range;
  if (
    Array.isArray(fromResponse) &&
    fromResponse.length === 2 &&
    typeof fromResponse[0] === "string" &&
    typeof fromResponse[1] === "string"
  ) {
    // Plausible echoes a resolved preset as full ISO-8601 timestamps with an offset (e.g.
    // "2026-07-21T00:00:00+02:00"), not the plain "YYYY-MM-DD" this field documents — take
    // just the date portion so the shape matches an explicit [start, end] input either way.
    return { resolved: [toPlainDate(fromResponse[0]), toPlainDate(fromResponse[1])] };
  }

  return {
    resolved: input,
    warning: `Plausible's response did not echo a resolved absolute date range for preset "${input}"; date_range_resolved reflects the preset as requested, not confirmed absolute dates.`,
  };
}

function toPlainDate(value: string): string {
  return value.slice(0, 10);
}

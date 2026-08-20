import { z } from "zod";

export const VALID_METRICS = [
  "visitors",
  "visits",
  "pageviews",
  "views_per_visit",
  "bounce_rate",
  "visit_duration",
  "events",
  "scroll_depth",
  "percentage",
  "conversion_rate",
  "group_conversion_rate",
  "average_revenue",
  "total_revenue",
  "time_on_page",
] as const;

export const CUSTOM_PROPERTY_PREFIX = "event:props:";

export function isCustomPropertyDimension(value: string): boolean {
  return value.startsWith(CUSTOM_PROPERTY_PREFIX) && value.length > CUSTOM_PROPERTY_PREFIX.length;
}

/**
 * Dimensions accepted by the Stats API v2 fall into a handful of namespaces rather than a
 * closed enum: fixed event dimensions, a `time:*` family (granularity of a timeseries
 * breakdown), a `visit:*` family (everything about the visiting session), and open-ended
 * `event:props:<name>` custom properties whose names are defined by each site's own tracker
 * and can't be enumerated here.
 */
const FIXED_DIMENSIONS = new Set(["event:name", "event:page", "event:goal"]);

export function isValidDimension(value: string): boolean {
  return (
    FIXED_DIMENSIONS.has(value) ||
    value.startsWith("time:") ||
    value.startsWith("visit:") ||
    isCustomPropertyDimension(value)
  );
}

export const dimensionSchema = z
  .string()
  .refine(isValidDimension, {
    message:
      'Dimension must be "event:name", "event:page", "event:goal", or start with "time:", "visit:", or "event:props:"',
  });

export const siteIdSchema = z
  .string()
  .min(1)
  .describe("Plausible site domain (e.g. example.com). Must be on the server's allowlist.");

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isoDateSchema = z.string().regex(ISO_DATE, "Must be an ISO date, YYYY-MM-DD");

const dateRangePresetSchema = z
  .string()
  .regex(
    /^(\d+h|\d+d|\d+mo|day|month|year|all)$/,
    'Must be "Nh", "Nd", "Nmo", "day", "month", "year", or "all"'
  );

/**
 * `[start, end]` (both inclusive, ISO dates) or a Plausible relative/named preset. Distinct
 * from the upstream project's single comma-joined string — this is the shape the calling
 * skill sends (spec §1.1), and it lets `date_range_resolved` in the response say plainly
 * what was actually queried instead of requiring the caller to parse a delimiter back apart.
 */
export const dateRangeInputSchema = z.union([
  z.tuple([isoDateSchema, isoDateSchema]),
  dateRangePresetSchema,
]);

export const metricsSchema = z
  .array(z.enum(VALID_METRICS))
  .min(1)
  .max(10)
  .describe("1 to 10 metrics to return.");

export const dimensionsSchema = z
  .array(dimensionSchema)
  .max(3)
  .describe("Up to 3 dimensions to group results by.")
  .optional();

/**
 * Shape-only: the actual clause vocabulary is validated by `validateFilters` in ./filters.ts,
 * whose messages are more specific than anything Zod's `.superRefine` would produce here.
 * This just fixes the top-level type so a caller passing a non-array gets a clean 422 instead
 * of an obscure downstream crash.
 */
export const filtersSchema = z.array(z.unknown()).max(20).optional();

export const orderBySchema = z.array(z.unknown()).optional();

export const includeSchema = z.record(z.string(), z.unknown()).optional();

export const limitSchema = z.number().int().min(1).max(10000).default(500);

export const offsetSchema = z.number().int().min(0).default(0);

export const maxRowsSchema = z.number().int().min(1).max(200000).default(50000);

export const pageSizeSchema = z.number().int().min(1).max(10000).default(1000);

export const sumNumericDimensionSchema = z.boolean().default(false);

/**
 * `structuredContent` for `plausible_query` (spec §1.1). Field names are a contract with the
 * `stats-enseignes` skill (spec §8) — do not rename without updating the skill in the same
 * change, since a silent rename makes the skill read `undefined` for `truncated` and treat a
 * truncated result as complete.
 */
export const queryOutputSchema = z.object({
  site_id: z.string(),
  date_range_resolved: z.union([z.tuple([z.string(), z.string()]), z.string()]),
  metrics: z.array(z.string()),
  dimensions: z.array(z.string()),
  filters_sent: z.array(z.unknown()),
  rows: z.array(
    z.object({
      dimensions: z.array(z.union([z.string(), z.number()])),
      metrics: z.array(z.union([z.number(), z.string(), z.null()])),
    })
  ),
  row_count: z.number(),
  truncated: z.boolean(),
  warnings: z.array(z.string()),
});

/** `structuredContent` for `plausible_breakdown_exhaustive` (spec §1.2, contract in §8). */
export const breakdownExhaustiveOutputSchema = z.object({
  site_id: z.string(),
  date_range_resolved: z.union([z.tuple([z.string(), z.string()]), z.string()]),
  dimension: z.string(),
  filters_sent: z.array(z.unknown()),
  pages_fetched: z.number(),
  row_count: z.number(),
  complete: z.boolean(),
  sum: z.number().nullable(),
  sum_metric: z.string().nullable(),
  non_numeric_rows_skipped: z.number(),
  rows: z
    .array(
      z.object({
        dimensions: z.array(z.union([z.string(), z.number()])),
        metrics: z.array(z.union([z.number(), z.string(), z.null()])),
      })
    )
    .nullable(),
  warnings: z.array(z.string()),
});

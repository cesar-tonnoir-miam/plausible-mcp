import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { PlausibleClient, PlausibleResult } from "../plausible.js";
import type { ToolContext } from "../tool-context.js";
import {
  siteIdSchema,
  dateRangeInputSchema,
  metricsSchema,
  dimensionSchema,
  filtersSchema,
  orderBySchema,
  includeSchema,
  maxRowsSchema,
  pageSizeSchema,
  sumNumericDimensionSchema,
  breakdownExhaustiveOutputSchema,
} from "../schemas.js";
import { validateFilters } from "../filters.js";
import { assertSiteAllowed } from "../site-allowlist.js";
import { resolveDateRange, type DateRangeResolved } from "../date-range.js";
import { capRowsToByteBudget } from "../response-size.js";
import { toErrorPayload, RateLimitError, ValidationError } from "../errors.js";
import { logToolCall } from "../logging.js";

const DESCRIPTION = `Parcourt un breakdown Plausible page par page jusqu'à épuisement et retourne soit l'ensemble des lignes, soit une agrégation. À utiliser quand la dimension a une cardinalité élevée (montants de panier, chemins de page) et qu'un résultat tronqué serait faux plutôt qu'incomplet.`;

export function register(server: McpServer, client: PlausibleClient, context: ToolContext) {
  server.registerTool(
    "plausible_breakdown_exhaustive",
    {
      title: "Plausible Breakdown (Exhaustive)",
      description: DESCRIPTION,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      outputSchema: breakdownExhaustiveOutputSchema,
      inputSchema: z.object({
        site_id: siteIdSchema,
        date_range: dateRangeInputSchema,
        metrics: metricsSchema,
        dimension: dimensionSchema,
        filters: filtersSchema,
        order_by: orderBySchema,
        include: includeSchema,
        max_rows: maxRowsSchema,
        sum_numeric_dimension: sumNumericDimensionSchema,
        page_size: pageSizeSchema,
      }),
    },
    async (args) => {
      const startedAt = Date.now();
      let upstreamStatus: number | null = null;
      try {
        assertSiteAllowed(args.site_id, context.allowedSites);
        validateFilters(args.filters);

        if (args.sum_numeric_dimension && args.metrics.length !== 1) {
          throw new ValidationError(
            "sum_numeric_dimension requires exactly one metric — it is the weight in Σ(dimension_value × metric)."
          );
        }

        const allRows: PlausibleResult[] = [];
        let offset = 0;
        let pagesFetched = 0;
        let complete = true;
        let dateRangeResolved: DateRangeResolved | undefined;
        let dateRangeWarning: string | undefined;

        for (;;) {
          if (context.rateLimiter) {
            const decision = context.rateLimiter.consume(context.callerFingerprint);
            if (!decision.allowed) {
              throw new RateLimitError(
                "Local rate limit exceeded during exhaustive pagination.",
                decision.retryAfterSeconds ?? 60
              );
            }
          }

          const result = await client.query({
            site_id: args.site_id,
            metrics: args.metrics,
            date_range: args.date_range,
            dimensions: [args.dimension],
            filters: args.filters,
            order_by: args.order_by,
            include: args.include,
            pagination: { limit: args.page_size, offset },
          });
          pagesFetched += 1;
          upstreamStatus = 200;

          if (!dateRangeResolved) {
            const resolved = resolveDateRange(args.date_range, result);
            dateRangeResolved = resolved.resolved;
            dateRangeWarning = resolved.warning;
          }

          allRows.push(...result.results);

          if (result.results.length < args.page_size) {
            // Incomplete page: this was the last one. Natural end, not a guard trip.
            break;
          }
          if (allRows.length >= args.max_rows) {
            complete = false;
            break;
          }
          // Exactly page_size rows and under max_rows: keep going. If this genuinely was
          // the last page, the next call returns empty and the loop exits above — one
          // extra request, which is the documented, correct behavior (spec §2.3).
          offset += args.page_size;
        }

        const warnings: string[] = [];
        if (dateRangeWarning) warnings.push(dateRangeWarning);
        if (!complete) {
          warnings.push(
            `Stopped at max_rows (${args.max_rows}) before exhausting the breakdown. sum is null — a partial sum would be more dangerous than none. Increase max_rows or narrow the filter.`
          );
        }

        let sum: number | null = null;
        let sumMetric: string | null = null;
        let nonNumericRowsSkipped = 0;
        let rows: { dimensions: (string | number)[]; metrics: (number | string | null)[] }[] | null = null;

        if (args.sum_numeric_dimension) {
          sumMetric = args.metrics[0];
          let runningSum = 0;
          for (const row of allRows) {
            const dimensionValue = row.dimensions[0];
            const numericValue = typeof dimensionValue === "number" ? dimensionValue : Number(dimensionValue);
            const metricValue = row.metrics[0];
            if (!Number.isFinite(numericValue) || typeof metricValue !== "number") {
              nonNumericRowsSkipped += 1;
              continue;
            }
            runningSum += numericValue * metricValue;
          }
          sum = complete ? runningSum : null;
          if (nonNumericRowsSkipped > 0) {
            warnings.push(
              `${nonNumericRowsSkipped} row(s) had a non-numeric "${args.dimension}" value and were excluded from the sum, not silently ignored.`
            );
          }
        } else {
          const mappedRows = allRows.map((row) => ({ dimensions: row.dimensions, metrics: row.metrics }));
          const buildEnvelope = (r: typeof mappedRows) => ({
            site_id: args.site_id,
            date_range_resolved: dateRangeResolved!,
            dimension: args.dimension,
            filters_sent: args.filters ?? [],
            pages_fetched: pagesFetched,
            row_count: r.length,
            complete,
            sum,
            sum_metric: sumMetric,
            non_numeric_rows_skipped: nonNumericRowsSkipped,
            rows: r,
            warnings,
          });
          const capped = capRowsToByteBudget(mappedRows, context.maxResponseBytes, buildEnvelope);
          rows = capped.rows;
          if (capped.truncatedForSize) {
            warnings.push(
              "Response exceeded the size budget and rows were truncated. Use sum_numeric_dimension to aggregate instead of transferring every row."
            );
          }
        }

        const structuredContent = {
          site_id: args.site_id,
          date_range_resolved: dateRangeResolved!,
          dimension: args.dimension,
          filters_sent: args.filters ?? [],
          pages_fetched: pagesFetched,
          row_count: allRows.length,
          complete,
          sum,
          sum_metric: sumMetric,
          non_numeric_rows_skipped: nonNumericRowsSkipped,
          rows,
          warnings,
        };

        logToolCall({
          callerFingerprint: context.callerFingerprint,
          tool: "plausible_breakdown_exhaustive",
          siteId: args.site_id,
          dateRangeResolved: dateRangeResolved!,
          rowCount: structuredContent.row_count,
          durationMs: Date.now() - startedAt,
          upstreamStatus,
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(structuredContent, null, 2) }],
          structuredContent,
        };
      } catch (error) {
        const payload = toErrorPayload(error);
        upstreamStatus = payload.status;
        logToolCall({
          callerFingerprint: context.callerFingerprint,
          tool: "plausible_breakdown_exhaustive",
          siteId: args.site_id,
          dateRangeResolved: null,
          rowCount: null,
          durationMs: Date.now() - startedAt,
          upstreamStatus,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(payload) }],
          isError: true,
        };
      }
    }
  );
}

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { PlausibleClient } from "../plausible.js";
import type { ToolContext } from "../tool-context.js";
import {
  siteIdSchema,
  dateRangeInputSchema,
  metricsSchema,
  dimensionsSchema,
  filtersSchema,
  orderBySchema,
  includeSchema,
  limitSchema,
  offsetSchema,
  queryOutputSchema,
} from "../schemas.js";
import { validateFilters } from "../filters.js";
import { assertSiteAllowed } from "../site-allowlist.js";
import { resolveDateRange } from "../date-range.js";
import { capRowsToByteBudget } from "../response-size.js";
import { toErrorPayload, RateLimitError } from "../errors.js";
import { logToolCall } from "../logging.js";

const DESCRIPTION = `Interroge l'API Plausible Stats v2. Accepte des filtres arbitraires au format v2, ce qui permet d'exprimer n'importe quel périmètre : exclusions, alternatives multiples, combinaisons d'un filtre de page et d'un filtre d'événement. Retourne les lignes agrégées. Pour un breakdown exhaustif à forte cardinalité, utiliser \`plausible_breakdown_exhaustive\` à la place.`;

export function register(server: McpServer, client: PlausibleClient, context: ToolContext) {
  server.registerTool(
    "plausible_query",
    {
      title: "Plausible Query",
      description: DESCRIPTION,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      outputSchema: queryOutputSchema,
      inputSchema: z.object({
        site_id: siteIdSchema,
        date_range: dateRangeInputSchema,
        metrics: metricsSchema,
        dimensions: dimensionsSchema,
        filters: filtersSchema,
        order_by: orderBySchema,
        include: includeSchema,
        limit: limitSchema,
        offset: offsetSchema,
      }),
    },
    async (args) => {
      const startedAt = Date.now();
      let upstreamStatus: number | null = null;
      try {
        assertSiteAllowed(args.site_id, context.allowedSites);
        validateFilters(args.filters);

        if (context.rateLimiter) {
          const decision = context.rateLimiter.consume(context.callerFingerprint);
          if (!decision.allowed) {
            throw new RateLimitError(
              "Local rate limit exceeded.",
              decision.retryAfterSeconds ?? 60
            );
          }
        }

        const dimensions = args.dimensions ?? [];
        const result = await client.query({
          site_id: args.site_id,
          metrics: args.metrics,
          date_range: args.date_range,
          dimensions,
          filters: args.filters,
          order_by: args.order_by,
          include: args.include,
          pagination: { limit: args.limit, offset: args.offset },
        });
        upstreamStatus = 200;

        const { resolved: dateRangeResolved, warning: dateRangeWarning } = resolveDateRange(
          args.date_range,
          result
        );

        const allRows = result.results.map((row) => ({
          dimensions: row.dimensions,
          metrics: row.metrics,
        }));
        const rowCountBeforeSizeCap = allRows.length;
        const truncatedByLimit = rowCountBeforeSizeCap === args.limit;

        const warnings: string[] = [];
        if (dateRangeWarning) warnings.push(dateRangeWarning);
        if (truncatedByLimit) {
          warnings.push(
            `row_count equals limit (${args.limit}); there may be more rows. Paginate with offset, or narrow the query.`
          );
        }

        const buildEnvelope = (rows: typeof allRows) => ({
          site_id: args.site_id,
          date_range_resolved: dateRangeResolved,
          metrics: args.metrics,
          dimensions,
          filters_sent: args.filters ?? [],
          rows,
          row_count: rows.length,
          truncated: truncatedByLimit || rows.length !== rowCountBeforeSizeCap,
          warnings,
        });

        const { rows, truncatedForSize } = capRowsToByteBudget(
          allRows,
          context.maxResponseBytes,
          buildEnvelope
        );
        if (truncatedForSize) {
          warnings.push(
            "Response exceeded the size budget and was truncated. Narrow the filter or use plausible_breakdown_exhaustive with sum_numeric_dimension to avoid transferring every row."
          );
        }

        const structuredContent = buildEnvelope(rows);

        logToolCall({
          callerFingerprint: context.callerFingerprint,
          tool: "plausible_query",
          siteId: args.site_id,
          dateRangeResolved,
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
          tool: "plausible_query",
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

export interface EvalCase {
  name: string;
  prompt: string;
  expectedTool: string;
  assertions: (args: Record<string, unknown>) => string[];
}

function filtersInclude(
  filters: unknown,
  predicate: (clause: unknown[]) => boolean
): boolean {
  return Array.isArray(filters) && filters.some((f) => Array.isArray(f) && predicate(f));
}

export const cases: EvalCase[] = [
  {
    name: "daily visitors timeseries",
    prompt: "Show me daily visitors for example.com for the last 30 days.",
    expectedTool: "plausible_query",
    assertions: (args) => {
      const errors: string[] = [];
      const dimensions = args.dimensions as string[] | undefined;
      if (!dimensions?.some((d) => d.startsWith("time:"))) {
        errors.push(`Expected a time:* dimension, got ${JSON.stringify(dimensions)}`);
      }
      if (args.date_range !== "30d" && !Array.isArray(args.date_range)) {
        errors.push(`Expected date_range "30d" or a [start, end] pair, got "${args.date_range}"`);
      }
      return errors;
    },
  },
  {
    name: "top pages breakdown",
    prompt: "What are our top pages by traffic this month for example.com?",
    expectedTool: "plausible_query",
    assertions: (args) => {
      const errors: string[] = [];
      const dimensions = args.dimensions as string[] | undefined;
      if (!dimensions?.includes("event:page")) {
        errors.push(`Expected dimensions to include "event:page", got ${JSON.stringify(dimensions)}`);
      }
      return errors;
    },
  },
  {
    name: "conversion rate for a goal on a specific page",
    prompt: "What's the signup conversion rate on /pricing for example.com this month?",
    expectedTool: "plausible_query",
    assertions: (args) => {
      const errors: string[] = [];
      const filters = args.filters;
      if (
        !filtersInclude(
          filters,
          (f) => f[1] === "event:goal" && JSON.stringify(f).toLowerCase().includes("signup")
        )
      ) {
        errors.push(`Expected a filter targeting event:goal for Signup, got ${JSON.stringify(filters)}`);
      }
      if (!filtersInclude(filters, (f) => f[1] === "event:page")) {
        errors.push(`Expected a filter targeting event:page, got ${JSON.stringify(filters)}`);
      }
      return errors;
    },
  },
  {
    name: "traffic by country (human-readable names)",
    prompt: "Which countries send the most visitors to example.com this month? Show country names.",
    expectedTool: "plausible_query",
    assertions: (args) => {
      const errors: string[] = [];
      const dimensions = args.dimensions as string[] | undefined;
      if (!dimensions?.includes("visit:country_name") && !dimensions?.includes("visit:country")) {
        errors.push(`Expected visit:country_name (or visit:country), got ${JSON.stringify(dimensions)}`);
      }
      return errors;
    },
  },
  {
    name: "breakdown by a custom property",
    prompt: "Break down visitors by the custom property `destination_host` for example.com this month.",
    expectedTool: "plausible_query",
    assertions: (args) => {
      const errors: string[] = [];
      const dimensions = args.dimensions as string[] | undefined;
      if (!dimensions?.includes("event:props:destination_host")) {
        errors.push(`Expected dimensions to include "event:props:destination_host", got ${JSON.stringify(dimensions)}`);
      }
      return errors;
    },
  },
  {
    name: "filter by a custom property value",
    prompt:
      "Show daily visitors to example.com over the last 30 days, but only for events where the custom property `plan` is `pro`.",
    expectedTool: "plausible_query",
    assertions: (args) => {
      const errors: string[] = [];
      if (
        !filtersInclude(
          args.filters,
          (f) => f[1] === "event:props:plan" && JSON.stringify(f[2]).includes("pro")
        )
      ) {
        errors.push(`Expected a filter for event:props:plan = pro, got ${JSON.stringify(args.filters)}`);
      }
      return errors;
    },
  },
  {
    name: "breakdown filtered by a visit-level dimension",
    prompt:
      "What are the top pages on example.com this month for visitors who arrived via the Organic Search channel?",
    expectedTool: "plausible_query",
    assertions: (args) => {
      const errors: string[] = [];
      const dimensions = args.dimensions as string[] | undefined;
      if (!dimensions?.includes("event:page")) {
        errors.push(`Expected dimensions to include "event:page", got ${JSON.stringify(dimensions)}`);
      }
      if (
        !filtersInclude(
          args.filters,
          (f) => f[1] === "visit:channel" && JSON.stringify(f[2]).includes("Organic Search")
        )
      ) {
        errors.push(`Expected a filter for visit:channel = Organic Search, got ${JSON.stringify(args.filters)}`);
      }
      return errors;
    },
  },
  {
    name: "exclusion filter (the fork's raison d'être)",
    prompt:
      "For example.com, show visitor counts by page name, but exclude anything under /admin or /internal-tools.",
    expectedTool: "plausible_query",
    assertions: (args) => {
      const errors: string[] = [];
      if (
        !filtersInclude(
          args.filters,
          (f) => (f[0] === "matches_not" || f[0] === "contains_not") && f[1] === "event:page"
        )
      ) {
        errors.push(
          `Expected an exclusion filter (matches_not/contains_not) on event:page, got ${JSON.stringify(args.filters)}`
        );
      }
      return errors;
    },
  },
  {
    name: "exhaustive breakdown for a high-cardinality numeric property",
    prompt:
      "I need the exact total revenue for example.com this month, summed from the `total_amount` custom property on every payment.confirmed event — don't give me an approximation, I need every row accounted for.",
    expectedTool: "plausible_breakdown_exhaustive",
    assertions: (args) => {
      const errors: string[] = [];
      if (args.dimension !== "event:props:total_amount") {
        errors.push(`Expected dimension "event:props:total_amount", got "${args.dimension}"`);
      }
      if (args.sum_numeric_dimension !== true) {
        errors.push("Expected sum_numeric_dimension: true for an exact total");
      }
      return errors;
    },
  },
];

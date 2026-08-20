import { ValidationError } from "./errors.js";

/**
 * Stats API v2 filter operators (spec §1.3). This is a shape check, not a grammar — the
 * clause's own arguments (dimension name, values) are forwarded to Plausible untouched and
 * validated by Plausible itself, whose error message is relayed verbatim on rejection. A
 * schema strict enough to fully model the v2 filter grammar would go stale as that grammar
 * evolves and start rejecting legitimate queries.
 */
const FILTER_OPERATORS = new Set([
  "is",
  "is_not",
  "contains",
  "contains_not",
  "matches",
  "matches_not",
  "and",
  "or",
  "not",
  "has_done",
  "has_not_done",
]);

const MAX_TOP_LEVEL_CLAUSES = 20;
const MAX_DEPTH = 4;
const MAX_SERIALIZED_BYTES = 8 * 1024;

/**
 * Depth is counted through logical composition (`and`/`or`/`not`) only — a leaf clause's own
 * values array (e.g. the `["^/miam", "^/mon-compte"]` in a `matches_not`) is data, not nesting,
 * and must not count toward the depth limit.
 */
function validateClause(clause: unknown, depth: number): void {
  if (depth > MAX_DEPTH) {
    throw new ValidationError(`Filter nesting depth exceeds ${MAX_DEPTH}.`);
  }
  if (!Array.isArray(clause) || clause.length === 0 || typeof clause[0] !== "string") {
    throw new ValidationError(
      "Each filter clause must be an array whose first element is an operator string."
    );
  }

  const [operator, ...rest] = clause;
  if (!FILTER_OPERATORS.has(operator)) {
    throw new ValidationError(
      `Unknown filter operator "${operator}". Valid operators: ${[...FILTER_OPERATORS].join(", ")}.`
    );
  }

  if (operator === "and" || operator === "or") {
    const subClauses = rest[0];
    if (!Array.isArray(subClauses)) {
      throw new ValidationError(`"${operator}" filter must wrap an array of sub-clauses.`);
    }
    for (const sub of subClauses) validateClause(sub, depth + 1);
    return;
  }

  if (operator === "not") {
    validateClause(rest[0], depth + 1);
  }
}

/**
 * Validate the *shape* of a `filters` array — size, operator vocabulary, nesting depth,
 * serialized size — and nothing else. Everything that passes this check is forwarded to
 * Plausible as-is; anything Plausible itself rejects comes back as an `upstream_error` with
 * Plausible's own message, which is more accurate than anything this function could invent.
 */
export function validateFilters(filters: unknown): void {
  if (filters === undefined) return;
  if (!Array.isArray(filters)) {
    throw new ValidationError("filters must be an array.");
  }
  if (filters.length > MAX_TOP_LEVEL_CLAUSES) {
    throw new ValidationError(`filters must contain at most ${MAX_TOP_LEVEL_CLAUSES} top-level clauses.`);
  }
  for (const clause of filters) validateClause(clause, 1);

  const byteLength = Buffer.byteLength(JSON.stringify(filters), "utf8");
  if (byteLength > MAX_SERIALIZED_BYTES) {
    throw new ValidationError(
      `filters are too large: ${byteLength} bytes serialized, max ${MAX_SERIALIZED_BYTES}.`
    );
  }
}

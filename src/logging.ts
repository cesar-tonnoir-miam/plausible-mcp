/**
 * Structured, single-line JSON logs to stdout (spec §3.3), which is what Cloud Run captures.
 * Every field here is safe to keep indefinitely: `callerFingerprint` identifies a caller
 * without naming them (the fingerprint-to-person mapping is kept by hand, outside this
 * system), and the API key itself never reaches this function's inputs anywhere in the
 * codebase — there is nothing here to accidentally log.
 */
export interface ToolCallLogEntry {
  callerFingerprint: string;
  tool: string;
  siteId: string;
  dateRangeResolved: unknown;
  rowCount: number | null;
  durationMs: number;
  upstreamStatus: number | null;
}

export function logToolCall(entry: ToolCallLogEntry): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      caller_fingerprint: entry.callerFingerprint,
      tool: entry.tool,
      site_id: entry.siteId,
      date_range_resolved: entry.dateRangeResolved,
      row_count: entry.rowCount,
      duration_ms: entry.durationMs,
      upstream_status: entry.upstreamStatus,
    })
  );
}

/**
 * Cap a serialized response to a byte budget (spec §3.5) by dropping trailing rows — never by
 * silently truncating a row's own fields, which could turn a valid number into a corrupt one.
 * `buildEnvelope` re-serializes the *whole* payload each check, not just the rows array, so the
 * budget accounts for every other field (site_id, filters_sent, warnings, ...) too.
 */
export function capRowsToByteBudget<T>(
  rows: T[],
  maxBytes: number,
  buildEnvelope: (rows: T[]) => unknown
): { rows: T[]; truncatedForSize: boolean } {
  const fits = (n: number) => Buffer.byteLength(JSON.stringify(buildEnvelope(rows.slice(0, n))), "utf8") <= maxBytes;

  if (fits(rows.length)) {
    return { rows, truncatedForSize: false };
  }

  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = lo + Math.ceil((hi - lo) / 2);
    if (fits(mid)) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return { rows: rows.slice(0, lo), truncatedForSize: true };
}

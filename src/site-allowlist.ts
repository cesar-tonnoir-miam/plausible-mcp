import { SiteNotAllowedError } from "./errors.js";

export function parseAllowedSites(value: string | undefined): string[] {
  return (
    value
      ?.split(",")
      .map((site) => site.trim())
      .filter(Boolean) ?? []
  );
}

/**
 * The allowlist is a partial barrier by design (spec §3.2): it stops a caller from reading a
 * site *through this server* that isn't on the list, but a Plausible Stats API key is not
 * itself scopeable to sites, so it does nothing against a caller who queries plausible.io
 * directly with the same key. The real scope reduction is operational (Guest Viewer
 * invitations in Plausible), not this check.
 *
 * `undefined` means "no allowlist configured" — the posture the STDIO entry point uses for a
 * single local user with their own key and direct env access. The deployed HTTP server always
 * passes a concrete (non-empty) list; `PLAUSIBLE_ALLOWED_SITES` is required there.
 */
export function assertSiteAllowed(siteId: string, allowedSites: string[] | undefined): void {
  if (allowedSites && !allowedSites.includes(siteId)) {
    throw new SiteNotAllowedError(siteId, allowedSites);
  }
}

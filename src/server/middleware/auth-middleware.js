import { getAuthStatus } from "../auth.js";

/**
 * @description List of URL path prefixes that do NOT require authentication.
 * These routes are accessible without entering the passphrase.
 * - /api/auth/ — needed to perform the authentication itself
 * - /api/scraper/ — scraper routes are unprotected for future cron use
 * - /css/ — stylesheets needed for the passphrase page
 * - /js/ — scripts needed for the passphrase page
 * - /images/ — images needed for the passphrase page (favicon, logo)
 * - /pages/passphrase.html — the passphrase page itself
 * @type {string[]}
 */
const UNPROTECTED_PREFIXES = [
  "/api/auth/",
  "/api/scraper/",
  "/css/",
  "/js/",
  "/images/",
  "/pages/passphrase.html",
];

/**
 * @description Check whether a given URL path requires authentication.
 * Returns true if the path is NOT in the unprotected list and therefore
 * needs the user to have entered the correct passphrase.
 * @param {string} path - The URL pathname to check
 * @returns {boolean} True if authentication is required for this path
 */
export function requiresAuth(path) {
  for (const prefix of UNPROTECTED_PREFIXES) {
    if (path.startsWith(prefix)) {
      return false;
    }
  }
  return true;
}

/**
 * @description Check the authentication gate for an incoming request.
 * If the route requires auth and the user is not authenticated,
 * returns a Response redirecting to the passphrase page.
 * If auth is not required or the user is authenticated, returns null
 * (meaning the request should proceed normally).
 * @param {string} path - The URL pathname of the request
 * @returns {Response|null} A redirect Response if blocked, or null if allowed
 */
export function checkAuth(path) {
  if (!requiresAuth(path)) {
    return null;
  }

  if (getAuthStatus()) {
    return null;
  }

  // User is not authenticated — redirect to passphrase page
  return new Response(null, {
    status: 302,
    headers: { Location: "/pages/passphrase.html" },
  });
}

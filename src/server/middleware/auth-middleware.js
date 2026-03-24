import { getAuthStatus } from "../auth.js";
import { isDemoMode } from "../test-mode.js";

/**
 * @description Paths exempt from the demo mode write block.
 * Auth routes must remain writable so users can sign in/out.
 * Fetch routes handle demo mode internally (simulated responses).
 * @type {string[]}
 */
const DEMO_WRITE_EXEMPT = ["/api/auth/", "/api/fetch/"];

/**
 * @description List of URL path prefixes that do NOT require authentication.
 * These routes are accessible without entering the passphrase.
 * - /api/auth/ — needed to perform the authentication itself
 * - /api/fetch/ — fetch routes are unprotected for cron-scheduled fetching
 * - /api/backfill/ — historic data backfill (fetches from external APIs)
 * - /css/ — stylesheets needed for the passphrase page
 * - /js/ — scripts needed for the passphrase page
 * - /images/ — images needed for the passphrase page (favicon, logo)
 * - /pages/passphrase.html — the passphrase page itself
 * @type {string[]}
 */
const UNPROTECTED_PREFIXES = ["/api/auth/", "/api/fetch/", "/api/backfill/", "/api/docs/", "/css/", "/js/", "/images/", "/docs/media/", "/pages/passphrase.html"];

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
 * @description Check whether a write request should be blocked in demo mode.
 * In demo mode, all non-GET requests are blocked except for auth routes.
 * Returns a 403 Response if blocked, or null if allowed.
 * @param {string} method - The HTTP method (GET, POST, etc.)
 * @param {string} path - The URL pathname of the request
 * @returns {Response|null} A 403 Response if blocked, or null if allowed
 */
export function checkDemoBlock(method, path) {
  if (!isDemoMode()) return null;
  if (method === "GET") return null;

  // Allow auth routes through (sign-in, sign-out)
  for (var i = 0; i < DEMO_WRITE_EXEMPT.length; i++) {
    if (path.startsWith(DEMO_WRITE_EXEMPT[i])) return null;
  }

  return new Response(
    JSON.stringify({
      error: "Read-only demonstration",
      detail: "Data cannot be modified in demo mode.",
    }),
    { status: 403, headers: { "Content-Type": "application/json" } },
  );
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

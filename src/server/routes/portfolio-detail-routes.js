import { Router } from "../router.js";
import { getPortfolioDetail } from "../services/portfolio-detail-service.js";

/**
 * @description Router instance for portfolio detail API routes.
 * @type {Router}
 */
const detailRouter = new Router();

/**
 * @description GET /api/portfolio/detail?user=BW&account=isa&periods=1m,3m,1y,3y
 * Returns detailed holdings for a specific user account with optional
 * percentage change columns comparing current price to historic prices.
 *
 * Query parameters:
 *   - user: User initials (required, case-insensitive)
 *   - account: Account type — isa, sipp, or trading (required, case-insensitive)
 *   - periods: Comma-separated period codes (optional, e.g. "1m,3m,1y,3y")
 */
detailRouter.get("/api/portfolio/detail", function (request) {
  try {
    const url = new URL(request.url);
    const userInitials = url.searchParams.get("user");
    const accountType = url.searchParams.get("account");
    const periodsParam = url.searchParams.get("periods");

    if (!userInitials || !accountType) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters: user and account" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const periods = periodsParam
      ? periodsParam.split(",").map(function (s) { return s.trim(); }).filter(Boolean)
      : [];

    const detail = getPortfolioDetail(userInitials, accountType, periods);

    if (!detail) {
      return new Response(
        JSON.stringify({ error: "User or account not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify(detail), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache, no-store" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to load portfolio detail", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json", "Cache-Control": "no-cache, no-store" } },
    );
  }
});

/**
 * @description Handle incoming portfolio detail API requests.
 * @param {string} method - HTTP method
 * @param {string} path - Request path
 * @param {Request} request - The incoming request
 * @returns {Response|null} The response, or null if no route matched
 */
export async function handlePortfolioDetailRoute(method, path, request) {
  return await detailRouter.match(method, path, request);
}

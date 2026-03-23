import { Router } from "../router.js";
import { getPortfolioSummary, getPortfolioSummaryAtDate } from "../services/portfolio-service.js";
import { getAllUsers } from "../db/users-db.js";

/**
 * @description Router instance for portfolio summary API routes.
 * @type {Router}
 */
const portfolioRouter = new Router();

// GET /api/portfolio/summary — summaries for ALL users
// Optional query param: ?date=YYYY-MM-DD for historic valuation
portfolioRouter.get("/api/portfolio/summary", function (request) {
  try {
    const url = new URL(request.url);
    const date = url.searchParams.get("date");

    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return new Response(
        JSON.stringify({ error: "Invalid date format — use YYYY-MM-DD" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const users = getAllUsers();
    const summaries = [];

    for (const user of users) {
      const summary = date
        ? getPortfolioSummaryAtDate(user.id, date)
        : getPortfolioSummary(user.id);
      if (summary) {
        summaries.push(summary);
      }
    }

    return new Response(JSON.stringify(summaries), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache, no-store" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to load portfolio summaries", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json", "Cache-Control": "no-cache, no-store" } },
    );
  }
});

// GET /api/portfolio/summary/:userId — summary for a single user
// Optional query param: ?date=YYYY-MM-DD for historic valuation
portfolioRouter.get("/api/portfolio/summary/:userId", function (request, params) {
  try {
    const userId = Number(params.userId);
    if (!userId || userId <= 0) {
      return new Response(
        JSON.stringify({ error: "Invalid user ID" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Check for optional date query parameter
    const url = new URL(request.url);
    const date = url.searchParams.get("date");

    let summary;
    if (date) {
      // Validate date format (YYYY-MM-DD)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return new Response(
          JSON.stringify({ error: "Invalid date format — use YYYY-MM-DD" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
      summary = getPortfolioSummaryAtDate(userId, date);
    } else {
      summary = getPortfolioSummary(userId);
    }

    if (!summary) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache, no-store" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to load portfolio summary", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json", "Cache-Control": "no-cache, no-store" } },
    );
  }
});

/**
 * @description Handle incoming portfolio API requests by matching against registered routes.
 * @param {string} method - HTTP method
 * @param {string} path - Request path
 * @param {Request} request - The incoming request
 * @returns {Response|null} The response, or null if no route matched
 */
export async function handlePortfolioRoute(method, path, request) {
  return await portfolioRouter.match(method, path, request);
}

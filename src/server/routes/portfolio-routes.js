import { Router } from "../router.js";
import { getPortfolioSummary } from "../services/portfolio-service.js";
import { getAllUsers } from "../db/users-db.js";

/**
 * @description Router instance for portfolio summary API routes.
 * @type {Router}
 */
const portfolioRouter = new Router();

// GET /api/portfolio/summary — summaries for ALL users
portfolioRouter.get("/api/portfolio/summary", function () {
  try {
    const users = getAllUsers();
    const summaries = [];

    for (const user of users) {
      const summary = getPortfolioSummary(user.id);
      if (summary) {
        summaries.push(summary);
      }
    }

    return new Response(JSON.stringify(summaries), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to load portfolio summaries", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// GET /api/portfolio/summary/:userId — summary for a single user
portfolioRouter.get("/api/portfolio/summary/:userId", function (request, params) {
  try {
    const userId = Number(params.userId);
    if (!userId || userId <= 0) {
      return new Response(
        JSON.stringify({ error: "Invalid user ID" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const summary = getPortfolioSummary(userId);
    if (!summary) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to load portfolio summary", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
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

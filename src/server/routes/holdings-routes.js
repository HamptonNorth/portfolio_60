import { Router } from "../router.js";
import {
  getHoldingsByAccountId,
  getHoldingById,
  createHolding,
  updateHolding,
  deleteHolding,
} from "../db/holdings-db.js";
import { getAccountById } from "../db/accounts-db.js";
import { validateHolding } from "../validation.js";

/**
 * @description Router instance for holding API routes.
 * @type {Router}
 */
const holdingsRouter = new Router();

// GET /api/accounts/:accountId/holdings — list all holdings for an account
holdingsRouter.get("/api/accounts/:accountId/holdings", function (request, params) {
  try {
    const accountId = Number(params.accountId);
    const account = getAccountById(accountId);
    if (!account) {
      return new Response(
        JSON.stringify({ error: "Account not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    const holdings = getHoldingsByAccountId(accountId);
    return new Response(JSON.stringify(holdings), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch holdings", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// GET /api/holdings/:id — get a single holding
holdingsRouter.get("/api/holdings/:id", function (request, params) {
  try {
    const holding = getHoldingById(Number(params.id));
    if (!holding) {
      return new Response(
        JSON.stringify({ error: "Holding not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify(holding), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch holding", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// POST /api/accounts/:accountId/holdings — create a holding for an account
holdingsRouter.post("/api/accounts/:accountId/holdings", async function (request, params) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid request", detail: "Request body must be valid JSON" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const accountId = Number(params.accountId);
  const account = getAccountById(accountId);
  if (!account) {
    return new Response(
      JSON.stringify({ error: "Account not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  // investment_id is required for create
  if (!body.investment_id) {
    return new Response(
      JSON.stringify({ error: "Validation failed", detail: "Investment is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const errors = validateHolding(body);
  if (errors.length > 0) {
    return new Response(
      JSON.stringify({ error: "Validation failed", detail: errors.join("; ") }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    const holding = createHolding({
      account_id: accountId,
      investment_id: Number(body.investment_id),
      quantity: Number(body.quantity) || 0,
      average_cost: Number(body.average_cost) || 0,
    });
    return new Response(JSON.stringify(holding), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    // Handle unique constraint violation (duplicate investment in account)
    if (err.message && err.message.includes("UNIQUE constraint")) {
      return new Response(
        JSON.stringify({ error: "Validation failed", detail: "This investment is already held in this account" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    // Handle FK violation (invalid investment_id)
    if (err.message && err.message.includes("FOREIGN KEY")) {
      return new Response(
        JSON.stringify({ error: "Validation failed", detail: "Invalid investment selected" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ error: "Failed to create holding", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// PUT /api/holdings/:id — update a holding
holdingsRouter.put("/api/holdings/:id", async function (request, params) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid request", detail: "Request body must be valid JSON" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const errors = validateHolding(body);
  if (errors.length > 0) {
    return new Response(
      JSON.stringify({ error: "Validation failed", detail: errors.join("; ") }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    const holding = updateHolding(Number(params.id), {
      quantity: Number(body.quantity) || 0,
      average_cost: Number(body.average_cost) || 0,
    });
    if (!holding) {
      return new Response(
        JSON.stringify({ error: "Holding not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify(holding), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to update holding", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// DELETE /api/holdings/:id — delete a holding
holdingsRouter.delete("/api/holdings/:id", function (request, params) {
  try {
    const deleted = deleteHolding(Number(params.id));
    if (!deleted) {
      return new Response(
        JSON.stringify({ error: "Holding not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ message: "Holding deleted" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to delete holding", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

/**
 * @description Handle a holding API request. Delegates to the holdings router.
 * @param {string} method - HTTP method
 * @param {string} path - URL pathname
 * @param {Request} request - The full Request object
 * @returns {Promise<Response|null>} Response if matched, null otherwise
 */
export async function handleHoldingsRoute(method, path, request) {
  return await holdingsRouter.match(method, path, request);
}

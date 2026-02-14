import { Router } from "../router.js";
import { createBuyMovement, createSellMovement, createSplitMovement, getMovementById, getMovementsByHoldingId } from "../db/holding-movements-db.js";
import { getHoldingById } from "../db/holdings-db.js";
import { getAccountById } from "../db/accounts-db.js";
import { validateHoldingMovement } from "../validation.js";

/**
 * @description Router instance for holding movement API routes.
 * @type {Router}
 */
const movementsRouter = new Router();

// GET /api/holdings/:holdingId/movements — list movements for a holding
movementsRouter.get("/api/holdings/:holdingId/movements", function (request, params) {
  try {
    const holdingId = Number(params.holdingId);
    const holding = getHoldingById(holdingId);
    if (!holding) {
      return new Response(JSON.stringify({ error: "Holding not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }

    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get("limit"), 10) || 50;
    const movements = getMovementsByHoldingId(holdingId, limit);
    return new Response(JSON.stringify(movements), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to fetch movements", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// GET /api/holding-movements/:id — get a single movement
movementsRouter.get("/api/holding-movements/:id", function (request, params) {
  try {
    const movement = getMovementById(Number(params.id));
    if (!movement) {
      return new Response(JSON.stringify({ error: "Movement not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify(movement), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to fetch movement", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// POST /api/holdings/:holdingId/movements — create a buy or sell movement
movementsRouter.post("/api/holdings/:holdingId/movements", async function (request, params) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request", detail: "Request body must be valid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const holdingId = Number(params.holdingId);
  const holding = getHoldingById(holdingId);
  if (!holding) {
    return new Response(JSON.stringify({ error: "Holding not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
  }

  const errors = validateHoldingMovement(body);
  if (errors.length > 0) {
    return new Response(JSON.stringify({ error: "Validation failed", detail: errors.join("; ") }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // Adjustment (stock split) has different fields from buy/sell
  if (body.movement_type === "adjustment") {
    try {
      const movement = createSplitMovement({
        holding_id: holdingId,
        movement_date: body.movement_date,
        new_quantity: Number(body.new_quantity),
        notes: body.notes || null,
      });

      const updatedHolding = getHoldingById(holdingId);
      const updatedAccount = getAccountById(updatedHolding.account_id);

      return new Response(
        JSON.stringify({
          movement: movement,
          holding: updatedHolding,
          account: updatedAccount,
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    } catch (err) {
      if (err.message === "New quantity must be greater than zero" || err.message === "New quantity is the same as the current quantity") {
        return new Response(JSON.stringify({ error: err.message }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "Failed to create adjustment", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  const quantity = Number(body.quantity);
  const totalConsideration = Number(body.total_consideration);
  const deductibleCosts = Number(body.deductible_costs) || 0;

  // Business rule checks based on movement type
  if (body.movement_type === "buy") {
    // Buy: total consideration must not exceed available cash balance
    const account = getAccountById(holding.account_id);
    if (!account) {
      return new Response(JSON.stringify({ error: "Account not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }
    if (totalConsideration > account.cash_balance) {
      return new Response(
        JSON.stringify({
          error: "Insufficient cash",
          detail: `Total consideration of £${totalConsideration.toFixed(2)} exceeds available balance of £${account.cash_balance.toFixed(2)}`,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
  } else if (body.movement_type === "sell") {
    // Sell: quantity must not exceed current holding quantity
    if (quantity > holding.quantity) {
      return new Response(
        JSON.stringify({
          error: "Insufficient quantity",
          detail: `Sell quantity of ${quantity} exceeds holding quantity of ${holding.quantity}`,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  try {
    const movementData = {
      holding_id: holdingId,
      movement_date: body.movement_date,
      quantity: quantity,
      total_consideration: totalConsideration,
      deductible_costs: deductibleCosts,
      notes: body.notes || null,
    };

    let movement;
    if (body.movement_type === "buy") {
      movement = createBuyMovement(movementData);
    } else {
      movement = createSellMovement(movementData);
    }

    // Return the movement plus updated holding and account for the UI to refresh
    const updatedHolding = getHoldingById(holdingId);
    const updatedAccount = getAccountById(updatedHolding.account_id);

    return new Response(
      JSON.stringify({
        movement: movement,
        holding: updatedHolding,
        account: updatedAccount,
      }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    // Map known business errors to 400
    if (err.message === "Insufficient cash balance" || err.message === "Insufficient holding quantity") {
      return new Response(JSON.stringify({ error: err.message }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "Failed to create movement", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

/**
 * @description Handle a holding movement API request. Delegates to the movements router.
 * @param {string} method - HTTP method
 * @param {string} path - URL pathname
 * @param {Request} request - The full Request object
 * @returns {Promise<Response|null>} Response if matched, null otherwise
 */
export async function handleHoldingMovementsRoute(method, path, request) {
  return await movementsRouter.match(method, path, request);
}

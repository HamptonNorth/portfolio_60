import { Router } from "../router.js";
import { getAllInvestments, getInvestmentById, createInvestment, updateInvestment, deleteInvestment } from "../db/investments-db.js";
import { getAllInvestmentTypes } from "../db/investment-types-db.js";
import { validateInvestment } from "../validation.js";

/**
 * @description Router instance for investment API routes.
 * @type {Router}
 */
const investmentsRouter = new Router();

// GET /api/investment-types — list all investment types (read-only, seeded data)
investmentsRouter.get("/api/investment-types", function () {
  try {
    const types = getAllInvestmentTypes();
    return new Response(JSON.stringify(types), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to fetch investment types", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// GET /api/investments — list all investments with type and currency details
investmentsRouter.get("/api/investments", function () {
  try {
    const investments = getAllInvestments();
    return new Response(JSON.stringify(investments), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to fetch investments", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// GET /api/investments/:id — get a single investment
investmentsRouter.get("/api/investments/:id", function (request, params) {
  try {
    const investment = getInvestmentById(Number(params.id));
    if (!investment) {
      return new Response(JSON.stringify({ error: "Investment not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify(investment), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to fetch investment", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// POST /api/investments — create a new investment
investmentsRouter.post("/api/investments", async function (request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request", detail: "Request body must be valid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // Coerce IDs to numbers for validation and DB
  if (body.currencies_id !== undefined && body.currencies_id !== null) {
    body.currencies_id = Number(body.currencies_id);
  }
  if (body.investment_type_id !== undefined && body.investment_type_id !== null) {
    body.investment_type_id = Number(body.investment_type_id);
  }

  const errors = validateInvestment(body);
  if (errors.length > 0) {
    return new Response(JSON.stringify({ error: "Validation failed", detail: errors.join("; ") }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    const investment = createInvestment(body);
    return new Response(JSON.stringify(investment), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    // Handle FK constraint violations with a clear message
    if (err.message && err.message.includes("FOREIGN KEY")) {
      return new Response(JSON.stringify({ error: "Invalid reference", detail: "The selected currency or investment type does not exist" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "Failed to create investment", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// PUT /api/investments/:id — update an existing investment
investmentsRouter.put("/api/investments/:id", async function (request, params) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request", detail: "Request body must be valid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // Coerce IDs to numbers for validation and DB
  if (body.currencies_id !== undefined && body.currencies_id !== null) {
    body.currencies_id = Number(body.currencies_id);
  }
  if (body.investment_type_id !== undefined && body.investment_type_id !== null) {
    body.investment_type_id = Number(body.investment_type_id);
  }

  const errors = validateInvestment(body);
  if (errors.length > 0) {
    return new Response(JSON.stringify({ error: "Validation failed", detail: errors.join("; ") }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    const investment = updateInvestment(Number(params.id), body);
    if (!investment) {
      return new Response(JSON.stringify({ error: "Investment not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify(investment), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err.message && err.message.includes("FOREIGN KEY")) {
      return new Response(JSON.stringify({ error: "Invalid reference", detail: "The selected currency or investment type does not exist" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "Failed to update investment", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// DELETE /api/investments/:id — delete an investment
investmentsRouter.delete("/api/investments/:id", function (request, params) {
  try {
    const deleted = deleteInvestment(Number(params.id));
    if (!deleted) {
      return new Response(JSON.stringify({ error: "Investment not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ message: "Investment deleted" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to delete investment", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

/**
 * @description Handle an investment API request. Delegates to the investments router.
 * Handles both /api/investments and /api/investment-types routes.
 * @param {string} method - HTTP method
 * @param {string} path - URL pathname
 * @param {Request} request - The full Request object
 * @returns {Promise<Response|null>} Response if matched, null otherwise
 */
export async function handleInvestmentsRoute(method, path, request) {
  return await investmentsRouter.match(method, path, request);
}

import { Router } from "../router.js";
import {
  getAllCurrencies,
  getCurrencyById,
  createCurrency,
  updateCurrency,
  deleteCurrency,
} from "../db/currencies-db.js";
import { validateCurrency } from "../validation.js";

/**
 * @description Router instance for currency API routes.
 * @type {Router}
 */
const currenciesRouter = new Router();

// GET /api/currencies — list all currencies
currenciesRouter.get("/api/currencies", function () {
  try {
    const currencies = getAllCurrencies();
    return new Response(JSON.stringify(currencies), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch currencies", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// GET /api/currencies/:id — get a single currency
currenciesRouter.get("/api/currencies/:id", function (request, params) {
  try {
    const currency = getCurrencyById(Number(params.id));
    if (!currency) {
      return new Response(
        JSON.stringify({ error: "Currency not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify(currency), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch currency", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// POST /api/currencies — create a new currency
currenciesRouter.post("/api/currencies", async function (request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid request", detail: "Request body must be valid JSON" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Auto-uppercase the currency code
  if (body.code) {
    body.code = String(body.code).trim().toUpperCase();
  }

  const errors = validateCurrency(body);
  if (errors.length > 0) {
    return new Response(
      JSON.stringify({ error: "Validation failed", detail: errors.join("; ") }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const currency = createCurrency(body);
    return new Response(JSON.stringify(currency), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    // Handle UNIQUE constraint violation on code
    if (err.message && err.message.includes("UNIQUE")) {
      return new Response(
        JSON.stringify({ error: "Duplicate code", detail: "A currency with code '" + body.code + "' already exists" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({ error: "Failed to create currency", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// PUT /api/currencies/:id — update an existing currency
currenciesRouter.put("/api/currencies/:id", async function (request, params) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid request", detail: "Request body must be valid JSON" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Auto-uppercase the currency code
  if (body.code) {
    body.code = String(body.code).trim().toUpperCase();
  }

  const errors = validateCurrency(body);
  if (errors.length > 0) {
    return new Response(
      JSON.stringify({ error: "Validation failed", detail: errors.join("; ") }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const currency = updateCurrency(Number(params.id), body);
    if (!currency) {
      return new Response(
        JSON.stringify({ error: "Currency not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify(currency), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err.message && err.message.includes("UNIQUE")) {
      return new Response(
        JSON.stringify({ error: "Duplicate code", detail: "A currency with code '" + body.code + "' already exists" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({ error: "Failed to update currency", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// DELETE /api/currencies/:id — delete a currency
currenciesRouter.delete("/api/currencies/:id", function (request, params) {
  try {
    const result = deleteCurrency(Number(params.id));
    if (!result.deleted) {
      const status = result.reason === "Currency not found" ? 404 : 400;
      return new Response(
        JSON.stringify({ error: result.reason }),
        { status: status, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ message: "Currency deleted" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to delete currency", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

/**
 * @description Handle a currency API request. Delegates to the currencies router.
 * @param {string} method - HTTP method
 * @param {string} path - URL pathname
 * @param {Request} request - The full Request object
 * @returns {Promise<Response|null>} Response if matched, null otherwise
 */
export async function handleCurrenciesRoute(method, path, request) {
  return await currenciesRouter.match(method, path, request);
}

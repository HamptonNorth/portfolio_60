import { Router } from "../router.js";
import {
  getAllBenchmarks,
  getBenchmarkById,
  createBenchmark,
  updateBenchmark,
  deleteBenchmark,
  getGbpCurrencyId,
} from "../db/benchmarks-db.js";
import { validateBenchmark } from "../validation.js";

/**
 * @description Router instance for benchmark API routes.
 * @type {Router}
 */
const benchmarksRouter = new Router();

/**
 * @description Validate that index benchmarks use GBP currency.
 * @param {Object} body - The request body with benchmark_type and currencies_id
 * @returns {string|null} Error message if invalid, null if valid
 */
function validateIndexCurrency(body) {
  if (body.benchmark_type === "index") {
    const gbpId = getGbpCurrencyId();
    if (gbpId === null) {
      return "GBP currency must exist before creating index benchmarks";
    }
    if (Number(body.currencies_id) !== gbpId) {
      return "Index benchmarks must use GBP currency";
    }
  }
  return null;
}

// GET /api/benchmarks — list all benchmarks with currency details
benchmarksRouter.get("/api/benchmarks", function () {
  try {
    const benchmarks = getAllBenchmarks();
    return new Response(JSON.stringify(benchmarks), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch benchmarks", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// GET /api/benchmarks/gbp-id — get the GBP currency ID for UI validation
benchmarksRouter.get("/api/benchmarks/gbp-id", function () {
  try {
    const gbpId = getGbpCurrencyId();
    return new Response(JSON.stringify({ gbp_id: gbpId }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch GBP currency ID", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// GET /api/benchmarks/:id — get a single benchmark
benchmarksRouter.get("/api/benchmarks/:id", function (request, params) {
  try {
    const benchmark = getBenchmarkById(Number(params.id));
    if (!benchmark) {
      return new Response(
        JSON.stringify({ error: "Benchmark not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify(benchmark), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch benchmark", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// POST /api/benchmarks — create a new benchmark
benchmarksRouter.post("/api/benchmarks", async function (request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid request", detail: "Request body must be valid JSON" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Coerce currencies_id to number for validation and DB
  if (body.currencies_id !== undefined && body.currencies_id !== null) {
    body.currencies_id = Number(body.currencies_id);
  }

  // Standard field validation
  const errors = validateBenchmark(body);
  if (errors.length > 0) {
    return new Response(
      JSON.stringify({ error: "Validation failed", detail: errors.join("; ") }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Business rule: index benchmarks must use GBP
  const indexCurrencyError = validateIndexCurrency(body);
  if (indexCurrencyError) {
    return new Response(
      JSON.stringify({ error: "Validation failed", detail: indexCurrencyError }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    const benchmark = createBenchmark(body);
    return new Response(JSON.stringify(benchmark), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    // Handle FK constraint violations with a clear message
    if (err.message && err.message.includes("FOREIGN KEY")) {
      return new Response(
        JSON.stringify({ error: "Invalid reference", detail: "The selected currency does not exist" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ error: "Failed to create benchmark", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// PUT /api/benchmarks/:id — update an existing benchmark
benchmarksRouter.put("/api/benchmarks/:id", async function (request, params) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid request", detail: "Request body must be valid JSON" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Coerce currencies_id to number for validation and DB
  if (body.currencies_id !== undefined && body.currencies_id !== null) {
    body.currencies_id = Number(body.currencies_id);
  }

  // Standard field validation
  const errors = validateBenchmark(body);
  if (errors.length > 0) {
    return new Response(
      JSON.stringify({ error: "Validation failed", detail: errors.join("; ") }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Business rule: index benchmarks must use GBP
  const indexCurrencyError = validateIndexCurrency(body);
  if (indexCurrencyError) {
    return new Response(
      JSON.stringify({ error: "Validation failed", detail: indexCurrencyError }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    const benchmark = updateBenchmark(Number(params.id), body);
    if (!benchmark) {
      return new Response(
        JSON.stringify({ error: "Benchmark not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify(benchmark), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err.message && err.message.includes("FOREIGN KEY")) {
      return new Response(
        JSON.stringify({ error: "Invalid reference", detail: "The selected currency does not exist" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ error: "Failed to update benchmark", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// DELETE /api/benchmarks/:id — delete a benchmark
benchmarksRouter.delete("/api/benchmarks/:id", function (request, params) {
  try {
    const result = deleteBenchmark(Number(params.id));
    if (!result.deleted) {
      const status = result.reason === "Benchmark not found" ? 404 : 400;
      return new Response(
        JSON.stringify({ error: result.reason }),
        { status: status, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ message: "Benchmark deleted" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to delete benchmark", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

/**
 * @description Handle a benchmark API request. Delegates to the benchmarks router.
 * @param {string} method - HTTP method
 * @param {string} path - URL pathname
 * @param {Request} request - The full Request object
 * @returns {Promise<Response|null>} Response if matched, null otherwise
 */
export async function handleBenchmarksRoute(method, path, request) {
  return await benchmarksRouter.match(method, path, request);
}

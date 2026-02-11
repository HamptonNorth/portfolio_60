import { Router } from "../router.js";
import { createDrawdownSchedule, updateDrawdownSchedule, deleteDrawdownSchedule, getDrawdownScheduleById, getDrawdownSchedulesByAccountId } from "../db/drawdown-schedules-db.js";
import { getAccountById } from "../db/accounts-db.js";
import { validateDrawdownSchedule } from "../validation.js";
import { previewDrawdowns } from "../services/drawdown-processor.js";

/**
 * @description Router instance for drawdown schedule API routes.
 * @type {Router}
 */
const drawdownRouter = new Router();

// GET /api/accounts/:accountId/drawdown-schedules — list schedules for an account
drawdownRouter.get("/api/accounts/:accountId/drawdown-schedules", function (request, params) {
  try {
    const accountId = Number(params.accountId);
    const account = getAccountById(accountId);
    if (!account) {
      return new Response(JSON.stringify({ error: "Account not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }

    const schedules = getDrawdownSchedulesByAccountId(accountId);
    return new Response(JSON.stringify(schedules), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to fetch schedules", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// POST /api/drawdown-schedules/preview — dry-run preview of what the processor would do
drawdownRouter.post("/api/drawdown-schedules/preview", function () {
  try {
    const result = previewDrawdowns();
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to preview drawdowns", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// GET /api/drawdown-schedules/:id — get a single schedule
drawdownRouter.get("/api/drawdown-schedules/:id", function (request, params) {
  try {
    const schedule = getDrawdownScheduleById(Number(params.id));
    if (!schedule) {
      return new Response(JSON.stringify({ error: "Schedule not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify(schedule), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to fetch schedule", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// POST /api/accounts/:accountId/drawdown-schedules — create a schedule
drawdownRouter.post("/api/accounts/:accountId/drawdown-schedules", async function (request, params) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request", detail: "Request body must be valid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const accountId = Number(params.accountId);
  const account = getAccountById(accountId);
  if (!account) {
    return new Response(JSON.stringify({ error: "Account not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
  }

  // Drawdown schedules are only for SIPP accounts
  if (account.account_type !== "sipp") {
    return new Response(JSON.stringify({ error: "Not a SIPP account", detail: "Drawdown schedules can only be created for SIPP accounts" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const errors = validateDrawdownSchedule(body);
  if (errors.length > 0) {
    return new Response(JSON.stringify({ error: "Validation failed", detail: errors.join("; ") }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    const schedule = createDrawdownSchedule({
      account_id: accountId,
      frequency: body.frequency,
      trigger_day: Number(body.trigger_day),
      from_date: body.from_date,
      to_date: body.to_date,
      amount: Number(body.amount),
      notes: body.notes || null,
    });
    return new Response(JSON.stringify(schedule), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to create schedule", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// PUT /api/drawdown-schedules/:id — update a schedule
drawdownRouter.put("/api/drawdown-schedules/:id", async function (request, params) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request", detail: "Request body must be valid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const errors = validateDrawdownSchedule(body);
  if (errors.length > 0) {
    return new Response(JSON.stringify({ error: "Validation failed", detail: errors.join("; ") }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    const schedule = updateDrawdownSchedule(Number(params.id), {
      frequency: body.frequency,
      trigger_day: Number(body.trigger_day),
      from_date: body.from_date,
      to_date: body.to_date,
      amount: Number(body.amount),
      notes: body.notes || null,
      active: body.active !== undefined ? Number(body.active) : 1,
    });
    if (!schedule) {
      return new Response(JSON.stringify({ error: "Schedule not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify(schedule), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to update schedule", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// DELETE /api/drawdown-schedules/:id — delete a schedule
drawdownRouter.delete("/api/drawdown-schedules/:id", function (request, params) {
  try {
    const deleted = deleteDrawdownSchedule(Number(params.id));
    if (!deleted) {
      return new Response(JSON.stringify({ error: "Schedule not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ message: "Schedule deleted" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to delete schedule", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

/**
 * @description Handle a drawdown schedule API request. Delegates to the drawdown router.
 * @param {string} method - HTTP method
 * @param {string} path - URL pathname
 * @param {Request} request - The full Request object
 * @returns {Promise<Response|null>} Response if matched, null otherwise
 */
export async function handleDrawdownSchedulesRoute(method, path, request) {
  return await drawdownRouter.match(method, path, request);
}

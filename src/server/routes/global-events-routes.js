import { Router } from "../router.js";
import {
  getAllGlobalEvents,
  getGlobalEventById,
  createGlobalEvent,
  updateGlobalEvent,
  deleteGlobalEvent,
} from "../db/global-events-db.js";
import { validateGlobalEvent } from "../validation.js";

/**
 * @description Router instance for global events API routes.
 * @type {Router}
 */
const globalEventsRouter = new Router();

// GET /api/global-events — list all global events (newest first)
globalEventsRouter.get("/api/global-events", function () {
  try {
    const events = getAllGlobalEvents();
    return new Response(JSON.stringify(events), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch global events", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// GET /api/global-events/:id — get a single global event
globalEventsRouter.get("/api/global-events/:id", function (request, params) {
  try {
    const event = getGlobalEventById(Number(params.id));
    if (!event) {
      return new Response(
        JSON.stringify({ error: "Global event not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify(event), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch global event", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// POST /api/global-events — create a new global event
globalEventsRouter.post("/api/global-events", async function (request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid request", detail: "Request body must be valid JSON" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Trim string fields
  if (body.event_date) {
    body.event_date = String(body.event_date).trim();
  }
  if (body.description) {
    body.description = String(body.description).trim();
  }

  const errors = validateGlobalEvent(body);
  if (errors.length > 0) {
    return new Response(
      JSON.stringify({ error: "Validation failed", detail: errors.join("; ") }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const event = createGlobalEvent(body);
    return new Response(JSON.stringify(event), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to create global event", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// PUT /api/global-events/:id — update an existing global event
globalEventsRouter.put("/api/global-events/:id", async function (request, params) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid request", detail: "Request body must be valid JSON" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (body.event_date) {
    body.event_date = String(body.event_date).trim();
  }
  if (body.description) {
    body.description = String(body.description).trim();
  }

  const errors = validateGlobalEvent(body);
  if (errors.length > 0) {
    return new Response(
      JSON.stringify({ error: "Validation failed", detail: errors.join("; ") }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const event = updateGlobalEvent(Number(params.id), body);
    if (!event) {
      return new Response(
        JSON.stringify({ error: "Global event not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify(event), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to update global event", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// DELETE /api/global-events/:id — delete a global event
globalEventsRouter.delete("/api/global-events/:id", function (request, params) {
  try {
    const deleted = deleteGlobalEvent(Number(params.id));
    if (!deleted) {
      return new Response(
        JSON.stringify({ error: "Global event not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ message: "Global event deleted" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to delete global event", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

/**
 * @description Handle a global events API request. Delegates to the global events router.
 * @param {string} method - HTTP method
 * @param {string} path - URL pathname
 * @param {Request} request - The full Request object
 * @returns {Promise<Response|null>} Response if matched, null otherwise
 */
export async function handleGlobalEventsRoute(method, path, request) {
  return await globalEventsRouter.match(method, path, request);
}

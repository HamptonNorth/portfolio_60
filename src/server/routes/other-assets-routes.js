import { Router } from "../router.js";
import {
  getAllOtherAssets,
  getOtherAssetById,
  createOtherAsset,
  updateOtherAsset,
  deleteOtherAsset,
  getOtherAssetHistory,
  getHouseholdAssetsSummary,
} from "../db/other-assets-db.js";
import { validateOtherAsset } from "../validation.js";

/**
 * @description Router instance for other assets API routes.
 * @type {Router}
 */
const otherAssetsRouter = new Router();

// GET /api/other-assets — list all other assets (with user info)
otherAssetsRouter.get("/api/other-assets", function () {
  try {
    const assets = getAllOtherAssets();
    return new Response(JSON.stringify(assets), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch other assets", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// GET /api/other-assets/summary — household assets summary for report block
// Must be registered before /:id to avoid "summary" being parsed as an id
otherAssetsRouter.get("/api/other-assets/summary", function () {
  try {
    const summary = getHouseholdAssetsSummary();
    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch household assets summary", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// GET /api/other-assets/:id — get a single other asset
otherAssetsRouter.get("/api/other-assets/:id", function (request, params) {
  try {
    const asset = getOtherAssetById(Number(params.id));
    if (!asset) {
      return new Response(
        JSON.stringify({ error: "Other asset not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify(asset), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch other asset", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// GET /api/other-assets/:id/history — get change history for an asset
otherAssetsRouter.get("/api/other-assets/:id/history", function (request, params) {
  try {
    const assetId = Number(params.id);
    // Check asset exists
    const asset = getOtherAssetById(assetId);
    if (!asset) {
      return new Response(
        JSON.stringify({ error: "Other asset not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    const history = getOtherAssetHistory(assetId);
    return new Response(JSON.stringify(history), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch asset history", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// POST /api/other-assets — create a new other asset
otherAssetsRouter.post("/api/other-assets", async function (request) {
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
  if (body.description) body.description = String(body.description).trim();
  if (body.category) body.category = String(body.category).trim();
  if (body.value_type) body.value_type = String(body.value_type).trim();
  if (body.frequency) body.frequency = String(body.frequency).trim();
  if (body.notes) body.notes = String(body.notes).trim();
  if (body.executor_reference) body.executor_reference = String(body.executor_reference).trim();

  const errors = validateOtherAsset(body);
  if (errors.length > 0) {
    return new Response(
      JSON.stringify({ error: "Validation failed", detail: errors.join("; ") }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const asset = createOtherAsset(body);
    return new Response(JSON.stringify(asset), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    // FK violation means invalid user_id
    if (err.message && err.message.includes("FOREIGN KEY")) {
      return new Response(
        JSON.stringify({ error: "Validation failed", detail: "User must be a valid selection" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({ error: "Failed to create other asset", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// PUT /api/other-assets/:id — update an existing other asset
otherAssetsRouter.put("/api/other-assets/:id", async function (request, params) {
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
  if (body.description) body.description = String(body.description).trim();
  if (body.category) body.category = String(body.category).trim();
  if (body.value_type) body.value_type = String(body.value_type).trim();
  if (body.frequency) body.frequency = String(body.frequency).trim();
  if (body.notes) body.notes = String(body.notes).trim();
  if (body.executor_reference) body.executor_reference = String(body.executor_reference).trim();

  const errors = validateOtherAsset(body);
  if (errors.length > 0) {
    return new Response(
      JSON.stringify({ error: "Validation failed", detail: errors.join("; ") }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const asset = updateOtherAsset(Number(params.id), body);
    if (!asset) {
      return new Response(
        JSON.stringify({ error: "Other asset not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify(asset), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err.message && err.message.includes("FOREIGN KEY")) {
      return new Response(
        JSON.stringify({ error: "Validation failed", detail: "User must be a valid selection" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({ error: "Failed to update other asset", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// DELETE /api/other-assets/:id — delete an other asset (cascade deletes history)
otherAssetsRouter.delete("/api/other-assets/:id", function (request, params) {
  try {
    const deleted = deleteOtherAsset(Number(params.id));
    if (!deleted) {
      return new Response(
        JSON.stringify({ error: "Other asset not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ message: "Other asset deleted" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to delete other asset", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

/**
 * @description Handle an other assets API request. Delegates to the other assets router.
 * @param {string} method - HTTP method
 * @param {string} path - URL pathname
 * @param {Request} request - The full Request object
 * @returns {Promise<Response|null>} Response if matched, null otherwise
 */
export async function handleOtherAssetsRoute(method, path, request) {
  return await otherAssetsRouter.match(method, path, request);
}

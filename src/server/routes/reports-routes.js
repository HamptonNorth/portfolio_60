import { Router } from "../router.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * @description Router instance for user-reports API routes.
 * Serves composite report definitions from user-reports.json.
 * @type {Router}
 */
const reportsRouter = new Router();

/**
 * @description Path to the user-reports JSON file.
 * @type {string}
 */
const reportsFilePath = resolve(import.meta.dir, "../../shared/user-reports.json");

/**
 * @description Load and parse the user-reports.json file.
 * Re-reads on every call so hand-edits take effect without restart.
 * @returns {Array} Array of report definitions
 */
function loadReportDefinitions() {
  const raw = readFileSync(reportsFilePath, "utf-8");
  return JSON.parse(raw);
}

// GET /api/reports — list all composite report definitions
reportsRouter.get("/api/reports", function () {
  try {
    const reports = loadReportDefinitions();
    return new Response(JSON.stringify(reports), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to load report definitions", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// GET /api/reports/:id — single report definition by ID
reportsRouter.get("/api/reports/:id", function (request, params) {
  try {
    const reports = loadReportDefinitions();
    const report = reports.find(function (r) {
      return r.id === params.id;
    });

    if (!report) {
      return new Response(
        JSON.stringify({ error: "Report not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify(report), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to load report definition", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

/**
 * @description Handle incoming reports API requests by matching against registered routes.
 * @param {string} method - HTTP method
 * @param {string} path - Request path
 * @param {Request} request - The incoming request
 * @returns {Response|null} The response, or null if no route matched
 */
export async function handleReportsRoute(method, path, request) {
  return await reportsRouter.match(method, path, request);
}

import { Router } from "../router.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getReportParams } from "../db/report-params-db.js";

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
 * @description Replace placeholder tokens in all param strings within a
 * report definition array. Tokens are stored in the report_params database
 * table and substituted as plain text (e.g. "USER1:ISA" becomes "BW:ISA").
 * @param {Array} reports - Array of report definitions
 * @param {Object<string, string>} tokenMap - Token-to-value mapping
 * @returns {Array} Reports with tokens replaced in param strings
 */
function substituteTokens(reports, tokenMap) {
  var tokens = Object.keys(tokenMap);
  if (tokens.length === 0) return reports;

  return JSON.parse(JSON.stringify(reports), function (key, value) {
    if (typeof value !== "string") return value;
    var result = value;
    for (var i = 0; i < tokens.length; i++) {
      result = result.split(tokens[i]).join(tokenMap[tokens[i]]);
    }
    return result;
  });
}

/**
 * @description Load and parse the user-reports.json file, with placeholder
 * tokens substituted from the report_params database table.
 * Re-reads the JSON file on every call so hand-edits take effect without restart.
 * @returns {Array} Array of report definitions with tokens resolved
 */
function loadReportDefinitions() {
  const raw = readFileSync(reportsFilePath, "utf-8");
  const reports = JSON.parse(raw);

  try {
    const tokenMap = getReportParams();
    return substituteTokens(reports, tokenMap);
  } catch (err) {
    // If report_params table is empty or unavailable, return reports as-is
    return reports;
  }
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

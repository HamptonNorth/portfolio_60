import { Router } from "../router.js";
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { resolve, dirname, basename, join } from "node:path";
import { getReportParams } from "../db/report-params-db.js";
import { generateHouseholdAssetsPdf } from "../reports/pdf-household-assets.js";
import { generatePortfolioSummaryPdf } from "../reports/pdf-portfolio-summary.js";
import { generatePortfolioDetailPdf } from "../reports/pdf-portfolio-detail.js";

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

// GET /api/reports/raw — return the raw user-reports.json content for editing.
// Creates a timestamped backup before returning so the user can recover if their edits break things.
// Must be registered before /api/reports/:id so "raw" is not matched as an :id param
reportsRouter.get("/api/reports/raw", function () {
  try {
    backupJsonFile(reportsFilePath);
    const raw = readFileSync(reportsFilePath, "utf-8");
    return new Response(JSON.stringify({ content: raw, path: reportsFilePath }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to read reports file", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// GET /api/reports/pdf/household-assets — generate and return PDF
// Must be registered before /api/reports/:id so "pdf" is not matched as an :id param
reportsRouter.get("/api/reports/pdf/household-assets", async function () {
  try {
    const pdfBytes = await generateHouseholdAssetsPdf();
    return new Response(pdfBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="household-assets.pdf"',
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to generate PDF", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// GET /api/reports/pdf/portfolio-summary — generate portfolio summary PDF.
// Accepts optional "params" query parameter as a comma-separated list of
// user initials entries (e.g. "AW,BW,AW + BW"). Tokens like USER1 are
// resolved from the report_params table inside the generator.
// Must be registered before /api/reports/:id so "pdf" is not matched as an :id param
reportsRouter.get("/api/reports/pdf/portfolio-summary", async function (request) {
  try {
    const url = new URL(request.url);
    const paramsStr = url.searchParams.get("params");
    var params = [];
    if (paramsStr) {
      params = paramsStr.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    }

    const pdfBytes = await generatePortfolioSummaryPdf(params);
    return new Response(pdfBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="portfolio-summary.pdf"',
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to generate PDF", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// GET /api/reports/pdf/portfolio-detail — generate portfolio detail PDF.
// Accepts optional "params" query parameter as a pipe-separated list of
// detail param strings (e.g. "BW:ISA:1m,3m|BW:SIPP:1m,3m"). Pipe-separated
// because each param contains commas for period codes. Tokens like USER1
// are resolved from the report_params table inside the generator.
// Must be registered before /api/reports/:id so "pdf" is not matched as an :id param
reportsRouter.get("/api/reports/pdf/portfolio-detail", async function (request) {
  try {
    const url = new URL(request.url);
    const paramsStr = url.searchParams.get("params");
    var params = [];
    if (paramsStr) {
      params = paramsStr.split("|").map(function (s) { return s.trim(); }).filter(Boolean);
    }

    const pdfBytes = await generatePortfolioDetailPdf(params);
    return new Response(pdfBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="portfolio-detail.pdf"',
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to generate PDF", detail: err.message }),
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
 * @description Create a timestamped backup of a JSON file before overwriting.
 * @param {string} filePath - Absolute path to the file to back up
 */
function backupJsonFile(filePath) {
  if (!existsSync(filePath)) return;
  const dir = dirname(filePath);
  const base = basename(filePath, ".json");
  const now = new Date();
  const pad = function (n) { return String(n).padStart(2, "0"); };
  const timestamp = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) + "-" + pad(now.getHours()) + "-" + pad(now.getMinutes());
  const backupName = base + "-backup-" + timestamp + ".json";
  const backupPath = join(dir, backupName);
  copyFileSync(filePath, backupPath);
}

// PUT /api/reports/raw — save edited user-reports.json content with backup
reportsRouter.put("/api/reports/raw", async function (request) {
  try {
    const body = await request.json();
    const content = body.content;

    if (typeof content !== "string" || content.trim().length === 0) {
      return new Response(JSON.stringify({ error: "Content is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Validate that the content is valid JSON
    try {
      JSON.parse(content);
    } catch (parseErr) {
      return new Response(
        JSON.stringify({ error: "Invalid JSON", detail: parseErr.message }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    writeFileSync(reportsFilePath, content, "utf-8");

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to save reports", detail: err.message }),
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

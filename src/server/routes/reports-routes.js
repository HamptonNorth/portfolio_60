import { Router } from "../router.js";
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { resolve, dirname, basename, join } from "node:path";
import { getReportParams } from "../db/report-params-db.js";
import { generateHouseholdAssetsPdf } from "../reports/pdf-household-assets.js";
import { generatePortfolioSummaryPdf } from "../reports/pdf-portfolio-summary.js";
import { generatePortfolioDetailPdf } from "../reports/pdf-portfolio-detail.js";
import { generateCompositePdf } from "../reports/pdf-compositor.js";
import { generateChartPdf, generateChartGroupPdf } from "../reports/pdf-chart.js";
import { isTestMode } from "../test-mode.js";

/**
 * @description Router instance for views and reports API routes.
 * Views are HTML composite reports (user-views.json).
 * Reports are PDF reports (user-reports.json).
 * @type {Router}
 */
const reportsRouter = new Router();

/**
 * @description Path to the user-views JSON file (HTML composite reports).
 * @type {string}
 */
const viewsFilePath = resolve(import.meta.dir, "../../shared/user-views.json");

/**
 * @description Paths to the user-reports JSON files (PDF reports).
 * The test file is used when the app is in test mode; the live file is used otherwise.
 * @type {string}
 */
const reportsFilePath = resolve(import.meta.dir, "../../shared/user-reports.json");
const reportsTestFilePath = resolve(import.meta.dir, "../../shared/user-reports-test.json");

/**
 * @description Replace placeholder tokens in all param strings within a
 * definition array. Tokens are stored in the report_params database
 * table and substituted as plain text (e.g. "USER1:ISA" becomes "BW:ISA").
 * @param {Array} definitions - Array of view or report definitions
 * @param {Object<string, string>} tokenMap - Token-to-value mapping
 * @returns {Array} Definitions with tokens replaced in param strings
 */
function substituteTokens(definitions, tokenMap) {
  var tokens = Object.keys(tokenMap);
  if (tokens.length === 0) return definitions;

  return JSON.parse(JSON.stringify(definitions), function (key, value) {
    if (typeof value !== "string") return value;
    var result = value;
    for (var i = 0; i < tokens.length; i++) {
      result = result.split(tokens[i]).join(tokenMap[tokens[i]]);
    }
    return result;
  });
}

/**
 * @description Load and parse the user-views.json file, with placeholder
 * tokens substituted from the report_params database table.
 * Re-reads the JSON file on every call so hand-edits take effect without restart.
 * @returns {Array} Array of view definitions with tokens resolved
 */
function loadViewDefinitions() {
  const raw = readFileSync(viewsFilePath, "utf-8");
  const views = JSON.parse(raw);

  try {
    const tokenMap = getReportParams();
    return substituteTokens(views, tokenMap);
  } catch (err) {
    return views;
  }
}

/**
 * @description Load and parse the appropriate user-reports JSON file (PDF reports),
 * selecting the test file when in test mode and the live file otherwise.
 * Placeholder tokens are substituted from the report_params database table.
 * Re-reads the JSON file on every call so hand-edits take effect without restart.
 * @returns {Array} Array of PDF report definitions with tokens resolved
 */
function loadReportDefinitions() {
  var filePath = isTestMode() ? reportsTestFilePath : reportsFilePath;
  const raw = readFileSync(filePath, "utf-8");
  const reports = JSON.parse(raw);

  try {
    const tokenMap = getReportParams();
    return substituteTokens(reports, tokenMap);
  } catch (err) {
    return reports;
  }
}

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

// ─── Views endpoints (HTML composite reports) ───────────────────────────────

// GET /api/views — list all view definitions (with tokens substituted)
reportsRouter.get("/api/views", function () {
  try {
    const views = loadViewDefinitions();
    return new Response(JSON.stringify(views), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to load view definitions", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// GET /api/views/raw — return raw user-views.json content for editing.
// Creates a timestamped backup before returning.
// Must be registered before /api/views/:id so "raw" is not matched as an :id param
reportsRouter.get("/api/views/raw", function () {
  try {
    backupJsonFile(viewsFilePath);
    const raw = readFileSync(viewsFilePath, "utf-8");
    return new Response(JSON.stringify({ content: raw, path: viewsFilePath }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to read views file", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// GET /api/views/:id — single view definition by ID
reportsRouter.get("/api/views/:id", function (request, params) {
  try {
    const views = loadViewDefinitions();
    const view = views.find(function (v) {
      return v.id === params.id;
    });

    if (!view) {
      return new Response(
        JSON.stringify({ error: "View not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify(view), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to load view definition", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// PUT /api/views/raw — save edited user-views.json content with backup
reportsRouter.put("/api/views/raw", async function (request) {
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

    writeFileSync(viewsFilePath, content, "utf-8");

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to save views", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// ─── Reports endpoints (PDF reports) ────────────────────────────────────────

// GET /api/reports — list all PDF report definitions (with tokens substituted)
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

// GET /api/reports/raw — return raw user-reports.json content for editing.
// Creates a timestamped backup before returning.
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
    const compareTo = url.searchParams.get("compareTo") || null;
    var params = [];
    if (paramsStr) {
      params = paramsStr.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    }

    const pdfBytes = await generatePortfolioSummaryPdf(params, compareTo);
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

// GET /api/reports/pdf/composite — generate a composite PDF from a report
// definition that contains a "blocks" array. Accepts the report ID as a
// query parameter (e.g. /api/reports/pdf/composite?id=weekly_pdf).
// Must be registered before /api/reports/:id so "pdf" is not matched as an :id param
reportsRouter.get("/api/reports/pdf/composite", async function (request) {
  try {
    const url = new URL(request.url);
    const reportId = url.searchParams.get("id");

    if (!reportId) {
      return new Response(
        JSON.stringify({ error: "Report ID is required (use ?id=...)" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const reports = loadReportDefinitions();
    const report = reports.find(function (r) {
      return r.id === reportId;
    });

    if (!report) {
      return new Response(
        JSON.stringify({ error: "Report not found: " + reportId }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    if (!report.blocks || !Array.isArray(report.blocks)) {
      return new Response(
        JSON.stringify({ error: "Report has no blocks array: " + reportId }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const pdfBytes = await generateCompositePdf(report);
    var filename = (report.id || "report").replace(/[^a-z0-9_-]/gi, "-") + ".pdf";
    return new Response(pdfBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="' + filename + '"',
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to generate composite PDF", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// GET /api/reports/pdf/chart — generate a standalone performance chart PDF.
// Accepts the report ID as a query parameter (e.g. /api/reports/pdf/chart?id=chart_uk_funds).
// Looks up the report definition and passes the full definition to the chart generator.
// Must be registered before /api/reports/:id so "pdf" is not matched as an :id param
reportsRouter.get("/api/reports/pdf/chart", async function (request) {
  try {
    const url = new URL(request.url);
    const reportId = url.searchParams.get("id");

    if (!reportId) {
      return new Response(
        JSON.stringify({ error: "Report ID is required (use ?id=...)" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const reports = loadReportDefinitions();
    const report = reports.find(function (r) {
      return r.id === reportId;
    });

    if (!report) {
      return new Response(
        JSON.stringify({ error: "Report not found: " + reportId }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    const pdfBytes = await generateChartPdf(report);
    var filename = (report.id || "chart").replace(/[^a-z0-9_-]/gi, "-") + ".pdf";
    return new Response(pdfBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="' + filename + '"',
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to generate chart PDF", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// GET /api/reports/pdf/chart-group — generate a multi-chart PDF (1-4 charts on one page).
// Accepts the report ID as a query parameter (e.g. /api/reports/pdf/chart-group?id=multi_charts).
// Layout depends on chart count: 1→landscape, 2→portrait stacked, 3-4→landscape 2×2 grid.
reportsRouter.get("/api/reports/pdf/chart-group", async function (request) {
  try {
    const url = new URL(request.url);
    const reportId = url.searchParams.get("id");

    if (!reportId) {
      return new Response(
        JSON.stringify({ error: "Report ID is required (use ?id=...)" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const reports = loadReportDefinitions();
    const report = reports.find(function (r) {
      return r.id === reportId;
    });

    if (!report) {
      return new Response(
        JSON.stringify({ error: "Report not found: " + reportId }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    const pdfBytes = await generateChartGroupPdf(report);
    var filename = (report.id || "chart-group").replace(/[^a-z0-9_-]/gi, "-") + ".pdf";
    return new Response(pdfBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="' + filename + '"',
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to generate chart group PDF", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// GET /api/reports/:id — single PDF report definition by ID
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
 * @description Handle incoming views and reports API requests by matching
 * against registered routes.
 * @param {string} method - HTTP method
 * @param {string} path - Request path
 * @param {Request} request - The incoming request
 * @returns {Response|null} The response, or null if no route matched
 */
export async function handleReportsRoute(method, path, request) {
  return await reportsRouter.match(method, path, request);
}

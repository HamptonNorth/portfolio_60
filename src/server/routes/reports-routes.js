import { Router } from "../router.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { backupJsonFile } from "../file-utils.js";
import { getReportParams, getAllReportParams } from "../db/report-params-db.js";
import { generateHouseholdAssetsPdf } from "../reports/pdf-household-assets.js";
import { generatePortfolioSummaryPdf } from "../reports/pdf-portfolio-summary.js";
import { generatePortfolioDetailPdf } from "../reports/pdf-portfolio-detail.js";
import { generateCompositePdf } from "../reports/pdf-compositor.js";
import { generateChartPdf, generateChartGroupPdf } from "../reports/pdf-chart.js";
import { generatePortfolioValueChartPdf } from "../reports/pdf-portfolio-value-chart.js";
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
  const tokens = Object.keys(tokenMap);
  if (tokens.length === 0) return definitions;

  return JSON.parse(JSON.stringify(definitions), function (key, value) {
    if (typeof value !== "string") return value;
    let result = value;
    for (let i = 0; i < tokens.length; i++) {
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
  const filePath = isTestMode() ? reportsTestFilePath : reportsFilePath;
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
 * @description Read the raw report definitions array from the JSON file
 * (without token substitution). Uses the test file when in test mode.
 * @returns {Array} Array of report definition objects
 */
function readRawReports() {
  const filePath = isTestMode() ? reportsTestFilePath : reportsFilePath;
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
}

/**
 * @description Write the report definitions array back to the JSON file
 * with a timestamped backup. Uses the test file when in test mode.
 * @param {Array} reports - The full array of report definitions
 */
function writeReports(reports) {
  const filePath = isTestMode() ? reportsTestFilePath : reportsFilePath;
  backupJsonFile(filePath);
  writeFileSync(filePath, JSON.stringify(reports, null, 2) + "\n", "utf-8");
}

/**
 * @description Validate a report definition object has the minimum required fields.
 * Returns an error string if invalid, or null if valid.
 * @param {Object} report - The report definition to validate
 * @returns {string|null} Error message if invalid, null if valid
 */
function validateReportDefinition(report) {
  if (!report || typeof report !== "object") {
    return "Report definition must be an object";
  }
  if (!report.id || typeof report.id !== "string" || report.id.trim().length === 0) {
    return "Report ID is required";
  }
  if (!report.title || typeof report.title !== "string" || report.title.trim().length === 0) {
    return "Report title is required";
  }
  // Composite reports need at least one block
  if (report.blocks) {
    if (!Array.isArray(report.blocks) || report.blocks.length === 0) {
      return "Composite reports must have at least one block";
    }
  }
  // Chart groups need 1-4 charts
  if (report.charts) {
    if (!Array.isArray(report.charts) || report.charts.length === 0 || report.charts.length > 4) {
      return "Chart groups must have between 1 and 4 charts";
    }
  }
  return null;
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
// Creates a timestamped backup before returning. Used by the JSON text editor.
// Must be registered before /api/reports/:id so "raw" is not matched as an :id param
reportsRouter.get("/api/reports/raw", function () {
  try {
    const filePath = isTestMode() ? reportsTestFilePath : reportsFilePath;
    backupJsonFile(filePath);
    const raw = readFileSync(filePath, "utf-8");
    return new Response(JSON.stringify({ content: raw, path: filePath }), {
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

// GET /api/reports/definitions — return raw report definitions array (no token
// substitution, no backup). Used by the Manage Reports page for CRUD operations.
// Must be registered before /api/reports/:id so "definitions" is not matched as :id
reportsRouter.get("/api/reports/definitions", function () {
  try {
    const reports = readRawReports();
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
    let params = [];
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
    let params = [];
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
    const filename = (report.id || "report").replace(/[^a-z0-9_-]/gi, "-") + ".pdf";
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
    const filename = (report.id || "chart").replace(/[^a-z0-9_-]/gi, "-") + ".pdf";
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

// GET /api/reports/pdf/portfolio-value-chart — generate a portfolio value chart PDF.
// Plots account values over time for specified users/account types.
// Accepts the report ID as a query parameter (e.g. ?id=portfolio_value_chart).
reportsRouter.get("/api/reports/pdf/portfolio-value-chart", async function (request) {
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

    const pdfBytes = await generatePortfolioValueChartPdf(report);
    const filename = (report.id || "portfolio-value-chart").replace(/[^a-z0-9_-]/gi, "-") + ".pdf";
    return new Response(pdfBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="' + filename + '"',
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to generate portfolio value chart PDF", detail: err.message }),
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
    const filename = (report.id || "chart-group").replace(/[^a-z0-9_-]/gi, "-") + ".pdf";
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

    const filePath = isTestMode() ? reportsTestFilePath : reportsFilePath;
    writeFileSync(filePath, content, "utf-8");

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

// ─── Report Definition CRUD ──────────────────────────────────────────────────

// GET /api/reports/tokens — return the report_params token map for the UI
reportsRouter.get("/api/reports/tokens", function () {
  try {
    const params = getAllReportParams();
    return new Response(JSON.stringify(params), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to load tokens", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// POST /api/reports/definition — add a new report definition
reportsRouter.post("/api/reports/definition", async function (request) {
  try {
    const body = await request.json();
    const error = validateReportDefinition(body);
    if (error) {
      return new Response(JSON.stringify({ error: error }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const reports = readRawReports();

    // Check for duplicate ID
    const duplicate = reports.find(function (r) { return r.id === body.id; });
    if (duplicate) {
      return new Response(JSON.stringify({ error: "A report with ID '" + body.id + "' already exists" }), {
        status: 409, headers: { "Content-Type": "application/json" },
      });
    }

    reports.push(body);
    writeReports(reports);

    return new Response(JSON.stringify({ success: true, index: reports.length - 1 }), {
      status: 201, headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to add report", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// PUT /api/reports/definition/:index — update a report definition at index
reportsRouter.put("/api/reports/definition/:index", async function (request, params) {
  try {
    const index = parseInt(params.index, 10);
    const reports = readRawReports();

    if (isNaN(index) || index < 0 || index >= reports.length) {
      return new Response(JSON.stringify({ error: "Report not found" }), {
        status: 404, headers: { "Content-Type": "application/json" },
      });
    }

    const body = await request.json();
    const error = validateReportDefinition(body);
    if (error) {
      return new Response(JSON.stringify({ error: error }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    // Check for duplicate ID (excluding the current index)
    const duplicate = reports.find(function (r, i) { return i !== index && r.id === body.id; });
    if (duplicate) {
      return new Response(JSON.stringify({ error: "A report with ID '" + body.id + "' already exists" }), {
        status: 409, headers: { "Content-Type": "application/json" },
      });
    }

    reports[index] = body;
    writeReports(reports);

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to update report", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// DELETE /api/reports/definition/:index — delete a report definition
reportsRouter.delete("/api/reports/definition/:index", async function (request, params) {
  try {
    const index = parseInt(params.index, 10);
    const reports = readRawReports();

    if (isNaN(index) || index < 0 || index >= reports.length) {
      return new Response(JSON.stringify({ error: "Report not found" }), {
        status: 404, headers: { "Content-Type": "application/json" },
      });
    }

    reports.splice(index, 1);
    writeReports(reports);

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to delete report", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// PUT /api/reports/reorder — reorder reports by moving an item from one index to another
reportsRouter.put("/api/reports/reorder", async function (request) {
  try {
    const body = await request.json();
    const fromIndex = body.from;
    const toIndex = body.to;

    const reports = readRawReports();

    if (typeof fromIndex !== "number" || typeof toIndex !== "number" ||
        fromIndex < 0 || fromIndex >= reports.length ||
        toIndex < 0 || toIndex >= reports.length) {
      return new Response(JSON.stringify({ error: "Invalid indices" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const item = reports.splice(fromIndex, 1)[0];
    reports.splice(toIndex, 0, item);
    writeReports(reports);

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to reorder reports", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// POST /api/reports/duplicate/:index — duplicate a report definition
reportsRouter.post("/api/reports/duplicate/:index", async function (request, params) {
  try {
    const index = parseInt(params.index, 10);
    const reports = readRawReports();

    if (isNaN(index) || index < 0 || index >= reports.length) {
      return new Response(JSON.stringify({ error: "Report not found" }), {
        status: 404, headers: { "Content-Type": "application/json" },
      });
    }

    const original = reports[index];
    const copy = JSON.parse(JSON.stringify(original));
    copy.id = original.id + "_copy";
    copy.title = original.title + " (Copy)";

    // Ensure unique ID
    let counter = 1;
    while (reports.find(function (r) { return r.id === copy.id; })) {
      counter++;
      copy.id = original.id + "_copy" + counter;
    }

    reports.splice(index + 1, 0, copy);
    writeReports(reports);

    return new Response(JSON.stringify({ success: true, index: index + 1 }), {
      status: 201, headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to duplicate report", detail: err.message }),
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

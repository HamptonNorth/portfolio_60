/**
 * @description API routes for the investment analysis feature.
 * Provides league table, risk/return scatter, top/bottom performer,
 * and multi-period comparison data.
 */

import { Router } from "../router.js";
import {
  buildLeagueTable,
  buildRiskReturnData,
  buildTopBottomPerformers,
  buildBenchmarkReturnData,
  buildBenchmarkRebasedSeries,
  buildComparisonTable,
  PERIOD_WEEKS,
} from "../services/analysis-service.js";
import {
  generateComparisonPdf,
  generateLeagueTablePdf,
  generateTopBottomPdf,
  generateRiskReturnPdf,
} from "../reports/pdf-analysis.js";

const analysisRouter = new Router();

/**
 * @description Validate a period query parameter.
 * @param {string} period - The period code from the query string
 * @returns {string|null} Valid period code or null if invalid
 */
function validatePeriod(period) {
  if (!period || !PERIOD_WEEKS[period]) return null;
  return period;
}

/**
 * @description Parse a comma-separated list of benchmark IDs from a query parameter.
 * Returns an array of valid positive integers, max 3.
 * @param {string} param - The raw query parameter value (e.g. "1,3,5")
 * @returns {Array<number>} Array of benchmark IDs
 */
function parseBenchmarkIds(param) {
  if (!param) return [];
  var ids = [];
  var parts = param.split(",");
  for (var i = 0; i < parts.length && ids.length < 3; i++) {
    var id = parseInt(parts[i], 10);
    if (id > 0) ids.push(id);
  }
  return ids;
}

// GET /api/analysis/league-table?period=1y — return ranked investments with sparklines
analysisRouter.get("/api/analysis/league-table", function (request) {
  try {
    var url = new URL(request.url);
    var period = validatePeriod(url.searchParams.get("period")) || "1y";
    var data = buildLeagueTable(period);

    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to build league table", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// GET /api/analysis/risk-return?period=1y&benchmarks=1,3 — return risk vs return scatter data
analysisRouter.get("/api/analysis/risk-return", function (request) {
  try {
    var url = new URL(request.url);
    var period = validatePeriod(url.searchParams.get("period")) || "1y";
    var benchmarkIds = parseBenchmarkIds(url.searchParams.get("benchmarks"));
    var data = buildRiskReturnData(period);

    // Add benchmark scatter points if requested
    if (benchmarkIds.length > 0) {
      data.benchmarks = buildBenchmarkReturnData(benchmarkIds, period);
    }

    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to build risk/return data", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// GET /api/analysis/top-bottom?period=1y&count=5&benchmarks=1,3 — return top/bottom performer series
analysisRouter.get("/api/analysis/top-bottom", function (request) {
  try {
    var url = new URL(request.url);
    var period = validatePeriod(url.searchParams.get("period")) || "1y";
    var count = parseInt(url.searchParams.get("count"), 10) || 5;
    if (count < 1) count = 1;
    if (count > 20) count = 20;
    var benchmarkIds = parseBenchmarkIds(url.searchParams.get("benchmarks"));

    var data = buildTopBottomPerformers(period, count);

    // Add benchmark reference series if requested
    if (benchmarkIds.length > 0) {
      var bmData = buildBenchmarkRebasedSeries(benchmarkIds, period);
      data.benchmarkSeries = bmData.benchmarkSeries;
    }

    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to build top/bottom data", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// GET /api/analysis/comparison?periods=3m,6m,1y,3y&benchmarks=1,3 — multi-period comparison table
analysisRouter.get("/api/analysis/comparison", function (request) {
  try {
    var url = new URL(request.url);
    var periodsParam = url.searchParams.get("periods") || "3m,6m,1y,3y";
    var benchmarkIds = parseBenchmarkIds(url.searchParams.get("benchmarks"));

    // Parse and validate period codes (max 4)
    var periodCodes = [];
    var parts = periodsParam.split(",");
    for (var i = 0; i < parts.length && periodCodes.length < 4; i++) {
      var validated = validatePeriod(parts[i].trim());
      if (validated) periodCodes.push(validated);
    }
    if (periodCodes.length === 0) periodCodes = ["3m", "6m", "1y", "3y"];

    var data = buildComparisonTable(periodCodes, benchmarkIds);

    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to build comparison data", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// ─── PDF endpoints ──────────────────────────────────────────────

// GET /api/analysis/pdf/comparison?periods=3m,6m,1y,3y&benchmarks=1,3
analysisRouter.get("/api/analysis/pdf/comparison", async function (request) {
  try {
    var url = new URL(request.url);
    var periodsParam = url.searchParams.get("periods") || "3m,6m,1y,3y";
    var benchmarkIds = parseBenchmarkIds(url.searchParams.get("benchmarks"));

    var periodCodes = [];
    var parts = periodsParam.split(",");
    for (var i = 0; i < parts.length && periodCodes.length < 4; i++) {
      var validated = validatePeriod(parts[i].trim());
      if (validated) periodCodes.push(validated);
    }
    if (periodCodes.length === 0) periodCodes = ["3m", "6m", "1y", "3y"];

    var pdfBytes = await generateComparisonPdf(periodCodes, benchmarkIds);
    return new Response(pdfBytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="analysis-comparison.pdf"',
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to generate comparison PDF", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// GET /api/analysis/pdf/league-table?period=1y&sort=return&dir=desc&limit=all&benchmarks=1,3
analysisRouter.get("/api/analysis/pdf/league-table", async function (request) {
  try {
    var url = new URL(request.url);
    var period = validatePeriod(url.searchParams.get("period")) || "1y";
    var sort = url.searchParams.get("sort") || "return";
    var dir = url.searchParams.get("dir") || "desc";
    var limit = url.searchParams.get("limit") || "all";
    var benchmarkIds = parseBenchmarkIds(url.searchParams.get("benchmarks"));

    var pdfBytes = await generateLeagueTablePdf(period, sort, dir, limit, benchmarkIds);
    return new Response(pdfBytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="analysis-league-table.pdf"',
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to generate league table PDF", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// GET /api/analysis/pdf/risk-return?period=1y&benchmarks=1,3
analysisRouter.get("/api/analysis/pdf/risk-return", async function (request) {
  try {
    var url = new URL(request.url);
    var period = validatePeriod(url.searchParams.get("period")) || "1y";
    var benchmarkIds = parseBenchmarkIds(url.searchParams.get("benchmarks"));

    var pdfBytes = await generateRiskReturnPdf(period, benchmarkIds);
    return new Response(pdfBytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="analysis-risk-return.pdf"',
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to generate risk/return PDF", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// GET /api/analysis/pdf/top-bottom?period=1y&count=5&benchmarks=1,3
analysisRouter.get("/api/analysis/pdf/top-bottom", async function (request) {
  try {
    var url = new URL(request.url);
    var period = validatePeriod(url.searchParams.get("period")) || "1y";
    var count = parseInt(url.searchParams.get("count"), 10) || 5;
    if (count < 1) count = 1;
    if (count > 20) count = 20;
    var benchmarkIds = parseBenchmarkIds(url.searchParams.get("benchmarks"));

    var pdfBytes = await generateTopBottomPdf(period, count, benchmarkIds);
    return new Response(pdfBytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="analysis-top-bottom.pdf"',
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to generate top/bottom PDF", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

/**
 * @description Route handler for analysis API requests.
 * @param {string} method - HTTP method
 * @param {string} path - URL path
 * @param {Request} request - The HTTP request
 * @returns {Promise<Response|null>} Response or null if no match
 */
export async function handleAnalysisRoute(method, path, request) {
  return await analysisRouter.match(method, path, request);
}

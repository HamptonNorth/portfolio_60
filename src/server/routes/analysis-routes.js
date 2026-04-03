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
  resolveInvestmentIds,
  PERIOD_WEEKS,
} from "../services/analysis-service.js";
import {
  generateComparisonPdf,
  generateLeagueTablePdf,
  generateTopBottomPdf,
  generateRiskReturnPdf,
} from "../reports/pdf-analysis.js";
import { getAllUsers } from "../db/users-db.js";
import { getDistinctAccountTypes } from "../db/accounts-db.js";

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
  const ids = [];
  const parts = param.split(",");
  for (let i = 0; i < parts.length && ids.length < 3; i++) {
    const id = parseInt(parts[i], 10);
    if (id > 0) ids.push(id);
  }
  return ids;
}

/**
 * @description Parse and validate the holdings filter query parameter.
 * Accepts "current", "historic", or "all". Defaults to "current".
 * @param {string|null} param - The raw holdings query parameter
 * @returns {string} Validated holdings filter value
 */
function parseHoldingsFilter(param) {
  if (param === "historic" || param === "all") return param;
  return "current";
}

/**
 * @description Parse a comma-separated list of user IDs from the users query parameter.
 * Returns an array of valid positive integers. If empty or missing, returns all user IDs.
 * @param {string|null} param - The raw users query parameter (e.g. "1,2")
 * @returns {Array<number>} Array of user IDs
 */
function parseUserIds(param) {
  const allUsers = getAllUsers();
  const allUserIds = allUsers.map(function (u) { return u.id; });

  if (!param) return allUserIds;

  const ids = [];
  const parts = param.split(",");
  for (let i = 0; i < parts.length; i++) {
    const id = parseInt(parts[i], 10);
    if (id > 0) ids.push(id);
  }

  return ids.length > 0 ? ids : allUserIds;
}

/**
 * @description Parse a comma-separated list of account types from the query parameter.
 * Returns an array of valid lowercase account type strings.
 * @param {string|null} param - The raw query parameter (e.g. "isa,sipp")
 * @returns {Array<string>} Array of account type strings, empty means all types
 */
function parseAccountTypes(param) {
  if (!param) return [];
  const valid = ["trading", "isa", "sipp"];
  const types = [];
  const parts = param.split(",");
  for (let i = 0; i < parts.length; i++) {
    const t = parts[i].trim().toLowerCase();
    if (valid.indexOf(t) >= 0) types.push(t);
  }
  return types;
}

/**
 * @description Resolve investment IDs and user metadata from filter query parameters.
 * Returns the resolved investment IDs (or null for "all") plus data needed for PDF filter text.
 * @param {URL} url - The parsed request URL
 * @returns {Object} Object with investmentIds, holdingsFilter, userIds, allUserIds, userNames, and accountTypes
 */
function resolveFilters(url) {
  const holdingsFilter = parseHoldingsFilter(url.searchParams.get("holdings"));
  const userIds = parseUserIds(url.searchParams.get("users"));
  const accountTypes = parseAccountTypes(url.searchParams.get("accountTypes"));
  const allUsers = getAllUsers();
  const allUserIds = allUsers.map(function (u) { return u.id; });

  const investmentIds = resolveInvestmentIds(holdingsFilter, userIds, accountTypes);

  // Build user names lookup for filter text
  const userNames = [];
  for (let i = 0; i < allUsers.length; i++) {
    for (let j = 0; j < userIds.length; j++) {
      if (allUsers[i].id === userIds[j]) {
        userNames.push(allUsers[i].first_name + " " + allUsers[i].last_name);
        break;
      }
    }
  }

  return {
    investmentIds: investmentIds,
    holdingsFilter: holdingsFilter,
    userIds: userIds,
    allUserIds: allUserIds,
    userNames: userNames,
    accountTypes: accountTypes,
  };
}

/**
 * @description Build a human-readable filter description string for PDF subtitles.
 * @param {Object} filters - The resolved filters from resolveFilters()
 * @returns {string} Filter description (e.g. "Current holdings \u2014 All users")
 */
function buildFilterText(filters) {
  const holdingsLabels = {
    current: "Current holdings",
    historic: "Historic holdings only",
    all: "All investments",
  };

  const holdingsLabel = holdingsLabels[filters.holdingsFilter] || "Current holdings";

  // "All investments" doesn't depend on users
  if (filters.holdingsFilter === "all") {
    return holdingsLabel;
  }

  const userLabel = filters.userIds.length === filters.allUserIds.length
    ? "All users"
    : filters.userNames.join(", ");

  let text = holdingsLabel + " \u2014 " + userLabel;

  // Append account type if filtered
  if (filters.accountTypes && filters.accountTypes.length > 0) {
    const typeLabels = filters.accountTypes.map(function (t) { return t.toUpperCase(); });
    text += " \u2014 " + typeLabels.join(", ");
  }

  return text;
}

// GET /api/analysis/account-types?users=1,2 — return distinct account types for the given users
analysisRouter.get("/api/analysis/account-types", function (request) {
  try {
    const url = new URL(request.url);
    const userIds = parseUserIds(url.searchParams.get("users"));
    const types = getDistinctAccountTypes(userIds);
    return Response.json(types);
  } catch (err) {
    return Response.json([]);
  }
});

// GET /api/analysis/league-table?period=1y — return ranked investments with sparklines
analysisRouter.get("/api/analysis/league-table", function (request) {
  try {
    const url = new URL(request.url);
    const period = validatePeriod(url.searchParams.get("period")) || "1y";
    const filters = resolveFilters(url);
    const data = buildLeagueTable(period, filters.investmentIds);

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
    const url = new URL(request.url);
    const period = validatePeriod(url.searchParams.get("period")) || "1y";
    const benchmarkIds = parseBenchmarkIds(url.searchParams.get("benchmarks"));
    const filters = resolveFilters(url);
    const data = buildRiskReturnData(period, filters.investmentIds);

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
    const url = new URL(request.url);
    let count = parseInt(url.searchParams.get("count"), 10) || 5;
    if (count < 1) count = 1;
    if (count > 20) count = 20;
    const period = validatePeriod(url.searchParams.get("period")) || "1y";
    const benchmarkIds = parseBenchmarkIds(url.searchParams.get("benchmarks"));
    const filters = resolveFilters(url);

    const data = buildTopBottomPerformers(period, count, filters.investmentIds);

    // Add benchmark reference series if requested
    if (benchmarkIds.length > 0) {
      const bmData = buildBenchmarkRebasedSeries(benchmarkIds, period);
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
    const url = new URL(request.url);
    const periodsParam = url.searchParams.get("periods") || "3m,6m,1y,3y";
    const benchmarkIds = parseBenchmarkIds(url.searchParams.get("benchmarks"));

    // Parse and validate period codes (max 4)
    let periodCodes = [];
    const parts = periodsParam.split(",");
    for (let i = 0; i < parts.length && periodCodes.length < 4; i++) {
      const validated = validatePeriod(parts[i].trim());
      if (validated) periodCodes.push(validated);
    }
    if (periodCodes.length === 0) periodCodes = ["3m", "6m", "1y", "3y"];
    const filters = resolveFilters(url);

    const data = buildComparisonTable(periodCodes, benchmarkIds, filters.investmentIds);

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
    const url = new URL(request.url);
    const periodsParam = url.searchParams.get("periods") || "3m,6m,1y,3y";
    const benchmarkIds = parseBenchmarkIds(url.searchParams.get("benchmarks"));

    let periodCodes = [];
    const parts = periodsParam.split(",");
    for (let i = 0; i < parts.length && periodCodes.length < 4; i++) {
      const validated = validatePeriod(parts[i].trim());
      if (validated) periodCodes.push(validated);
    }
    if (periodCodes.length === 0) periodCodes = ["3m", "6m", "1y", "3y"];
    const filters = resolveFilters(url);
    const filterText = buildFilterText(filters);

    const pdfBytes = await generateComparisonPdf(periodCodes, benchmarkIds, filters.investmentIds, filterText);
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
    const url = new URL(request.url);
    const period = validatePeriod(url.searchParams.get("period")) || "1y";
    const sort = url.searchParams.get("sort") || "return";
    const dir = url.searchParams.get("dir") || "desc";
    const limit = url.searchParams.get("limit") || "all";
    const benchmarkIds = parseBenchmarkIds(url.searchParams.get("benchmarks"));
    const filters = resolveFilters(url);
    const filterText = buildFilterText(filters);

    const pdfBytes = await generateLeagueTablePdf(period, sort, dir, limit, benchmarkIds, filters.investmentIds, filterText);
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
    const url = new URL(request.url);
    const period = validatePeriod(url.searchParams.get("period")) || "1y";
    const benchmarkIds = parseBenchmarkIds(url.searchParams.get("benchmarks"));

    const filters = resolveFilters(url);
    const filterText = buildFilterText(filters);

    const pdfBytes = await generateRiskReturnPdf(period, benchmarkIds, filters.investmentIds, filterText);
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
    const url = new URL(request.url);
    const period = validatePeriod(url.searchParams.get("period")) || "1y";
    let count = parseInt(url.searchParams.get("count"), 10) || 5;
    if (count < 1) count = 1;
    if (count > 20) count = 20;
    const benchmarkIds = parseBenchmarkIds(url.searchParams.get("benchmarks"));

    const filters = resolveFilters(url);
    const filterText = buildFilterText(filters);

    const pdfBytes = await generateTopBottomPdf(period, count, benchmarkIds, filters.investmentIds, filterText);
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

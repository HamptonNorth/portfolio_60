import { getAllUsers } from "../db/users-db.js";
import { getPortfolioSummaryAtDate } from "./portfolio-service.js";
import { getGlobalEventsInRange } from "../db/global-events-db.js";
import { getReportParams } from "../db/report-params-db.js";
import { rebaseToZero, generateWeeklyDates, generateFortnightlyDates, formatISODate } from "./price-utils.js";

/**
 * @description Build chart data for a portfolio value chart.
 * Each series represents a user's account(s) valued at regular intervals
 * using getPortfolioSummaryAtDate(). Supports both percentage change (base zero)
 * and absolute GBP value modes.
 *
 * @param {Object} chartDef - Chart definition from user-reports.json
 * @param {string} chartDef.title - Chart title
 * @param {string} [chartDef.subTitle] - Chart subtitle
 * @param {number} [chartDef.monthsToShow=12] - Number of months of data
 * @param {string} [chartDef.showPercentOrValue="percent"] - "percent" or "value"
 * @param {Array<string>} chartDef.params - Array of "USER:account_types" entries
 * @param {boolean} [chartDef.showGlobalEvents] - Whether to include event markers
 * @returns {Object} Chart data with series array and metadata
 */
export function getPortfolioChartData(chartDef) {
  const monthsToShow = parseInt(chartDef.monthsToShow) || 12;
  const valueMode = chartDef.showPercentOrValue === "value" ? "value" : "percent";

  // Calculate date range
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setMonth(startDate.getMonth() - monthsToShow);

  const fromStr = formatISODate(startDate);
  const toStr = formatISODate(endDate);

  // Generate sample dates — weekly for ≤12 months, fortnightly for longer periods
  let sampleDates;
  if (monthsToShow <= 12) {
    sampleDates = generateWeeklyDates(startDate, endDate);
  } else {
    sampleDates = generateFortnightlyDates(startDate, endDate);
  }

  // Resolve params (substitute USER tokens)
  const resolvedParams = resolveParams(chartDef.params || []);

  // Build user lookup map (initials → user object with id)
  const allUsers = getAllUsers();
  const usersByInitials = {};
  for (let u = 0; u < allUsers.length; u++) {
    if (allUsers[u].initials) {
      usersByInitials[allUsers[u].initials.toUpperCase()] = allUsers[u];
    }
  }

  // Build series for each param
  const series = [];
  for (let i = 0; i < resolvedParams.length; i++) {
    const parsed = parsePortfolioParam(resolvedParams[i]);
    if (!parsed) continue;

    const seriesData = buildPortfolioSeries(
      parsed, usersByInitials, sampleDates, valueMode
    );
    if (seriesData) series.push(seriesData);
  }

  // Fetch global events if requested
  const events = [];
  if (chartDef.showGlobalEvents) {
    const rawEvents = getGlobalEventsInRange(fromStr, toStr);
    for (let e = 0; e < rawEvents.length; e++) {
      events.push({
        date: rawEvents[e].event_date,
        description: rawEvents[e].description.substring(0, 15),
      });
    }
  }

  return {
    title: chartDef.title || "Portfolio Value",
    subTitle: chartDef.subTitle || "",
    monthsToShow: monthsToShow,
    sampleDates: sampleDates,
    series: series,
    events: events,
    valueMode: valueMode,
  };
}

/**
 * @description Parse a portfolio chart param string into its components.
 * Handles formats like "BW:ISA", "BW:isa+sipp+trading", "BW+AW:isa+sipp+trading".
 * @param {string} param - The param string
 * @returns {Object|null} Parsed object with userInitials and accountTypes arrays, or null if invalid
 */
export function parsePortfolioParam(param) {
  if (!param || typeof param !== "string") return null;

  const colonIdx = param.indexOf(":");
  if (colonIdx === -1) return null;

  const userPart = param.substring(0, colonIdx).trim();
  const accountPart = param.substring(colonIdx + 1).trim().toLowerCase();

  if (!userPart || !accountPart) return null;

  // Split users by "+"
  const userInitials = userPart.split("+").map(function (s) {
    return s.trim().toUpperCase();
  }).filter(Boolean);

  // Split account types by "+"
  const accountTypes = accountPart.split("+").map(function (s) {
    return s.trim().toLowerCase();
  }).filter(Boolean);

  if (userInitials.length === 0 || accountTypes.length === 0) return null;

  return {
    userInitials: userInitials,
    accountTypes: accountTypes,
  };
}

/**
 * @description Build a series label from user names and account types.
 * @param {Array<string>} userNames - Array of user full names
 * @param {Array<string>} accountTypes - Array of account types
 * @returns {string} Label like "Ben Wilson (ISA)" or "Combined (All accounts)"
 */
export function buildSeriesLabel(userNames, accountTypes) {
  // Determine the name part
  let namePart;
  if (userNames.length === 1) {
    namePart = userNames[0];
  } else {
    namePart = "Combined";
  }

  // Determine the account part
  let accountPart;
  const allTypes = ["isa", "sipp", "trading"];
  const hasAll = allTypes.every(function (t) {
    return accountTypes.indexOf(t) !== -1;
  });

  if (hasAll) {
    accountPart = "All accounts";
  } else {
    const labels = accountTypes.map(function (t) {
      if (t === "isa") return "ISA";
      if (t === "sipp") return "SIPP";
      if (t === "trading") return "Trading";
      return t;
    });
    accountPart = labels.join(" + ");
  }

  return namePart + " (" + accountPart + ")";
}

/**
 * @description Build a single portfolio value series by sampling account values
 * at each date in the sample dates array.
 * @param {Object} parsed - Parsed param with userInitials and accountTypes
 * @param {Object} usersByInitials - Lookup map of uppercase initials → user object
 * @param {Array<string>} sampleDates - ISO dates to sample at
 * @param {string} valueMode - "percent" or "value"
 * @returns {Object|null} Series object with label, type, and values array
 */
function buildPortfolioSeries(parsed, usersByInitials, sampleDates, valueMode) {
  // Resolve user objects
  const resolvedUsers = [];
  const userNames = [];
  for (let u = 0; u < parsed.userInitials.length; u++) {
    const user = usersByInitials[parsed.userInitials[u]];
    if (!user) continue;
    resolvedUsers.push(user);
    userNames.push(user.first_name + " " + user.last_name);
  }

  if (resolvedUsers.length === 0) return null;

  const label = buildSeriesLabel(userNames, parsed.accountTypes);

  // Sample values at each date
  let values = [];
  for (let d = 0; d < sampleDates.length; d++) {
    const date = sampleDates[d];
    let totalValue = 0;
    let hasAnyData = false;

    for (let ui = 0; ui < resolvedUsers.length; ui++) {
      const summary = getPortfolioSummaryAtDate(resolvedUsers[ui].id, date);
      if (!summary) continue;

      // Sum the matching account types
      for (let a = 0; a < summary.accounts.length; a++) {
        const acct = summary.accounts[a];
        if (parsed.accountTypes.indexOf(acct.account_type) === -1) continue;

        hasAnyData = true;
        // Always include investments
        totalValue += acct.investments_total;
        // Include cash only when available (not null)
        if (acct.cash_available !== false && acct.cash_balance !== null) {
          totalValue += acct.cash_balance;
        }
      }
    }

    values.push(hasAnyData ? totalValue : null);
  }

  // For percent mode, rebase to zero
  if (valueMode === "percent") {
    values = rebaseToZero(values);
  }

  return {
    label: label,
    type: "portfolio",
    values: values,
  };
}

/**
 * @description Resolve report params tokens (e.g. USER1 → BW).
 * @param {Array<string>} params - Raw params array
 * @returns {Array<string>} Params with tokens substituted
 */
function resolveParams(params) {
  if (!params || params.length === 0) return [];
  try {
    const tokenMap = getReportParams();
    const tokens = Object.keys(tokenMap);
    return params.map(function (param) {
      let result = param;
      for (let i = 0; i < tokens.length; i++) {
        result = result.split(tokens[i]).join(tokenMap[tokens[i]]);
      }
      return result;
    });
  } catch {
    return params;
  }
}

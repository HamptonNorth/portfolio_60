/**
 * @description Portfolio Detail Valuation report block for Portfolio 60.
 * Renders a detailed holdings view per user account showing each holding's
 * investment name, currency, quantity, average cost price, current price,
 * local currency value, GBP value, and optional percentage change columns
 * comparing current price to historic prices at specified periods.
 *
 * Params format: array of strings, each in the form:
 *   "USER:ACCOUNT_TYPE"                    — no change columns
 *   "USER:ACCOUNT_TYPE:1m,3m,1y,3y"       — with change columns
 *   "USER:isa+sipp+trading:1m,3m,1y,3y"   — combined totals across accounts
 *
 * When account type contains "+", a combined totals row is rendered
 * aggregating Value GBP and value-weighted changes across those accounts.
 *
 * Examples:
 *   ["BW:ISA:1m,3m,1y,3y", "BW:SIPP:1m,3m,1y,3y", "BW:trading",
 *    "BW:isa+sipp+trading:1m,3m,1y,3y"]
 */

/**
 * @description Account type display labels. ISA and SIPP are uppercase
 * (initialisms), Trading is proper case.
 * @type {Object<string, string>}
 */
const DETAIL_ACCOUNT_TYPE_LABELS = {
  isa: "ISA",
  sipp: "SIPP",
  trading: "Trading",
};

/**
 * @description Format a number as whole pounds with thousand separators.
 * No currency symbol — callers add the appropriate symbol.
 * @param {number} value - The value in pounds/dollars/euros
 * @returns {string} Formatted string like "1,235"
 */
function detailFormatNumber(value) {
  if (value === 0) return "0";
  return Math.round(value).toLocaleString("en-GB");
}

/**
 * @description Format a price to a sensible number of decimal places.
 * Prices under 10 get 4 decimal places; 10-100 get 2; 100+ get 0.
 * @param {number} price - The price value
 * @returns {string} Formatted price string
 */
function detailFormatPrice(price) {
  if (price === 0) return "0";
  if (price < 10) return price.toFixed(4);
  if (price < 100) return price.toFixed(2);
  return Math.round(price).toLocaleString("en-GB");
}

/**
 * @description Format a quantity to a sensible number of decimal places.
 * Whole numbers show no decimals; others show up to 4 significant decimals.
 * @param {number} qty - The quantity
 * @returns {string} Formatted quantity string
 */
function detailFormatQuantity(qty) {
  if (qty === 0) return "0";
  if (Number.isInteger(qty)) return qty.toLocaleString("en-GB");
  // Show enough decimals to be meaningful but trim trailing zeros
  const formatted = qty.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  // Add thousand separators to the integer part
  const parts = formatted.split(".");
  parts[0] = Number(parts[0]).toLocaleString("en-GB");
  return parts.join(".");
}

/**
 * @description Format a percentage change with sign and one decimal place.
 * Positive values get a "+" prefix.
 * @param {number} pct - The percentage change
 * @returns {string} Formatted string like "+17.7%" or "-3.6%"
 */
function detailFormatChange(pct) {
  const sign = pct > 0 ? "+" : "";
  return sign + pct.toFixed(1) + "%";
}

/**
 * @description CSS class for a percentage change value — green for positive,
 * red for negative, neutral for zero.
 * @param {number} pct - The percentage change
 * @returns {string} CSS class string
 */
function detailChangeClass(pct) {
  if (pct > 0) return "text-green-700";
  if (pct < 0) return "text-red-600";
  return "text-brand-600";
}

/**
 * @description Parse a single param string into its components.
 * Format: "USER:ACCOUNT_TYPE" or "USER:ACCOUNT_TYPE:period1,period2,..."
 * When account type contains "+", it is a combined totals request.
 * @param {string} param - The param string
 * @returns {Object} Parsed object with user, accountType, periods, isCombined, accountTypes
 */
function parseDetailParam(param) {
  const parts = param.split(":");
  const accountPart = (parts[1] || "").trim().toLowerCase();
  const isCombined = accountPart.indexOf("+") !== -1;

  return {
    user: (parts[0] || "").trim(),
    accountType: accountPart,
    periods: parts[2] ? parts[2].split(",").map(function (s) { return s.trim(); }).filter(Boolean) : [],
    isCombined: isCombined,
    accountTypes: isCombined
      ? accountPart.split("+").map(function (s) { return s.trim(); }).filter(Boolean)
      : [accountPart],
  };
}

/**
 * @description Build the API URL for a portfolio detail request.
 * @param {string} user - User initials
 * @param {string} accountType - Account type
 * @param {string[]} periods - Period codes
 * @returns {string} The API URL
 */
function buildDetailApiUrl(user, accountType, periods) {
  let url = "/api/portfolio/detail?user=" +
    encodeURIComponent(user) +
    "&account=" +
    encodeURIComponent(accountType);
  if (periods.length > 0) {
    url += "&periods=" + encodeURIComponent(periods.join(","));
  }
  return url;
}

/**
 * @description Render a single account's detail table.
 * @param {Object} data - The portfolio detail data from the API
 * @returns {string} HTML string for the account detail section
 */
function renderDetailAccountSection(data) {
  const user = data.user;
  const account = data.account;
  const typeLabel = DETAIL_ACCOUNT_TYPE_LABELS[account.account_type] || account.account_type;
  const periods = data.periods || [];
  const hasPeriods = periods.length > 0;

  // Section heading: "Ben Wilson ISA"
  let html =
    '<h3 class="text-sm font-bold text-brand-800 mt-5 mb-1">' +
    escapeHtml(user.first_name + " " + user.last_name + " " + typeLabel) +
    "</h3>";

  // Table
  html += '<table class="border-collapse mb-2">';
  html += "<thead>";

  // Column headers
  html += '<tr class="bg-brand-100 border-b border-brand-200">';
  html += '<th class="py-1 px-3 text-xs font-semibold text-brand-700 text-left">Investment</th>';
  html += '<th class="py-1 px-3 text-xs font-semibold text-brand-700 text-left">Currency</th>';
  html += '<th class="py-1 px-3 text-xs font-semibold text-brand-700 text-right">Quantity</th>';
  html += '<th class="py-1 px-3 text-xs font-semibold text-brand-700 text-right">Avg Cost Price</th>';
  html += '<th class="py-1 px-3 text-xs font-semibold text-brand-700 text-right">Price</th>';
  html += '<th class="py-1 px-3 text-xs font-semibold text-brand-700 text-right">Value</th>';
  html += '<th class="py-1 px-3 text-xs font-semibold text-brand-700 text-right">Value GBP</th>';

  for (let p = 0; p < periods.length; p++) {
    html +=
      '<th class="py-1 px-3 text-xs font-semibold text-brand-700 text-right">' +
      escapeHtml(periods[p].label) +
      "</th>";
  }
  html += "</tr>";
  html += "</thead><tbody>";

  // Holdings rows
  for (let h = 0; h < data.holdings.length; h++) {
    const holding = data.holdings[h];
    const isGBP = holding.currency_code === "GBP";
    const sym = holding.currency_symbol || "";

    html += '<tr class="border-b border-brand-100">';

    // Investment
    html +=
      '<td class="py-1.5 px-3 text-xs">' +
      escapeHtml(holding.description) +
      "</td>";

    // Currency
    html +=
      '<td class="py-1.5 px-3 text-xs text-brand-600">' +
      escapeHtml(holding.currency_code) +
      "</td>";

    // Quantity
    html +=
      '<td class="py-1.5 px-3 text-xs text-right">' +
      detailFormatQuantity(holding.quantity) +
      "</td>";

    // Avg Cost Price (show currency symbol for non-GBP)
    html +=
      '<td class="py-1.5 px-3 text-xs text-right">' +
      sym +
      detailFormatPrice(holding.average_cost) +
      "</td>";

    // Price (show currency symbol for non-GBP)
    html +=
      '<td class="py-1.5 px-3 text-xs text-right">' +
      sym +
      detailFormatPrice(holding.price) +
      "</td>";

    // Value in local currency (blank for GBP since it duplicates Value GBP)
    if (isGBP) {
      html += '<td class="py-1.5 px-3 text-xs text-right"></td>';
    } else {
      html +=
        '<td class="py-1.5 px-3 text-xs text-right">' +
        sym +
        detailFormatNumber(holding.value_local) +
        "</td>";
    }

    // Value GBP
    html +=
      '<td class="py-1.5 px-3 text-xs text-right font-semibold">' +
      detailFormatNumber(holding.value_gbp) +
      "</td>";

    // Change columns
    for (let c = 0; c < (holding.changes || []).length; c++) {
      const change = holding.changes[c];
      if (change.change_percent !== null) {
        html +=
          '<td class="py-1.5 px-3 text-xs text-right ' +
          detailChangeClass(change.change_percent) +
          '">' +
          detailFormatChange(change.change_percent) +
          "</td>";
      } else {
        html += '<td class="py-1.5 px-3 text-xs text-right text-brand-300">—</td>';
      }
    }

    html += "</tr>";
  }

  // Totals row
  html += '<tr class="bg-brand-100 border-b border-brand-200">';
  html += '<td class="py-1.5 px-3" colspan="5"></td>';
  html +=
    '<td class="py-1.5 px-3 text-xs text-right font-semibold">Total GBP</td>';
  html +=
    '<td class="py-1.5 px-3 text-xs text-right font-semibold">' +
    detailFormatNumber(data.totals.value_gbp) +
    "</td>";

  for (let t = 0; t < (data.totals.changes || []).length; t++) {
    const totalChange = data.totals.changes[t];
    if (totalChange.change_percent !== null) {
      html +=
        '<td class="py-1.5 px-3 text-xs text-right font-semibold ' +
        detailChangeClass(totalChange.change_percent) +
        '">' +
        detailFormatChange(totalChange.change_percent) +
        "</td>";
    } else {
      html += '<td class="py-1.5 px-3 text-xs text-right text-brand-300">—</td>';
    }
  }

  html += "</tr>";
  html += "</tbody></table>";
  return html;
}

/**
 * @description Render a combined totals row aggregating multiple account detail
 * results into a single summary line with Value GBP and value-weighted changes.
 * @param {string} userName - The user's full name for the heading
 * @param {Array<Object>} detailResults - Array of portfolio detail API results
 * @param {Array<Object>} periods - Period definitions (code + label) from the first result
 * @returns {string} HTML string for the combined totals section
 */
function renderDetailCombinedTotals(userName, detailResults, periods) {
  const hasPeriods = periods.length > 0;

  // Aggregate totals across all accounts
  let combinedValueGBP = 0;
  const periodWeightedSums = {};
  const periodWeightedBases = {};

  for (let p = 0; p < periods.length; p++) {
    periodWeightedSums[periods[p].code] = 0;
    periodWeightedBases[periods[p].code] = 0;
  }

  // Build list of account type labels for the heading
  const accountLabels = [];

  for (let d = 0; d < detailResults.length; d++) {
    const data = detailResults[d];
    combinedValueGBP += data.totals.value_gbp;
    const typeLabel = DETAIL_ACCOUNT_TYPE_LABELS[data.account.account_type] || data.account.account_type;
    accountLabels.push(typeLabel);

    // Accumulate weighted changes from individual holdings (not from per-account totals)
    // to get a true value-weighted average across all holdings in all accounts
    for (let h = 0; h < data.holdings.length; h++) {
      const holding = data.holdings[h];
      for (let c = 0; c < (holding.changes || []).length; c++) {
        const change = holding.changes[c];
        if (change.change_percent !== null) {
          periodWeightedSums[change.code] += holding.value_gbp * change.change_percent;
          periodWeightedBases[change.code] += holding.value_gbp;
        }
      }
    }
  }

  // Calculate combined weighted average changes
  const combinedChanges = [];
  for (let i = 0; i < periods.length; i++) {
    const code = periods[i].code;
    const base = periodWeightedBases[code];
    if (base > 0) {
      const weighted = Math.round((periodWeightedSums[code] / base) * 10) / 10;
      combinedChanges.push({ code: code, change_percent: weighted });
    } else {
      combinedChanges.push({ code: code, change_percent: null });
    }
  }

  // Total columns count: Value GBP label + Value GBP value + change columns
  let html = '<div class="mt-4 border-t-2 border-brand-300 pt-3">';
  html +=
    '<h3 class="text-sm font-bold text-brand-800 mb-1">' +
    escapeHtml(userName) +
    " Combined Total (" +
    escapeHtml(accountLabels.join(" + ")) +
    ")</h3>";

  html += '<table class="border-collapse mb-2">';

  // Header row for combined totals
  if (hasPeriods) {
    html += "<thead>";
    html += '<tr class="bg-brand-100 border-b border-brand-200">';
    html += '<th class="py-1 px-3 text-xs font-semibold text-brand-700 text-right">Value GBP</th>';
    for (let j = 0; j < periods.length; j++) {
      html +=
        '<th class="py-1 px-3 text-xs font-semibold text-brand-700 text-right">' +
        escapeHtml(periods[j].label) +
        "</th>";
    }
    html += "</tr>";
    html += "</thead>";
  }

  // Single totals row
  html += "<tbody>";
  html += '<tr class="bg-brand-100 border-b border-brand-200">';
  html +=
    '<td class="py-1.5 px-3 text-xs text-right font-semibold">' +
    detailFormatNumber(combinedValueGBP) +
    "</td>";

  for (let k = 0; k < combinedChanges.length; k++) {
    const cc = combinedChanges[k];
    if (cc.change_percent !== null) {
      html +=
        '<td class="py-1.5 px-3 text-xs text-right font-semibold ' +
        detailChangeClass(cc.change_percent) +
        '">' +
        detailFormatChange(cc.change_percent) +
        "</td>";
    } else {
      html += '<td class="py-1.5 px-3 text-xs text-right text-brand-300">—</td>';
    }
  }

  html += "</tr>";
  html += "</tbody></table></div>";
  return html;
}

/**
 * @description Render the Portfolio Detail Valuation report into a container element.
 * Fetches data from /api/portfolio/detail for each param entry and builds a
 * per-account holdings detail table with optional price change columns.
 * When account type contains "+", renders a combined totals row instead.
 *
 * @param {string} containerId - The ID of the container element to render into
 * @param {Array<string>} [params] - Array of param strings in the format
 *   "USER:ACCOUNT_TYPE" or "USER:ACCOUNT_TYPE:period1,period2,..."
 *   or "USER:isa+sipp+trading:period1,period2,..." for combined totals
 */
async function renderPortfolioDetailValuation(containerId, params) {
  const container = document.getElementById(containerId);

  if (!params || params.length === 0) {
    container.innerHTML =
      '<h2 class="text-lg font-semibold text-brand-800 mb-4">Portfolio Detail Valuation</h2>' +
      '<p class="text-sm text-brand-500">No account parameters provided.</p>';
    return;
  }

  let html =
    '<h2 class="text-lg font-semibold text-brand-800 mb-4">Portfolio Detail Valuation</h2>';

  for (let i = 0; i < params.length; i++) {
    const parsed = parseDetailParam(params[i]);

    if (!parsed.user || !parsed.accountType) {
      html +=
        '<p class="text-error text-sm py-2">Invalid param: ' +
        escapeHtml(params[i]) +
        "</p>";
      continue;
    }

    if (parsed.isCombined) {
      // Combined totals: fetch each account type and aggregate
      const combinedResults = [];
      let combinedPeriods = [];
      let combinedUserName = "";

      for (let a = 0; a < parsed.accountTypes.length; a++) {
        const url = buildDetailApiUrl(parsed.user, parsed.accountTypes[a], parsed.periods);
        const result = await apiRequest(url);

        if (result.ok && result.data && result.data.holdings && result.data.holdings.length > 0) {
          combinedResults.push(result.data);
          if (combinedPeriods.length === 0 && result.data.periods) {
            combinedPeriods = result.data.periods;
          }
          if (!combinedUserName) {
            combinedUserName = result.data.user.first_name + " " + result.data.user.last_name;
          }
        }
      }

      if (combinedResults.length > 0) {
        html += renderDetailCombinedTotals(combinedUserName, combinedResults, combinedPeriods);
      }
    } else {
      // Single account detail table
      const url = buildDetailApiUrl(parsed.user, parsed.accountType, parsed.periods);
      const result = await apiRequest(url);

      if (!result.ok) {
        html +=
          '<div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3 mb-4">' +
          '<p class="text-sm font-semibold">Failed to load detail for ' +
          escapeHtml(parsed.user + ":" + parsed.accountType) +
          "</p>" +
          '<p class="text-xs mt-1">' +
          escapeHtml(result.detail || result.error || "Unknown error") +
          "</p></div>";
        continue;
      }

      const data = result.data;

      if (!data.holdings || data.holdings.length === 0) {
        html +=
          '<h3 class="text-sm font-bold text-brand-800 mt-5 mb-1">' +
          escapeHtml(data.user.first_name + " " + data.user.last_name + " " +
            (DETAIL_ACCOUNT_TYPE_LABELS[data.account.account_type] || data.account.account_type)) +
          "</h3>" +
          '<p class="text-sm text-brand-500">No holdings in this account.</p>';
        continue;
      }

      html += renderDetailAccountSection(data);
    }
  }

  // Date footer (suppressed when running inside a composite report)
  if (!window._compositeReport) {
    html +=
      '<p class="mt-8 font-light text-xs text-brand-600">' +
      detailTodayFormatted() +
      "</p>";
  }

  container.innerHTML = html;
}

/**
 * @description Get today's date formatted as DD/MM/YYYY.
 * @returns {string} Formatted date string
 */
function detailTodayFormatted() {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return day + "/" + month + "/" + year;
}

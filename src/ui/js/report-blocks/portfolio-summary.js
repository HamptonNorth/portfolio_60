/**
 * @description Portfolio Summary report block for Portfolio 60.
 * Renders a summary valuation per user showing each account's
 * investments total, cash balance, and account total, with per-user
 * subtotals and an overall combined totals section broken down by
 * account type.
 *
 * Accepts an optional params array of user initials entries:
 *   - "AW"        → render Alexis Wilson's section
 *   - "BW"        → render Ben Wilson's section
 *   - "AW + BW"   → render a combined totals section for both users
 *
 * When params is empty or not provided, all users with accounts are shown
 * (original behaviour).
 */

/**
 * @description Format a decimal GBP value as a whole-pound string
 * with thousand separators and £ prefix.
 * @param {number} value - Decimal GBP value (e.g. 1234.56)
 * @returns {string} Formatted string like "£1,235"
 */
function portfolioFormatGBP(value) {
  if (value === 0) return "£0";
  return "£" + Math.round(value).toLocaleString("en-GB");
}

/**
 * @description Get today's date formatted as DD/MM/YYYY.
 * @returns {string} Formatted date string
 */
function portfolioTodayFormatted() {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return day + "/" + month + "/" + year;
}

/**
 * @description Display label for account types. ISA and SIPP are uppercase
 * (they are initialisms), Trading is proper case.
 * @type {Object<string, string>}
 */
const ACCOUNT_TYPE_LABELS = {
  isa: "ISA",
  sipp: "SIPP",
  trading: "Trading",
};

/**
 * @description Build the section header row used above each user's accounts
 * and the combined totals section.
 * @returns {string} HTML string for the header row
 */
function portfolioSectionHeader() {
  return (
    '<tr class="bg-brand-100 border-b border-brand-200">' +
    '<th class="py-1 px-12 text-xs font-semibold text-brand-700 text-left">Account</th>' +
    '<th class="py-1 px-12 text-xs font-semibold text-brand-700 text-left">Reference</th>' +
    '<th class="py-1 px-12 text-xs font-semibold text-brand-700 text-right">Investments</th>' +
    '<th class="py-1 px-12 text-xs font-semibold text-brand-700 text-right">Cash</th>' +
    '<th class="py-1 px-12 text-xs font-semibold text-brand-700 text-right">Total</th>' +
    "</tr>"
  );
}

/**
 * @description Render a single user's account section (heading, accounts table,
 * per-user total row).
 * @param {Object} summary - A user's portfolio summary from the API
 * @returns {string} HTML string for the user section
 */
function renderUserSection(summary) {
  var user = summary.user;
  var html =
    '<h3 class="text-sm font-bold text-brand-800 mt-5 mb-1">' +
    escapeHtml(user.first_name + " " + user.last_name) +
    "</h3>";

  html += '<table class="border-collapse mb-2">';
  html += "<thead>" + portfolioSectionHeader() + "</thead>";
  html += "<tbody>";

  for (var a = 0; a < summary.accounts.length; a++) {
    var account = summary.accounts[a];
    var typeLabel =
      ACCOUNT_TYPE_LABELS[account.account_type] || account.account_type;
    var cashSuffix = account.cash_warning ? " *" : "";

    html += '<tr class="border-b border-brand-100">';
    html +=
      '<td class="py-1.5 px-12 text-xs font-semibold text-brand-700">' +
      typeLabel +
      "</td>";
    html +=
      '<td class="py-1.5 px-12 text-xs font-light text-brand-500">' +
      escapeHtml(account.account_ref) +
      "</td>";
    html +=
      '<td class="py-1.5 px-12 text-xs text-right">' +
      portfolioFormatGBP(account.investments_total) +
      "</td>";
    html +=
      '<td class="py-1.5 px-12 text-xs text-right">' +
      portfolioFormatGBP(account.cash_balance) +
      cashSuffix +
      "</td>";
    html +=
      '<td class="py-1.5 px-12 text-xs text-right font-semibold">' +
      portfolioFormatGBP(account.account_total) +
      "</td>";
    html += "</tr>";
  }

  // Per-user total row
  html += '<tr class="bg-brand-100 border-b border-brand-200">';
  html += '<td class="py-1.5 px-12" colspan="2"></td>';
  html +=
    '<td class="py-1.5 px-12 text-xs text-right font-semibold">' +
    portfolioFormatGBP(summary.totals.investments) +
    "</td>";
  html +=
    '<td class="py-1.5 px-12 text-xs text-right font-semibold">' +
    portfolioFormatGBP(summary.totals.cash) +
    "</td>";
  html +=
    '<td class="py-1.5 px-12 text-xs text-right font-semibold">' +
    portfolioFormatGBP(summary.totals.grand_total) +
    "</td>";
  html += "</tr>";

  html += "</tbody></table>";
  return html;
}

/**
 * @description Render a combined totals section aggregating multiple users'
 * accounts by account type (ISA, SIPP, Trading) with a grand total row.
 * @param {Array<Object>} userSummaries - Array of user portfolio summaries
 * @returns {string} HTML string for the combined totals section
 */
function renderCombinedSection(userSummaries) {
  // Aggregate by account type across the provided users
  var byType = {};
  var totalInvestments = 0;
  var totalCash = 0;
  var totalGrand = 0;

  for (var u = 0; u < userSummaries.length; u++) {
    var summary = userSummaries[u];
    for (var a = 0; a < summary.accounts.length; a++) {
      var account = summary.accounts[a];
      if (!byType[account.account_type]) {
        byType[account.account_type] = { investments: 0, cash: 0, total: 0 };
      }
      byType[account.account_type].investments += account.investments_total;
      byType[account.account_type].cash += account.cash_balance;
      byType[account.account_type].total += account.account_total;
    }
    totalInvestments += summary.totals.investments;
    totalCash += summary.totals.cash;
    totalGrand += summary.totals.grand_total;
  }

  var html = '<div class="mt-6 border-t-2 border-brand-300 pt-3">';
  html +=
    '<h3 class="text-sm font-bold text-brand-800 mb-1">Combined Totals</h3>';

  html += '<table class="border-collapse mb-2">';
  html += "<thead>" + portfolioSectionHeader() + "</thead>";
  html += "<tbody>";

  var typeOrder = ["isa", "sipp", "trading"];
  for (var t = 0; t < typeOrder.length; t++) {
    var type = typeOrder[t];
    var totals = byType[type];
    if (!totals) continue;

    html += '<tr class="border-b border-brand-100">';
    html +=
      '<td class="py-1.5 px-12 text-xs font-semibold text-brand-700">' +
      (ACCOUNT_TYPE_LABELS[type] || type) +
      "</td>";
    html += '<td class="py-1.5 px-12"></td>';
    html +=
      '<td class="py-1.5 px-12 text-xs text-right">' +
      portfolioFormatGBP(totals.investments) +
      "</td>";
    html +=
      '<td class="py-1.5 px-12 text-xs text-right">' +
      portfolioFormatGBP(totals.cash) +
      "</td>";
    html +=
      '<td class="py-1.5 px-12 text-xs text-right font-semibold">' +
      portfolioFormatGBP(totals.total) +
      "</td>";
    html += "</tr>";
  }

  // Grand total row
  html += '<tr class="bg-brand-100 border-b border-brand-200">';
  html += '<td class="py-1.5 px-12" colspan="2"></td>';
  html +=
    '<td class="py-1.5 px-12 text-xs text-right font-semibold">' +
    portfolioFormatGBP(totalInvestments) +
    "</td>";
  html +=
    '<td class="py-1.5 px-12 text-xs text-right font-semibold">' +
    portfolioFormatGBP(totalCash) +
    "</td>";
  html +=
    '<td class="py-1.5 px-12 text-xs text-right font-semibold">' +
    portfolioFormatGBP(totalGrand) +
    "</td>";
  html += "</tr>";

  html += "</tbody></table>";
  html += "</div>";
  return html;
}

/**
 * @description Build a lookup map of user initials to their portfolio summary.
 * Uses the initials field from the users table for reliable matching.
 * @param {Array<Object>} summaries - All user summaries from the API
 * @returns {Object} Map of initials (uppercase) to summary object
 */
function buildInitialsMap(summaries) {
  var map = {};
  for (var i = 0; i < summaries.length; i++) {
    var s = summaries[i];
    if (s.accounts && s.accounts.length > 0 && s.user.initials) {
      map[s.user.initials.toUpperCase()] = s;
    }
  }
  return map;
}

/**
 * @description Render the Portfolio Summary report into a container element.
 * Fetches data from /api/portfolio/summary and builds a per-user valuation table.
 *
 * When params is provided and non-empty, each entry controls what is rendered:
 *   - A single initials string (e.g. "AW") renders that user's section
 *   - A combined string (e.g. "AW + BW") renders a combined totals section
 *     aggregating those users
 *
 * When params is empty or not provided, all users with accounts are shown
 * with combined totals if there are two or more users (original behaviour).
 *
 * @param {string} containerId - The ID of the container element to render into
 * @param {Array<string>} [params] - Optional array of initials entries
 */
async function renderPortfolioSummary(containerId, params) {
  const container = document.getElementById(containerId);

  const result = await apiRequest("/api/portfolio/summary");

  if (!result.ok) {
    container.innerHTML =
      '<div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3">' +
      '<p class="text-sm font-semibold">Failed to load portfolio summary</p>' +
      '<p class="text-xs mt-1">' +
      escapeHtml(result.detail || result.error) +
      "</p></div>";
    return;
  }

  var summaries = result.data;

  // Filter to users that have at least one account
  var activeUsers = summaries.filter(function (s) {
    return s.accounts && s.accounts.length > 0;
  });

  if (activeUsers.length === 0) {
    container.innerHTML =
      '<h2 class="text-lg font-semibold text-brand-800 mb-4">Portfolio Summary Valuation</h2>' +
      '<p class="text-sm text-brand-500">No users with accounts found.</p>';
    return;
  }

  var html =
    '<h2 class="text-lg font-semibold text-brand-800 mb-4">Portfolio Summary Valuation</h2>';

  // If no params provided, use original behaviour: show all users + combined
  if (!params || params.length === 0) {
    for (var u = 0; u < activeUsers.length; u++) {
      html += renderUserSection(activeUsers[u]);
    }
    if (activeUsers.length > 1) {
      html += renderCombinedSection(activeUsers);
    }
  } else {
    // Params-driven rendering: each entry is a section to render
    var initialsMap = buildInitialsMap(summaries);

    for (var p = 0; p < params.length; p++) {
      var entry = params[p].trim();

      if (entry.indexOf("+") !== -1) {
        // Combined section: "AW + BW" → aggregate those users
        var parts = entry.split("+");
        var combinedUsers = [];
        for (var c = 0; c < parts.length; c++) {
          var key = parts[c].trim().toUpperCase();
          if (initialsMap[key]) {
            combinedUsers.push(initialsMap[key]);
          }
        }
        if (combinedUsers.length > 0) {
          html += renderCombinedSection(combinedUsers);
        }
      } else {
        // Single user section
        var userKey = entry.toUpperCase();
        if (initialsMap[userKey]) {
          html += renderUserSection(initialsMap[userKey]);
        }
      }
    }
  }

  // Date footer (suppressed when running inside a composite report)
  if (!window._compositeReport) {
    html +=
      '<p class="mt-8 font-light text-xs text-brand-600">' +
      portfolioTodayFormatted() +
      "</p>";
  }

  container.innerHTML = html;
}

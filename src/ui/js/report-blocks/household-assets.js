/**
 * @description Household Assets report block for Portfolio 60.
 * Renders a spreadsheet-style view of non-portfolio assets
 * (pensions, property, savings, alternative assets) grouped by category,
 * with summary totals for recurring income (annualised) and asset values.
 */

/**
 * @description Frequency display labels for the report.
 * @type {Object<string, string>}
 */
const REPORT_FREQUENCY_LABELS = {
  weekly: "Weekly",
  fortnightly: "Fortnightly",
  "4_weeks": "4 Weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  "6_monthly": "6 Monthly",
  annually: "Annually",
};

/**
 * @description Format a scaled integer (x 10000) as a number string
 * rounded to whole pounds with thousand separators. No currency symbol.
 * @param {number} scaledValue - The value x 10000
 * @returns {string} Formatted string like "1,234"
 */
function reportFormatGBP(scaledValue) {
  const amount = scaledValue / 10000;
  if (amount === 0) return "0";
  return Math.round(amount).toLocaleString("en-GB");
}

/**
 * @description Format an ISO-8601 date string (YYYY-MM-DD) for the report.
 * Returns DD/MM/YYYY format to match the spreadsheet style.
 * @param {string} dateStr - ISO-8601 date string
 * @returns {string} Formatted date string
 */
function reportFormatDate(dateStr) {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  return parts[2] + "/" + parts[1] + "/" + parts[0];
}

/**
 * @description Get the display name for a user in the report.
 * Shows "Joint" for the Joint user, initials for everyone else.
 * @param {Object} item - The asset item with user_first_name and user_initials
 * @returns {string} Display name
 */
function reportGetUserDisplay(item) {
  if (item.user_first_name === "Joint") {
    return "Joint";
  }
  return item.user_initials || "";
}

/**
 * @description Get today's date formatted as DD/MM/YYYY.
 * @returns {string} Formatted date string
 */
function reportTodayFormatted() {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return day + "/" + month + "/" + year;
}

/**
 * @description Render the Household Assets report into a container element.
 * Fetches data from /api/other-assets/summary and builds a grouped table.
 * @param {string} containerId - The ID of the container element to render into
 * @param {Array} [params] - Reserved for future filtering (currently unused)
 */
async function renderHouseholdAssets(containerId, params) {
  const container = document.getElementById(containerId);

  const result = await apiRequest("/api/other-assets/summary");

  if (!result.ok) {
    container.innerHTML =
      '<div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3">' +
      '<p class="text-sm font-semibold">Failed to load household assets</p>' +
      '<p class="text-xs mt-1">' +
      escapeHtml(result.detail || result.error) +
      "</p></div>";
    return;
  }

  const data = result.data;
  const categoryOrder = ["pension", "property", "savings", "alternative"];

  // Filter to only categories that have items
  const activeCats = categoryOrder.filter(function (key) {
    const cat = data.categories[key];
    return cat && cat.items.length > 0;
  });

  let html =
    '<h2 class="text-lg font-semibold text-brand-800 mb-4">Household Assets</h2>';

  // Column widths shared across all category tables for vertical alignment
  const colUser = "w-16";
  const colDesc = "w-48";
  const colValue = "w-24";
  const colEvery = "w-24";
  const colEdited = "w-24";
  const colNotes = "";

  for (const catKey of activeCats) {
    const cat = data.categories[catKey];

    // Category title
    html +=
      '<h3 class="text-sm font-bold text-brand-800 mt-4 mb-1">' +
      escapeHtml(cat.label) +
      "</h3>";

    // Table with fixed layout for consistent column widths
    html += '<table class="w-full text-left border-collapse table-fixed mb-2">';
    html += "<thead>";
    html += '<tr class="bg-brand-100 border-b border-brand-200">';
    html +=
      '<th class="py-1 px-2 text-xs font-semibold text-brand-700 ' +
      colUser +
      '">User</th>';
    html +=
      '<th class="py-1 px-2 text-xs font-semibold text-brand-700 ' +
      colDesc +
      '">Description</th>';
    html +=
      '<th class="py-1 px-2 text-xs font-semibold text-brand-700 text-right ' +
      colValue +
      '">Value</th>';
    html +=
      '<th class="py-1 px-2 text-xs font-semibold text-brand-700 ' +
      colEvery +
      '">Every</th>';
    html +=
      '<th class="py-1 px-2 text-xs font-semibold text-brand-700 ' +
      colEdited +
      '">Edited</th>';
    html +=
      '<th class="py-1 px-2 text-xs font-semibold text-brand-700 ' +
      colNotes +
      '">Notes</th>';
    html += "</tr></thead><tbody>";

    for (let i = 0; i < cat.items.length; i++) {
      const item = cat.items[i];
      html += '<tr class="border-b border-brand-100">';
      html +=
        '<td class="py-1 px-2 text-xs ' +
        colUser +
        '">' +
        escapeHtml(reportGetUserDisplay(item)) +
        "</td>";
      html +=
        '<td class="py-1 px-2 text-xs ' +
        colDesc +
        '">' +
        escapeHtml(item.description) +
        "</td>";
      html +=
        '<td class="py-1 px-2 text-xs text-right ' +
        colValue +
        '">' +
        reportFormatGBP(item.value) +
        "</td>";
      html +=
        '<td class="py-1 px-2 text-xs font-light ' +
        colEvery +
        '">' +
        (item.frequency
          ? REPORT_FREQUENCY_LABELS[item.frequency] || item.frequency
          : "") +
        "</td>";
      html +=
        '<td class="py-1 px-2 text-xs font-light ' +
        colEdited +
        '">' +
        reportFormatDate(item.last_updated) +
        "</td>";

      // Notes with executor reference tooltip
      html += '<td class="py-1 px-2 text-xs font-light ' + colNotes + '">';
      if (item.notes) {
        html += escapeHtml(item.notes);
      }
      if (item.executor_reference) {
        html += ' <span class="relative group inline-block">';
        html +=
          '<span class="text-brand-400 cursor-help text-xs align-super" title="' +
          escapeHtml(item.executor_reference) +
          '">&#9432;</span>';
        html +=
          '<span class="hidden group-hover:block absolute bottom-full left-0 mb-1 bg-brand-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-10">' +
          escapeHtml(item.executor_reference) +
          "</span>";
        html += "</span>";
      }
      html += "</td>";

      html += "</tr>";
    }

    html += "</tbody></table>";
  }

  // Summary section
  html += '<div class="mt-6 border-t-2 border-brand-300 pt-3">';
  html += '<h3 class="text-sm font-bold text-brand-800 mb-2">Summary</h3>';
  html += '<table class="text-left">';

  html += "<tr>";
  html += '<td class="py-0.5 pr-6 text-sm">Recurring</td>';
  html +=
    '<td class="py-0.5 pl-12 pr-4 text-sm text-right font-semibold">' +
    reportFormatGBP(data.totals.recurring_annual) +
    "</td>";
  html += '<td class="py-0.5 font-light text-xs text-brand-600">Annually</td>';
  html += "</tr>";

  html += "<tr>";
  html += '<td class="py-0.5 pr-6 text-sm">Assets </td>';
  html +=
    '<td class="py-0.5 pl-12 pr-4 text-sm text-right font-semibold">' +
    reportFormatGBP(data.totals.value_total) +
    "</td>";
  html += '<td class="py-0.5 text-sm"></td>';
  html += "</tr>";

  html += "</table></div>";

  // Date footer (suppressed when running inside a composite report)
  if (!window._compositeReport) {
    html += '<div class="mt-6 border-t-2 border-brand-300 pt-1">';
    html +=
      '<p class="mt-8 font-light text-xs text-brand-600">' +
      reportTodayFormatted() +
      "</p>";
  }

  container.innerHTML = html;
}

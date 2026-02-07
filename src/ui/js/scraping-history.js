/**
 * @description Scraping History page logic for Portfolio 60.
 * Displays a filterable, paginated history of all scraping attempts.
 */

/** @type {number} Number of records to show per page */
const PAGE_SIZE = 50;

/** @type {number} Current page offset (0-based) */
let currentOffset = 0;

/** @type {number} Total count of records matching current filters */
let totalCount = 0;

/**
 * @description Format a scrape type for display.
 * @param {string} scrapeType - 'currency', 'investment', or 'benchmark'
 * @returns {string} Capitalised display string
 */
function formatScrapeType(scrapeType) {
  if (!scrapeType) return "—";
  return scrapeType.charAt(0).toUpperCase() + scrapeType.slice(1);
}

/**
 * @description Format a datetime string for display.
 * @param {string} datetime - ISO-8601 datetime string (YYYY-MM-DDTHH:MM:SS)
 * @returns {string} Formatted datetime (e.g. "5 Feb 2026 14:32")
 */
function formatDatetime(datetime) {
  if (!datetime) return "—";

  const parts = datetime.split("T");
  if (parts.length !== 2) return datetime;

  const dateParts = parts[0].split("-");
  if (dateParts.length !== 3) return datetime;

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const year = dateParts[0];
  const monthIndex = parseInt(dateParts[1], 10) - 1;
  const day = parseInt(dateParts[2], 10);

  if (monthIndex < 0 || monthIndex > 11) return datetime;

  const timeParts = parts[1].split(":");
  const time = timeParts.slice(0, 2).join(":");

  return day + " " + months[monthIndex] + " " + year + " " + time;
}

/**
 * @description Format the started_by value for display.
 * @param {number} startedBy - 0 = manual, 1 = scheduled
 * @returns {string} Display string
 */
function formatStartedBy(startedBy) {
  return startedBy === 1 ? "Scheduled" : "Manual";
}

/**
 * @description Get current filter values from the form.
 * @returns {Object} Filter object with scrapeType, success, startDate, endDate
 */
function getFilters() {
  const filters = {};

  const scrapeType = document.getElementById("filter-type").value;
  if (scrapeType) {
    filters.scrapeType = scrapeType;
  }

  const success = document.getElementById("filter-success").value;
  if (success !== "") {
    filters.success = success;
  }

  const startDate = document.getElementById("filter-start-date").value;
  if (startDate) {
    filters.startDate = startDate;
  }

  const endDate = document.getElementById("filter-end-date").value;
  if (endDate) {
    filters.endDate = endDate;
  }

  return filters;
}

/**
 * @description Build query string from filters and pagination.
 * @param {Object} filters - Filter values
 * @param {number} offset - Pagination offset
 * @returns {string} Query string (without leading ?)
 */
function buildQueryString(filters, offset) {
  const params = new URLSearchParams();

  if (filters.scrapeType) {
    params.set("scrapeType", filters.scrapeType);
  }
  if (filters.success !== undefined) {
    params.set("success", filters.success);
  }
  if (filters.startDate) {
    params.set("startDate", filters.startDate);
  }
  if (filters.endDate) {
    params.set("endDate", filters.endDate);
  }

  params.set("limit", PAGE_SIZE.toString());
  params.set("offset", offset.toString());

  return params.toString();
}

/**
 * @description Load and display scraping history with current filters and pagination.
 */
async function loadHistory() {
  const container = document.getElementById("history-table-container");
  const paginationContainer = document.getElementById("pagination-container");

  container.innerHTML = '<p class="text-brand-500">Loading fetching history...</p>';
  paginationContainer.classList.add("hidden");

  const filters = getFilters();
  const queryString = buildQueryString(filters, currentOffset);

  const result = await apiRequest("/api/scraper/history?" + queryString);

  if (!result.ok) {
    container.innerHTML = '<div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3">' + '<p class="text-base font-semibold">Failed to load fetching history</p>' + '<p class="text-sm mt-1">' + escapeHtml(result.detail || result.error) + "</p></div>";
    return;
  }

  const data = result.data;
  totalCount = data.totalCount;

  if (data.history.length === 0) {
    container.innerHTML = '<p class="text-brand-500">No fetching history found matching the filters.</p>';
    paginationContainer.classList.add("hidden");
    return;
  }

  // Build table
  let html = '<div class="overflow-x-auto">';
  html += '<table class="w-full text-left border-collapse">';
  html += "<thead>";
  html += '<tr class="border-b-2 border-brand-200">';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Date/Time</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Type</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Item</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Status</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Started By</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Attempt</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Error</th>';
  html += "</tr>";
  html += "</thead>";
  html += "<tbody>";

  for (let i = 0; i < data.history.length; i++) {
    const h = data.history[i];
    const rowClass = i % 2 === 0 ? "bg-white" : "bg-brand-50";

    html += '<tr class="' + rowClass + ' border-b border-brand-100">';
    html += '<td class="py-3 px-3 text-base">' + escapeHtml(formatDatetime(h.scrape_datetime)) + "</td>";
    html += '<td class="py-3 px-3 text-base">' + escapeHtml(formatScrapeType(h.scrape_type)) + "</td>";
    html += '<td class="py-3 px-3 text-base">' + escapeHtml(h.reference_description || "—") + "</td>";

    if (h.success) {
      html += '<td class="py-3 px-3 text-sm text-success font-medium">Success</td>';
    } else {
      html += '<td class="py-3 px-3 text-sm text-error font-medium">Failed</td>';
    }

    html += '<td class="py-3 px-3 text-base">' + escapeHtml(formatStartedBy(h.started_by)) + "</td>";
    html += '<td class="py-3 px-3 text-base text-center">' + h.attempt_number + "</td>";

    if (h.error_message) {
      html += '<td class="py-3 px-3 text-sm text-brand-500" title="' + escapeHtml(h.error_message) + '">';
      html += escapeHtml(h.error_code || "Error");
      html += "</td>";
    } else {
      html += '<td class="py-3 px-3 text-sm text-brand-400">—</td>';
    }

    html += "</tr>";
  }

  html += "</tbody></table></div>";
  container.innerHTML = html;

  // Update pagination
  updatePagination();
}

/**
 * @description Update pagination controls based on current state.
 */
function updatePagination() {
  const paginationContainer = document.getElementById("pagination-container");
  const paginationInfo = document.getElementById("pagination-info");
  const prevBtn = document.getElementById("prev-page-btn");
  const nextBtn = document.getElementById("next-page-btn");

  if (totalCount === 0) {
    paginationContainer.classList.add("hidden");
    return;
  }

  paginationContainer.classList.remove("hidden");

  const startRecord = currentOffset + 1;
  const endRecord = Math.min(currentOffset + PAGE_SIZE, totalCount);
  paginationInfo.textContent = "Showing " + startRecord + "–" + endRecord + " of " + totalCount + " records";

  prevBtn.disabled = currentOffset === 0;
  nextBtn.disabled = currentOffset + PAGE_SIZE >= totalCount;
}

/**
 * @description Go to the previous page.
 */
function prevPage() {
  if (currentOffset > 0) {
    currentOffset = Math.max(0, currentOffset - PAGE_SIZE);
    loadHistory();
  }
}

/**
 * @description Go to the next page.
 */
function nextPage() {
  if (currentOffset + PAGE_SIZE < totalCount) {
    currentOffset += PAGE_SIZE;
    loadHistory();
  }
}

/**
 * @description Apply filters and reload from first page.
 */
function applyFilters() {
  currentOffset = 0;
  loadHistory();
}

/**
 * @description Clear all filters and reload.
 */
function clearFilters() {
  document.getElementById("filter-type").value = "";
  document.getElementById("filter-success").value = "";
  document.getElementById("filter-start-date").value = "";
  document.getElementById("filter-end-date").value = "";
  currentOffset = 0;
  loadHistory();
}

// Initialise the page
document.addEventListener("DOMContentLoaded", function () {
  loadHistory();

  document.getElementById("apply-filters-btn").addEventListener("click", applyFilters);
  document.getElementById("clear-filters-btn").addEventListener("click", clearFilters);
  document.getElementById("prev-page-btn").addEventListener("click", prevPage);
  document.getElementById("next-page-btn").addEventListener("click", nextPage);
});

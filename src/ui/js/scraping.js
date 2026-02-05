/**
 * @description Scraping page logic for Portfolio 60.
 * Handles fetching currency exchange rates and displaying results.
 * Price scraping (Phase 8) will be added later.
 */

/**
 * @description Format a scaled integer rate for display as a decimal.
 * Divides by 10000 and shows 4 decimal places.
 * @param {number} scaledRate - The integer rate (e.g. 12543)
 * @returns {string} The formatted decimal rate (e.g. "1.2543")
 */
function formatRate(scaledRate) {
  return (scaledRate / 10000).toFixed(4);
}

/**
 * @description Format an ISO-8601 date string for display in UK format.
 * @param {string} dateStr - ISO-8601 date string (YYYY-MM-DD)
 * @returns {string} Formatted date (e.g. "5 Feb 2026")
 */
function formatDisplayDate(dateStr) {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const year = parts[0];
  const monthIndex = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);

  if (monthIndex < 0 || monthIndex > 11) return dateStr;

  return day + " " + months[monthIndex] + " " + year;
}

/**
 * @description Load and display the latest stored exchange rates.
 */
async function loadLatestRates() {
  const container = document.getElementById("latest-rates-container");

  const result = await apiRequest("/api/scraper/currency-rates/latest");

  if (!result.ok) {
    container.innerHTML =
      '<div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3">' +
      '<p class="text-base font-semibold">Failed to load stored rates</p>' +
      '<p class="text-sm mt-1">' + escapeHtml(result.detail || result.error) + "</p>" +
      "</div>";
    return;
  }

  const rates = result.data;

  if (rates.length === 0) {
    container.innerHTML = '<p class="text-brand-500">No exchange rates stored yet. Click "Fetch Currency Rates" to retrieve them.</p>';
    return;
  }

  let html = '<h4 class="text-base font-semibold text-brand-600 mb-2">Latest Stored Rates</h4>';
  html += '<div class="overflow-x-auto">';
  html += '<table class="w-full max-w-2xl text-left border-collapse">';
  html += "<thead>";
  html += '<tr class="border-b-2 border-brand-200">';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Currency</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Description</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700 text-right">Rate (per 1 GBP)</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Date</th>';
  html += "</tr>";
  html += "</thead>";
  html += "<tbody>";

  for (let i = 0; i < rates.length; i++) {
    const rate = rates[i];
    const rowClass = i % 2 === 0 ? "bg-white" : "bg-brand-50";

    html += '<tr class="' + rowClass + ' border-b border-brand-100">';
    html += '<td class="py-3 px-3 text-base font-semibold">' + escapeHtml(rate.currency_code) + "</td>";
    html += '<td class="py-3 px-3 text-base">' + escapeHtml(rate.currency_description) + "</td>";
    html += '<td class="py-3 px-3 text-base text-right font-mono">' + formatRate(rate.rate) + "</td>";
    html += '<td class="py-3 px-3 text-base">' + escapeHtml(formatDisplayDate(rate.rate_date)) + "</td>";
    html += "</tr>";
  }

  html += "</tbody></table></div>";
  container.innerHTML = html;
}

/**
 * @description Fetch currency rates from the Frankfurter API and display results.
 */
async function fetchCurrencyRates() {
  const statusDiv = document.getElementById("rates-status");
  const resultDiv = document.getElementById("rates-result");
  const fetchBtn = document.getElementById("fetch-rates-btn");

  // Show loading state
  fetchBtn.disabled = true;
  fetchBtn.textContent = "Fetching...";
  statusDiv.innerHTML = '<p class="text-brand-500">Fetching exchange rates from the European Central Bank...</p>';
  statusDiv.classList.remove("hidden");
  resultDiv.classList.add("hidden");

  const result = await apiRequest("/api/scraper/currency-rates", {
    method: "POST",
  });

  // Reset button
  fetchBtn.disabled = false;
  fetchBtn.textContent = "Fetch Currency Rates";
  statusDiv.classList.add("hidden");

  if (!result.ok) {
    resultDiv.innerHTML =
      '<div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3">' +
      '<p class="text-base font-semibold">Failed to fetch rates</p>' +
      '<p class="text-sm mt-1">' + escapeHtml(result.detail || result.error) + "</p>" +
      "</div>";
    resultDiv.classList.remove("hidden");
    return;
  }

  const data = result.data;

  if (data.rates.length === 0) {
    resultDiv.innerHTML =
      '<div class="bg-blue-50 border border-blue-200 text-brand-700 rounded-lg px-4 py-3">' +
      '<p class="text-base">' + escapeHtml(data.message) + "</p>" +
      "</div>";
    resultDiv.classList.remove("hidden");
    return;
  }

  // Show success with fetched rates
  let html = '<div class="bg-green-50 border border-green-300 text-success rounded-lg px-4 py-3 mb-4">';
  html += '<p class="text-base">' + escapeHtml(data.message) + "</p>";
  html += "</div>";

  html += '<h4 class="text-base font-semibold text-brand-600 mb-2">Fetched Rates</h4>';
  html += '<div class="overflow-x-auto">';
  html += '<table class="w-full max-w-2xl text-left border-collapse">';
  html += "<thead>";
  html += '<tr class="border-b-2 border-brand-200">';
  html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">Currency</th>';
  html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">Description</th>';
  html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700 text-right">Rate (per 1 GBP)</th>';
  html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700 text-right">Stored As</th>';
  html += "</tr>";
  html += "</thead>";
  html += "<tbody>";

  for (let i = 0; i < data.rates.length; i++) {
    const rate = data.rates[i];
    const rowClass = i % 2 === 0 ? "bg-white" : "bg-brand-50";

    html += '<tr class="' + rowClass + ' border-b border-brand-100">';
    html += '<td class="py-2 px-3 text-base font-semibold">' + escapeHtml(rate.code) + "</td>";
    html += '<td class="py-2 px-3 text-base">' + escapeHtml(rate.description) + "</td>";
    html += '<td class="py-2 px-3 text-base text-right font-mono">' + rate.rate.toFixed(4) + "</td>";
    html += '<td class="py-2 px-3 text-base text-right font-mono text-brand-400">' + rate.scaledRate + "</td>";
    html += "</tr>";
  }

  html += "</tbody></table></div>";

  resultDiv.innerHTML = html;
  resultDiv.classList.remove("hidden");

  // Refresh the latest stored rates table
  await loadLatestRates();
}

// Initialise the page
document.addEventListener("DOMContentLoaded", async function () {
  await loadLatestRates();

  document.getElementById("fetch-rates-btn").addEventListener("click", fetchCurrencyRates);
});

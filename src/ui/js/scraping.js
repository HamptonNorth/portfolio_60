/**
 * @description Scraping page logic for Portfolio 60.
 * Handles fetching currency exchange rates and investment price scraping.
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
    container.innerHTML = '<div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3">' + '<p class="text-base font-semibold">Failed to load stored rates</p>' + '<p class="text-sm mt-1">' + escapeHtml(result.detail || result.error) + "</p>" + "</div>";
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
    resultDiv.innerHTML = '<div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3">' + '<p class="text-base font-semibold">Failed to fetch rates</p>' + '<p class="text-sm mt-1">' + escapeHtml(result.detail || result.error) + "</p>" + "</div>";
    resultDiv.classList.remove("hidden");
    return;
  }

  const data = result.data;

  if (data.rates.length === 0) {
    resultDiv.innerHTML = '<div class="bg-blue-50 border border-blue-200 text-brand-700 rounded-lg px-4 py-3">' + '<p class="text-base">' + escapeHtml(data.message) + "</p>" + "</div>";
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

// --- Price Scraping ---

/**
 * @description Cached exchange rates (currency code → decimal rate per 1 GBP).
 * Built from the scrapeAllPrices response and used for GBP value calculations.
 * GBP is always set to 1.0.
 * @type {Object}
 */
let cachedExchangeRates = { GBP: 1 };

/**
 * @description Format a minor-unit price value for display as 9(6).9(4).
 * Always shows exactly 4 decimal places for consistency.
 * All values are already normalised to minor units (pence/cents).
 * @param {number} value - The price in minor units
 * @returns {string} Formatted price string
 */
function formatPrice(value) {
  if (value === null || value === undefined) return "—";
  return value.toFixed(4);
}

/**
 * @description Hardcoded holding quantity for testing/verification purposes.
 * In future versions this will come from the portfolio holdings table.
 * @type {number}
 */
const TEST_HOLDING = 1000;

/**
 * @description Calculate the GBP value of a holding given a price in minor units
 * and an exchange rate. For GBP investments, no conversion is needed.
 * For foreign currency investments, divides by the exchange rate (which is
 * expressed as foreign-currency-per-1-GBP).
 *
 * Formula: holding × (priceMinorUnit / 100) / exchangeRate
 * Where exchangeRate = 1.0 for GBP investments.
 *
 * @param {number} holding - Number of units held
 * @param {number} priceMinorUnit - Price in minor units (pence/cents)
 * @param {number} exchangeRate - Exchange rate as decimal (foreign per 1 GBP). 1.0 for GBP.
 * @returns {number|null} Value in GBP, or null if inputs are invalid
 */
function calculateGbpValue(holding, priceMinorUnit, exchangeRate) {
  if (priceMinorUnit === null || priceMinorUnit === undefined) return null;
  if (!exchangeRate || exchangeRate === 0) return null;
  return (holding * priceMinorUnit) / 100 / exchangeRate;
}

/**
 * @description Format a GBP value for display as £1,234,567.89
 * @param {number|null} value - The GBP value
 * @returns {string} Formatted string or em-dash if null
 */
function formatGbpValue(value) {
  if (value === null || value === undefined) return "—";
  return (
    "£" +
    value.toLocaleString("en-GB", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/**
 * @description Build the HTML table showing price scraping results.
 * Each row shows the investment, status, raw text, parsed price, holding, GBP value,
 * and a re-scrape button.
 * @param {Object[]} prices - Array of price result objects from the API
 * @param {Object} exchangeRates - Map of currency code to decimal exchange rate (per 1 GBP).
 *   GBP should map to 1.0.
 * @returns {string} HTML string for the results table
 */
function buildPricesTable(prices, exchangeRates) {
  let html = '<div class="overflow-x-auto">';
  html += '<table class="w-full text-left border-collapse">';
  html += "<thead>";
  html += '<tr class="border-b-2 border-brand-200">';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Investment</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Currency</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Status</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Raw Text</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700 text-right">Parsed Price</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700 text-right">Holding</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700 text-right">Value (GBP)</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700"></th>';
  html += "</tr>";
  html += "</thead>";
  html += "<tbody>";

  for (let i = 0; i < prices.length; i++) {
    const p = prices[i];
    const rowClass = i % 2 === 0 ? "bg-white" : "bg-brand-50";

    html += '<tr class="' + rowClass + ' border-b border-brand-100">';
    html += '<td class="py-3 px-3 text-base">' + escapeHtml(p.description) + "</td>";
    html += '<td class="py-3 px-3 text-base">' + escapeHtml(p.currency) + "</td>";

    if (p.success) {
      html += '<td class="py-3 px-3 text-sm text-success font-medium">OK</td>';
    } else {
      html += '<td class="py-3 px-3 text-sm text-error font-medium">Failed</td>';
    }

    html += '<td class="py-3 px-3 text-sm text-brand-500 font-mono">' + escapeHtml(p.rawPrice || p.error || "—") + "</td>";
    html += '<td class="py-3 px-3 text-base text-right font-mono">' + formatPrice(p.priceMinorUnit) + "</td>";

    // Holding (hardcoded for testing)
    html += '<td class="py-3 px-3 text-base text-right font-mono">' + TEST_HOLDING.toLocaleString("en-GB") + "</td>";

    // Value (GBP) — convert using exchange rate
    const rate = exchangeRates[p.currency] || 1;
    const gbpValue = calculateGbpValue(TEST_HOLDING, p.priceMinorUnit, rate);
    html += '<td class="py-3 px-3 text-base text-right font-mono">' + formatGbpValue(gbpValue) + "</td>";

    html += '<td class="py-3 px-3 text-base">';
    html += '<button class="text-sm text-brand-500 hover:text-brand-700 transition-colors" onclick="rescrapePrice(' + p.investmentId + ', this)">Re-scrape</button>';
    html += "</td>";
    html += "</tr>";
  }

  html += "</tbody></table></div>";
  return html;
}

/**
 * @description Build a spinner SVG element for use in pending table rows.
 * @returns {string} HTML string for a small spinning indicator
 */
function spinnerHtml() {
  return '<svg class="inline-block animate-spin h-4 w-4 text-brand-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">' + '<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>' + '<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>' + "</svg>";
}

/**
 * @description Build a placeholder table row for an investment that is waiting to be scraped.
 * Shows a spinner in the status column.
 * @param {Object} inv - Investment stub from the init event ({investmentId, description, currency})
 * @param {number} rowIndex - Row index for zebra striping
 * @returns {string} HTML string for the pending row
 */
function buildPendingRow(inv, rowIndex) {
  const rowClass = rowIndex % 2 === 0 ? "bg-white" : "bg-brand-50";

  let html = '<tr id="price-row-' + inv.investmentId + '" class="' + rowClass + ' border-b border-brand-100">';
  html += '<td class="py-3 px-3 text-base">' + escapeHtml(inv.description) + "</td>";
  html += '<td class="py-3 px-3 text-base">' + escapeHtml(inv.currency) + "</td>";
  html += '<td class="py-3 px-3 text-sm text-brand-400">' + spinnerHtml() + ' <span class="ml-1">Waiting</span></td>';
  html += '<td class="py-3 px-3 text-sm text-brand-500 font-mono">—</td>';
  html += '<td class="py-3 px-3 text-base text-right font-mono">—</td>';
  html += '<td class="py-3 px-3 text-base text-right font-mono">—</td>';
  html += '<td class="py-3 px-3 text-base text-right font-mono">—</td>';
  html += '<td class="py-3 px-3 text-base"></td>';
  html += "</tr>";
  return html;
}

/**
 * @description Update a table row in-place when a price result arrives from the SSE stream.
 * Replaces the spinner with the actual status, raw text, parsed price, holding and value.
 * @param {Object} price - The price result object from the server
 */
function updatePriceRow(price) {
  const row = document.getElementById("price-row-" + price.investmentId);
  if (!row) return;

  const cells = row.querySelectorAll("td");
  if (cells.length < 8) return;

  // Status cell
  if (price.success) {
    cells[2].innerHTML = '<span class="text-sm text-success font-medium">OK</span>';
  } else {
    cells[2].innerHTML = '<span class="text-sm text-error font-medium">Failed</span>';
  }

  // Raw text cell
  cells[3].textContent = price.rawPrice || price.error || "—";

  // Parsed price cell
  cells[4].textContent = formatPrice(price.priceMinorUnit);

  // Holding cell
  cells[5].textContent = TEST_HOLDING.toLocaleString("en-GB");

  // Value (GBP) cell
  const rate = cachedExchangeRates[price.currency] || 1;
  const gbpValue = calculateGbpValue(TEST_HOLDING, price.priceMinorUnit, rate);
  cells[6].textContent = formatGbpValue(gbpValue);

  // Re-scrape button
  cells[7].innerHTML = '<button class="text-sm text-brand-500 hover:text-brand-700 transition-colors" onclick="rescrapePrice(' + price.investmentId + ', this)">Re-scrape</button>';
}

/**
 * @description Fetch prices for all investments using Server-Sent Events (SSE).
 * Shows a table immediately with spinner rows for each investment, then
 * updates each row in-place as the server streams results back.
 */
function fetchAllPrices() {
  const statusDiv = document.getElementById("prices-status");
  const resultDiv = document.getElementById("prices-result");
  const fetchBtn = document.getElementById("fetch-prices-btn");

  // Show loading state
  fetchBtn.disabled = true;
  fetchBtn.textContent = "Scraping...";
  statusDiv.innerHTML = '<p class="text-brand-500">' + spinnerHtml() + ' <span class="ml-2">Fetching currency rates...</span></p>';
  statusDiv.classList.remove("hidden");
  resultDiv.innerHTML = "";
  resultDiv.classList.add("hidden");

  const source = new EventSource("/api/scraper/prices/stream");

  // Handle the init event — build the table with pending rows
  source.addEventListener("init", function (event) {
    const data = JSON.parse(event.data);

    // Build exchange rates map from the currency rates result
    cachedExchangeRates = { GBP: 1 };
    if (data.currencyRatesResult && data.currencyRatesResult.rates) {
      for (const r of data.currencyRatesResult.rates) {
        cachedExchangeRates[r.code] = r.rate;
      }
    }

    // Update status
    if (data.total === 0) {
      statusDiv.innerHTML = '<p class="text-brand-500">No investments with URL and selector configured.</p>';
      return;
    }

    statusDiv.innerHTML = '<p class="text-brand-500">' + spinnerHtml() + ' <span class="ml-2">Scraping 0 of ' + data.total + " investments...</span></p>";

    // Build and show the table with pending rows
    let html = "";

    // Show currency rates info if any were fetched
    if (data.currencyRatesResult && data.currencyRatesResult.rates && data.currencyRatesResult.rates.length > 0) {
      html += '<p class="text-sm text-brand-500 mb-3">Currency rates updated: ' + data.currencyRatesResult.rates.length + " rate" + (data.currencyRatesResult.rates.length === 1 ? "" : "s") + " fetched.</p>";
    }

    html += '<div id="prices-summary" class="hidden mb-4"></div>';
    html += '<div class="overflow-x-auto">';
    html += '<table class="w-full text-left border-collapse">';
    html += "<thead>";
    html += '<tr class="border-b-2 border-brand-200">';
    html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Investment</th>';
    html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Currency</th>';
    html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Status</th>';
    html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Raw Text</th>';
    html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700 text-right">Parsed Price</th>';
    html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700 text-right">Holding</th>';
    html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700 text-right">Value (GBP)</th>';
    html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700"></th>';
    html += "</tr>";
    html += "</thead>";
    html += '<tbody id="prices-tbody">';

    for (let i = 0; i < data.investments.length; i++) {
      html += buildPendingRow(data.investments[i], i);
    }

    html += "</tbody></table></div>";
    html += '<p id="prices-footer" class="text-sm text-brand-400 mt-2"></p>';

    resultDiv.innerHTML = html;
    resultDiv.classList.remove("hidden");
  });

  // Track progress for the status counter
  let scrapedCount = 0;
  let totalCount = 0;

  // Handle each price result — update the row in-place
  source.addEventListener("price", function (event) {
    const price = JSON.parse(event.data);
    scrapedCount++;
    updatePriceRow(price);

    // Update the status line with progress
    if (totalCount > 0) {
      statusDiv.innerHTML = '<p class="text-brand-500">' + spinnerHtml() + ' <span class="ml-2">Scraping ' + scrapedCount + " of " + totalCount + " investments...</span></p>";
    }
  });

  // Store total from init for progress counter
  source.addEventListener("init", function (event) {
    const data = JSON.parse(event.data);
    totalCount = data.total;
  });

  // Handle completion
  source.addEventListener("done", function (event) {
    const data = JSON.parse(event.data);
    source.close();

    // Reset button
    fetchBtn.disabled = false;
    fetchBtn.textContent = "Fetch All Prices";
    statusDiv.classList.add("hidden");

    // Show summary
    const summaryDiv = document.getElementById("prices-summary");
    if (summaryDiv) {
      let summaryClass = "bg-green-50 border-green-300 text-success";
      if (data.failCount > 0) {
        summaryClass = "bg-amber-50 border-amber-300 text-amber-800";
      }
      summaryDiv.innerHTML = '<div class="border rounded-lg px-4 py-3 ' + summaryClass + '">' + '<p class="text-base">' + escapeHtml(data.message) + "</p></div>";
      summaryDiv.classList.remove("hidden");
    }

    // Show footer with count and timestamp
    const footerEl = document.getElementById("prices-footer");
    if (footerEl) {
      const now = new Date();
      const dateStr = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0") + " " + String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
      footerEl.textContent = data.successCount + " investment" + (data.successCount === 1 ? "" : "s") + " valued " + dateStr;
    }

    // Refresh the currency rates table too (they were fetched as part of price scraping)
    loadLatestRates();
  });

  // Handle errors
  source.addEventListener("error", function (event) {
    // Check if this is a custom error event with data
    if (event.data) {
      const data = JSON.parse(event.data);
      source.close();

      fetchBtn.disabled = false;
      fetchBtn.textContent = "Fetch All Prices";
      statusDiv.classList.add("hidden");

      resultDiv.innerHTML = '<div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3">' + '<p class="text-base font-semibold">Scraping error</p>' + '<p class="text-sm mt-1">' + escapeHtml(data.error) + "</p></div>";
      resultDiv.classList.remove("hidden");
      return;
    }

    // EventSource connection error (e.g. server not reachable)
    source.close();

    fetchBtn.disabled = false;
    fetchBtn.textContent = "Fetch All Prices";
    statusDiv.classList.add("hidden");

    resultDiv.innerHTML = '<div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3">' + '<p class="text-base font-semibold">Connection failed</p>' + '<p class="text-sm mt-1">Could not connect to the scraping service. Please try again.</p></div>';
    resultDiv.classList.remove("hidden");
  });
}

/**
 * @description Re-scrape the price for a single investment.
 * Updates the corresponding row in the results table.
 * @param {number} investmentId - The investment ID to re-scrape
 * @param {HTMLElement} button - The button element that was clicked
 */
async function rescrapePrice(investmentId, button) {
  // Disable the button during scraping
  button.disabled = true;
  button.textContent = "Scraping...";

  const result = await apiRequest("/api/scraper/prices/" + investmentId, {
    method: "POST",
  });

  button.disabled = false;
  button.textContent = "Re-scrape";

  if (!result.ok && !result.data) {
    showError("page-messages", "Failed to re-scrape", result.detail || result.error);
    return;
  }

  // The response may contain a price object even on failure (when investment exists but scrape failed)
  const data = result.data || result;
  const price = data.price;

  if (!price) {
    showError("page-messages", "Failed to re-scrape", data.detail || data.error || "Unknown error");
    return;
  }

  // Update the row in the existing table
  const row = button.closest("tr");
  if (row) {
    const cells = row.querySelectorAll("td");
    if (cells.length >= 7) {
      // Status cell
      if (price.success) {
        cells[2].innerHTML = '<span class="text-sm text-success font-medium">OK</span>';
      } else {
        cells[2].innerHTML = '<span class="text-sm text-error font-medium">Failed</span>';
      }
      // Raw text cell
      cells[3].textContent = price.rawPrice || price.error || "—";
      // Parsed price cell (minor units)
      cells[4].textContent = formatPrice(price.priceMinorUnit);
      // Holding cell (unchanged but ensure consistent)
      cells[5].textContent = TEST_HOLDING.toLocaleString("en-GB");
      // Value (GBP) cell — recalculate with cached exchange rate
      const rate = cachedExchangeRates[price.currency] || 1;
      const gbpValue = calculateGbpValue(TEST_HOLDING, price.priceMinorUnit, rate);
      cells[6].textContent = formatGbpValue(gbpValue);
    }
  }
}

// Initialise the page
document.addEventListener("DOMContentLoaded", async function () {
  await loadLatestRates();

  document.getElementById("fetch-rates-btn").addEventListener("click", fetchCurrencyRates);
  document.getElementById("fetch-prices-btn").addEventListener("click", fetchAllPrices);
});

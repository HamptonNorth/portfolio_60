/**
 * @description Scraping page logic for Portfolio 60.
 * Handles fetching all rates, prices and benchmark values in sequence.
 */

/**
 * @description Cached exchange rates (currency code → decimal rate per 1 GBP).
 * Built from the currency rates response and used for GBP value calculations.
 * GBP is always set to 1.0.
 * @type {Object}
 */
let cachedExchangeRates = { GBP: 1 };

/**
 * @description Track failed investment IDs from the last scrape run.
 * Used for the "Retry Failed" button functionality.
 * @type {number[]}
 */
let failedInvestmentIds = [];

/**
 * @description Track failed benchmark IDs from the last scrape run.
 * Used for the "Retry Failed" button functionality.
 * @type {number[]}
 */
let failedBenchmarkIds = [];

/**
 * @description Day-of-week names indexed 0 (Sunday) through 6 (Saturday).
 * @type {string[]}
 */
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * @description Format a 24-hour time value as HH:MM, omitting leading zero on the hour.
 * @param {number} hour - Hour (0-23)
 * @param {number} minute - Minute (0-59)
 * @returns {string} Formatted time (e.g. "8:00", "23:30")
 */
function formatTime(hour, minute) {
  return hour + ":" + (minute < 10 ? "0" : "") + minute;
}

/**
 * @description Convert a cron expression to a human-readable English string.
 * Handles common scheduling patterns (daily at specific times, specific days
 * with specific times, intervals). Not a full cron parser — covers the patterns
 * likely to appear in this application's config.
 * @param {string} cron - Standard 5-field cron expression (minute hour dom month dow)
 * @returns {string} Human-readable schedule description
 */
function cronToEnglish(cron) {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const minuteField = parts[0];
  const hourField = parts[1];
  const domField = parts[2];
  const monthField = parts[3];
  const dowField = parts[4];

  // Parse minute values
  const minutes = parseField(minuteField, 0, 59);
  // Parse hour values
  const hours = parseField(hourField, 0, 23);
  // Parse day-of-week values
  const dows = parseField(dowField, 0, 6);

  if (!minutes || !hours) return cron;

  // Build time combinations: each hour paired with each minute
  const times = [];
  for (const h of hours) {
    for (const m of minutes) {
      times.push({ hour: h, minute: m });
    }
  }
  // Sort chronologically
  times.sort(function (a, b) {
    return a.hour !== b.hour ? a.hour - b.hour : a.minute - b.minute;
  });

  const timeStrings = times.map(function (t) {
    return formatTime(t.hour, t.minute);
  });

  // Every day (dow = * and dom = *)
  if (dowField === "*" && domField === "*" && monthField === "*") {
    if (timeStrings.length === 1) {
      return "every day at " + timeStrings[0];
    }
    return "every day at " + joinWithAnd(timeStrings);
  }

  // Specific days of the week
  if (dows && dowField !== "*" && domField === "*" && monthField === "*") {
    // Group times by day: if all days share the same times, list days then times
    // If only one day, simpler phrasing
    if (dows.length === 1) {
      const dayName = DAY_NAMES[dows[0]];
      if (timeStrings.length === 1) {
        return "every " + dayName + " at " + timeStrings[0];
      }
      return "every " + dayName + " at " + joinWithAnd(timeStrings);
    }

    // Multiple days, same times for each
    const dayNames = dows.map(function (d) {
      return DAY_NAMES[d];
    });

    if (timeStrings.length === 1) {
      return "every " + joinWithAnd(dayNames) + " at " + timeStrings[0];
    }

    // Multiple days, multiple times — list each day with its time if all share,
    // or use compact form
    return "every " + joinWithAnd(dayNames) + " at " + joinWithAnd(timeStrings);
  }

  // Fallback: return the raw cron expression
  return cron;
}

/**
 * @description Parse a single cron field into an array of integer values.
 * Supports: single values ("5"), comma-separated ("1,3,5"), ranges ("1-5"),
 * step values ("* /10" without the space), and wildcard ("*").
 * @param {string} field - A single cron field
 * @param {number} min - Minimum valid value for this field
 * @param {number} max - Maximum valid value for this field
 * @returns {number[]|null} Sorted array of values, or null on parse failure
 */
function parseField(field, min, max) {
  if (field === "*") {
    const vals = [];
    for (let i = min; i <= max; i++) vals.push(i);
    return vals;
  }

  // Step: */n
  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    if (isNaN(step) || step <= 0) return null;
    const vals = [];
    for (let i = min; i <= max; i += step) vals.push(i);
    return vals;
  }

  // Comma-separated (may include ranges)
  const segments = field.split(",");
  const vals = [];

  for (const seg of segments) {
    if (seg.includes("-")) {
      // Range: e.g. "1-5"
      const rangeParts = seg.split("-");
      if (rangeParts.length !== 2) return null;
      const start = parseInt(rangeParts[0], 10);
      const end = parseInt(rangeParts[1], 10);
      if (isNaN(start) || isNaN(end) || start < min || end > max) return null;
      for (let i = start; i <= end; i++) vals.push(i);
    } else {
      const val = parseInt(seg, 10);
      if (isNaN(val) || val < min || val > max) return null;
      vals.push(val);
    }
  }

  vals.sort(function (a, b) {
    return a - b;
  });
  return vals;
}

/**
 * @description Join an array of strings with commas and "and" before the last item.
 * @param {string[]} items - Array of strings to join
 * @returns {string} Joined string (e.g. "8:00, 11:00 and 20:00")
 */
function joinWithAnd(items) {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return items[0] + " and " + items[1];
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

/**
 * @description Build the full scheduling description from the scheduling config.
 * Combines the cron-to-English translation with the runOnStartupIfMissed flag.
 * @param {Object} scheduling - Scheduling config from /api/config/scheduling
 * @param {boolean} scheduling.enabled - Whether scheduling is enabled
 * @param {string} scheduling.cron - Cron expression
 * @param {boolean} scheduling.runOnStartupIfMissed - Whether to run on startup if missed
 * @returns {string} Human-readable scheduling description
 */
function describeSchedule(scheduling) {
  if (!scheduling.enabled) {
    return "Scheduling disabled";
  }

  let description = "Scheduled " + cronToEnglish(scheduling.cron);

  if (scheduling.runOnStartupIfMissed) {
    description += ", run on startup if missed";
  }

  return description;
}

/**
 * @description Load and display the scheduling configuration.
 */
async function loadScheduleDisplay() {
  const el = document.getElementById("schedule-display");
  if (!el) return;

  const result = await apiRequest("/api/config/scheduling");

  if (!result.ok) {
    el.textContent = "Unable to load schedule";
    return;
  }

  el.textContent = describeSchedule(result.data);
}

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
 * @description Format a datetime string for display.
 * @param {string} datetime - ISO-8601 datetime string (YYYY-MM-DDTHH:MM:SS)
 * @returns {string} Formatted datetime (e.g. "5 Feb 2026 14:32")
 */
function formatDatetime(datetime) {
  if (!datetime) return "Never";

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
 * @description Format a minor-unit price value for display as 9(6).9(4).
 * Always shows exactly 4 decimal places for consistency.
 * @param {number} value - The price in minor units
 * @returns {string} Formatted price string
 */
function formatPrice(value) {
  if (value === null || value === undefined) return "—";
  return value.toFixed(4);
}

/**
 * @description Format a benchmark value for display.
 * Shows up to 4 decimal places, with trailing zeros removed for cleaner display.
 * @param {number} value - The benchmark value
 * @returns {string} Formatted value string
 */
function formatBenchmarkValue(value) {
  if (value === null || value === undefined) return "—";
  return parseFloat(value.toFixed(4)).toString();
}

/**
 * @description Build a spinner SVG element for use in pending table rows.
 * @returns {string} HTML string for a small spinning indicator
 */
function spinnerHtml() {
  return '<svg class="inline-block animate-spin h-4 w-4 text-brand-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">' + '<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>' + '<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>' + "</svg>";
}

/**
 * @description Load and display the last successful scrape times for each type.
 */
async function loadLastScrapeTimes() {
  const currencyEl = document.getElementById("last-currency-scrape");
  const investmentEl = document.getElementById("last-investment-scrape");
  const benchmarkEl = document.getElementById("last-benchmark-scrape");

  const result = await apiRequest("/api/scraper/last-scrape");

  if (!result.ok) {
    currencyEl.textContent = "Error";
    investmentEl.textContent = "Error";
    benchmarkEl.textContent = "Error";
    return;
  }

  const data = result.data;
  currencyEl.textContent = formatDatetime(data.currency);
  investmentEl.textContent = formatDatetime(data.investment);
  benchmarkEl.textContent = formatDatetime(data.benchmark);
}

/**
 * @description Update the progress text during scraping.
 * @param {string} text - The progress message to display
 */
function setProgress(text) {
  const progressText = document.getElementById("scrape-progress-text");
  if (progressText) {
    progressText.textContent = text;
  }
}

/**
 * @description Build the currency rates results section.
 * @param {Object} data - The currency rates response data
 * @returns {string} HTML string for the section
 */
function buildCurrencyRatesSection(data) {
  let html = '<section class="mb-8">';
  html += '<div class="bg-white rounded-lg shadow-md p-6">';
  html += '<h3 class="text-lg font-semibold text-brand-700 mb-4">Currency Exchange Rates</h3>';

  if (data.rates.length === 0) {
    html += '<p class="text-brand-500">No non-GBP currencies configured.</p>';
  } else {
    html += '<div class="overflow-x-auto">';
    html += '<table class="w-full text-left border-collapse">';
    html += "<thead>";
    html += '<tr class="border-b-2 border-brand-200">';
    html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">Currency</th>';
    html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">Description</th>';
    html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700 text-right">Rate (per 1 GBP)</th>';
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
      html += "</tr>";
    }

    html += "</tbody></table></div>";
    html += '<p class="text-sm text-brand-400 mt-2">' + data.rates.length + " rate" + (data.rates.length === 1 ? "" : "s") + " fetched for " + escapeHtml(data.rates[0].rateDate) + "</p>";
  }

  html += "</div></section>";
  return html;
}

/**
 * @description Build a pending row for an investment while scraping.
 * @param {Object} inv - Investment stub ({investmentId, description, currency})
 * @param {number} rowIndex - Row index for zebra striping
 * @returns {string} HTML string for the row
 */
function buildPendingPriceRow(inv, rowIndex) {
  const rowClass = rowIndex % 2 === 0 ? "bg-white" : "bg-brand-50";

  let html = '<tr id="price-row-' + inv.investmentId + '" class="' + rowClass + ' border-b border-brand-100">';
  html += '<td class="py-2 px-3 text-base">' + escapeHtml(inv.description) + "</td>";
  html += '<td class="py-2 px-3 text-base">' + escapeHtml(inv.currency) + "</td>";
  html += '<td class="py-2 px-3 text-sm text-brand-400">' + spinnerHtml() + "</td>";
  html += '<td class="py-2 px-3 text-sm text-brand-500 font-mono">—</td>';
  html += '<td class="py-2 px-3 text-base text-right font-mono">—</td>';
  html += "</tr>";
  return html;
}

/**
 * @description Update a price row in-place when result arrives.
 * @param {Object} price - The price result object
 */
function updatePriceRow(price) {
  const row = document.getElementById("price-row-" + price.investmentId);
  if (!row) return;

  const cells = row.querySelectorAll("td");
  if (cells.length < 5) return;

  // Status cell - show attempt info if retries were needed
  if (price.success) {
    if (price.attemptNumber && price.attemptNumber > 1) {
      cells[2].innerHTML = '<span class="text-sm text-success font-medium">OK (attempt ' + price.attemptNumber + ")</span>";
    } else {
      cells[2].innerHTML = '<span class="text-sm text-success font-medium">OK</span>';
    }
  } else {
    if (price.attemptNumber && price.maxAttempts) {
      cells[2].innerHTML = '<span class="text-sm text-error font-medium">Failed (' + price.attemptNumber + "/" + price.maxAttempts + " attempts)</span>";
    } else {
      cells[2].innerHTML = '<span class="text-sm text-error font-medium">Failed</span>';
    }
  }

  // Raw text cell
  cells[3].textContent = price.rawPrice || price.error || "—";

  // Parsed price cell
  cells[4].textContent = formatPrice(price.priceMinorUnit);
}

/**
 * @description Update a price row to show retry status.
 * @param {Object} retryInfo - The retry event data
 */
function updatePriceRowRetrying(retryInfo) {
  const row = document.getElementById("price-row-" + retryInfo.investmentId);
  if (!row) return;

  const cells = row.querySelectorAll("td");
  if (cells.length < 5) return;

  // Status cell - show retrying status
  cells[2].innerHTML = '<span class="text-sm text-amber-600 font-medium">' + spinnerHtml() + " Retry " + (retryInfo.attemptNumber + 1) + "/" + retryInfo.maxAttempts + "</span>";
}

/**
 * @description Build a pending row for a benchmark while scraping.
 * @param {Object} bm - Benchmark stub ({benchmarkId, description, benchmarkType, currency})
 * @param {number} rowIndex - Row index for zebra striping
 * @returns {string} HTML string for the row
 */
function buildPendingBenchmarkRow(bm, rowIndex) {
  const rowClass = rowIndex % 2 === 0 ? "bg-white" : "bg-brand-50";

  let html = '<tr id="benchmark-row-' + bm.benchmarkId + '" class="' + rowClass + ' border-b border-brand-100">';
  html += '<td class="py-2 px-3 text-base">' + escapeHtml(bm.description) + "</td>";
  html += '<td class="py-2 px-3 text-base">' + escapeHtml(bm.benchmarkType === "index" ? "Index" : "Price") + "</td>";
  html += '<td class="py-2 px-3 text-sm text-brand-400">' + spinnerHtml() + "</td>";
  html += '<td class="py-2 px-3 text-sm text-brand-500 font-mono">—</td>';
  html += '<td class="py-2 px-3 text-base text-right font-mono">—</td>';
  html += "</tr>";
  return html;
}

/**
 * @description Update a benchmark row in-place when result arrives.
 * @param {Object} benchmark - The benchmark result object
 */
function updateBenchmarkRow(benchmark) {
  const row = document.getElementById("benchmark-row-" + benchmark.benchmarkId);
  if (!row) return;

  const cells = row.querySelectorAll("td");
  if (cells.length < 5) return;

  // Status cell - show attempt info if retries were needed
  if (benchmark.success) {
    if (benchmark.attemptNumber && benchmark.attemptNumber > 1) {
      cells[2].innerHTML = '<span class="text-sm text-success font-medium">OK (attempt ' + benchmark.attemptNumber + ")</span>";
    } else {
      cells[2].innerHTML = '<span class="text-sm text-success font-medium">OK</span>';
    }
  } else {
    if (benchmark.attemptNumber && benchmark.maxAttempts) {
      cells[2].innerHTML = '<span class="text-sm text-error font-medium">Failed (' + benchmark.attemptNumber + "/" + benchmark.maxAttempts + " attempts)</span>";
    } else {
      cells[2].innerHTML = '<span class="text-sm text-error font-medium">Failed</span>';
    }
  }

  // Raw text cell
  cells[3].textContent = benchmark.rawValue || benchmark.error || "—";

  // Parsed value cell
  cells[4].textContent = formatBenchmarkValue(benchmark.parsedValue);
}

/**
 * @description Update a benchmark row to show retry status.
 * @param {Object} retryInfo - The retry event data
 */
function updateBenchmarkRowRetrying(retryInfo) {
  const row = document.getElementById("benchmark-row-" + retryInfo.benchmarkId);
  if (!row) return;

  const cells = row.querySelectorAll("td");
  if (cells.length < 5) return;

  // Status cell - show retrying status
  cells[2].innerHTML = '<span class="text-sm text-amber-600 font-medium">' + spinnerHtml() + " Retry " + (retryInfo.attemptNumber + 1) + "/" + retryInfo.maxAttempts + "</span>";
}

/**
 * @description Fetch all rates, prices and benchmark values in sequence.
 * This mirrors what a cron job would do:
 * 1. Fetch currency rates
 * 2. Fetch investment prices (using SSE stream)
 * 3. Fetch benchmark values (using SSE stream)
 */
async function fetchAll() {
  const fetchBtn = document.getElementById("fetch-all-btn");
  const showBtn = document.getElementById("show-current-btn");
  const progressDiv = document.getElementById("scrape-progress");
  const resultsContainer = document.getElementById("results-container");

  // Disable both buttons and show progress
  fetchBtn.disabled = true;
  fetchBtn.textContent = "Fetching...";
  showBtn.disabled = true;
  progressDiv.classList.remove("hidden");
  resultsContainer.innerHTML = "";

  let currencyHtml = "";
  let pricesHtml = "";
  let benchmarksHtml = "";

  try {
    // Step 1: Fetch currency rates
    setProgress("Fetching currency exchange rates...");

    const currencyResult = await apiRequest("/api/scraper/currency-rates", {
      method: "POST",
    });

    if (currencyResult.ok && currencyResult.data.rates) {
      // Cache exchange rates for display purposes
      cachedExchangeRates = { GBP: 1 };
      for (const r of currencyResult.data.rates) {
        cachedExchangeRates[r.code] = r.rate;
      }
      currencyHtml = buildCurrencyRatesSection(currencyResult.data);
    } else {
      currencyHtml = '<section class="mb-8"><div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3">';
      currencyHtml += '<p class="font-semibold">Failed to fetch currency rates</p>';
      currencyHtml += '<p class="text-sm mt-1">' + escapeHtml(currencyResult.detail || currencyResult.error || "Unknown error") + "</p>";
      currencyHtml += "</div></section>";
    }

    // Display currency results immediately
    resultsContainer.innerHTML = currencyHtml;

    // Step 2: Fetch investment prices via SSE
    setProgress("Fetching investment prices...");
    pricesHtml = await fetchPricesStream();
    resultsContainer.innerHTML = currencyHtml + pricesHtml;

    // Step 3: Fetch benchmark values via SSE
    setProgress("Fetching benchmark values...");
    benchmarksHtml = await fetchBenchmarksStream();
    resultsContainer.innerHTML = currencyHtml + pricesHtml + benchmarksHtml;
  } catch (err) {
    resultsContainer.innerHTML += '<div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3 mb-4">';
    resultsContainer.innerHTML += '<p class="font-semibold">Error during fetching</p>';
    resultsContainer.innerHTML += '<p class="text-sm mt-1">' + escapeHtml(err.message) + "</p>";
    resultsContainer.innerHTML += "</div>";
  }

  // Reset buttons and hide progress
  fetchBtn.disabled = false;
  fetchBtn.textContent = "Fetch All";
  showBtn.disabled = false;
  progressDiv.classList.add("hidden");

  // Refresh last scrape times
  await loadLastScrapeTimes();
}

/**
 * @description Fetch investment prices using SSE stream.
 * Returns a promise that resolves with the HTML for the prices section.
 * @returns {Promise<string>} HTML string for the prices section
 */
function fetchPricesStream() {
  return new Promise(function (resolve) {
    const source = new EventSource("/api/scraper/prices/stream");

    let html = '<section class="mb-8">';
    html += '<div class="bg-white rounded-lg shadow-md p-6">';
    html += '<h3 class="text-lg font-semibold text-brand-700 mb-4">Investment Prices</h3>';

    let tableHtml = "";
    let totalCount = 0;
    let successCount = 0;
    let scrapedCount = 0;
    let investments = [];

    // Create a temporary container to hold the streaming table
    const tempContainer = document.createElement("div");
    tempContainer.id = "prices-temp-container";

    source.addEventListener("init", function (event) {
      const data = JSON.parse(event.data);
      totalCount = data.total;
      investments = data.investments;

      if (totalCount === 0) {
        tempContainer.innerHTML = '<p class="text-brand-500">No investments with URL and selector configured.</p>';
        return;
      }

      // Build initial table with pending rows
      let initHtml = '<div class="overflow-x-auto">';
      initHtml += '<table class="w-full text-left border-collapse">';
      initHtml += "<thead>";
      initHtml += '<tr class="border-b-2 border-brand-200">';
      initHtml += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">Investment</th>';
      initHtml += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">Currency</th>';
      initHtml += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">Status</th>';
      initHtml += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">Raw Text</th>';
      initHtml += '<th class="py-2 px-3 text-sm font-semibold text-brand-700 text-right">Parsed Price</th>';
      initHtml += "</tr>";
      initHtml += "</thead>";
      initHtml += '<tbody id="prices-tbody">';

      for (let i = 0; i < investments.length; i++) {
        initHtml += buildPendingPriceRow(investments[i], i);
      }

      initHtml += "</tbody></table></div>";
      initHtml += '<p id="prices-footer" class="text-sm text-brand-400 mt-2"></p>';

      tempContainer.innerHTML = initHtml;

      // Append to results container temporarily so DOM updates work
      const resultsContainer = document.getElementById("results-container");
      resultsContainer.appendChild(tempContainer);
    });

    source.addEventListener("retry", function (event) {
      const retryInfo = JSON.parse(event.data);
      updatePriceRowRetrying(retryInfo);
      setProgress("Retrying " + retryInfo.description + " (attempt " + (retryInfo.attemptNumber + 1) + "/" + retryInfo.maxAttempts + ")...");
    });

    source.addEventListener("price", function (event) {
      const price = JSON.parse(event.data);
      scrapedCount++;
      if (price.success) successCount++;
      updatePriceRow(price);
      setProgress("Fetching investment prices... " + scrapedCount + " of " + totalCount);
    });

    source.addEventListener("done", function (event) {
      const data = JSON.parse(event.data);
      source.close();

      // Store failed IDs for retry functionality
      failedInvestmentIds = data.failedIds || [];

      // Update footer with retry button if there are failures
      const footerEl = document.getElementById("prices-footer");
      if (footerEl) {
        let footerText = data.successCount + " of " + data.total + " price" + (data.total === 1 ? "" : "s") + " fetched successfully";
        footerEl.textContent = footerText;

        // Add retry button if there are failures
        if (failedInvestmentIds.length > 0) {
          const retryBtn = document.createElement("button");
          retryBtn.id = "retry-prices-btn";
          retryBtn.className = "ml-4 px-3 py-1 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded";
          retryBtn.textContent = "Retry " + failedInvestmentIds.length + " Failed";
          retryBtn.addEventListener("click", retryFailedPrices);
          footerEl.appendChild(retryBtn);
        }
      }

      // Remove temp container and capture its HTML
      const temp = document.getElementById("prices-temp-container");
      if (temp) {
        tableHtml = temp.innerHTML;
        temp.remove();
      }

      html += tableHtml;
      html += "</div></section>";
      resolve(html);
    });

    source.addEventListener("error", function (event) {
      source.close();

      // Remove temp container if it exists
      const temp = document.getElementById("prices-temp-container");
      if (temp) temp.remove();

      // Provide more detail about the error state
      let errorMsg = "Error connecting to price fetching service.";
      if (source.readyState === EventSource.CLOSED) {
        errorMsg += " Connection was closed unexpectedly.";
      }
      if (scrapedCount > 0) {
        errorMsg += " (" + scrapedCount + " of " + totalCount + " fetched before error)";
      }

      html += '<p class="text-error">' + errorMsg + "</p>";
      html += "</div></section>";
      resolve(html);
    });
  });
}

/**
 * @description Fetch benchmark values using SSE stream.
 * Returns a promise that resolves with the HTML for the benchmarks section.
 * @returns {Promise<string>} HTML string for the benchmarks section
 */
function fetchBenchmarksStream() {
  return new Promise(function (resolve) {
    const source = new EventSource("/api/scraper/benchmarks/stream");

    let html = '<section class="mb-8">';
    html += '<div class="bg-white rounded-lg shadow-md p-6">';
    html += '<h3 class="text-lg font-semibold text-brand-700 mb-4">Benchmark Values</h3>';

    let tableHtml = "";
    let totalCount = 0;
    let successCount = 0;
    let scrapedCount = 0;
    let benchmarks = [];

    // Create a temporary container to hold the streaming table
    const tempContainer = document.createElement("div");
    tempContainer.id = "benchmarks-temp-container";

    source.addEventListener("init", function (event) {
      const data = JSON.parse(event.data);
      totalCount = data.total;
      benchmarks = data.benchmarks;

      if (totalCount === 0) {
        tempContainer.innerHTML = '<p class="text-brand-500">No benchmarks with URL and selector configured.</p>';
        return;
      }

      // Build initial table with pending rows
      let initHtml = '<div class="overflow-x-auto">';
      initHtml += '<table class="w-full text-left border-collapse">';
      initHtml += "<thead>";
      initHtml += '<tr class="border-b-2 border-brand-200">';
      initHtml += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">Benchmark</th>';
      initHtml += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">Type</th>';
      initHtml += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">Status</th>';
      initHtml += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">Raw Text</th>';
      initHtml += '<th class="py-2 px-3 text-sm font-semibold text-brand-700 text-right">Value</th>';
      initHtml += "</tr>";
      initHtml += "</thead>";
      initHtml += '<tbody id="benchmarks-tbody">';

      for (let i = 0; i < benchmarks.length; i++) {
        initHtml += buildPendingBenchmarkRow(benchmarks[i], i);
      }

      initHtml += "</tbody></table></div>";
      initHtml += '<p id="benchmarks-footer" class="text-sm text-brand-400 mt-2"></p>';

      tempContainer.innerHTML = initHtml;

      // Append to results container temporarily so DOM updates work
      const resultsContainer = document.getElementById("results-container");
      resultsContainer.appendChild(tempContainer);
    });

    source.addEventListener("retry", function (event) {
      const retryInfo = JSON.parse(event.data);
      updateBenchmarkRowRetrying(retryInfo);
      setProgress("Retrying " + retryInfo.description + " (attempt " + (retryInfo.attemptNumber + 1) + "/" + retryInfo.maxAttempts + ")...");
    });

    source.addEventListener("benchmark", function (event) {
      const benchmark = JSON.parse(event.data);
      scrapedCount++;
      if (benchmark.success) successCount++;
      updateBenchmarkRow(benchmark);
      setProgress("Fetching benchmark values... " + scrapedCount + " of " + totalCount);
    });

    source.addEventListener("done", function (event) {
      const data = JSON.parse(event.data);
      source.close();

      // Store failed IDs for retry functionality
      failedBenchmarkIds = data.failedIds || [];

      // Update footer with retry button if there are failures
      const footerEl = document.getElementById("benchmarks-footer");
      if (footerEl) {
        let footerText = data.successCount + " of " + data.total + " benchmark" + (data.total === 1 ? "" : "s") + " fetched successfully";
        footerEl.textContent = footerText;

        // Add retry button if there are failures
        if (failedBenchmarkIds.length > 0) {
          const retryBtn = document.createElement("button");
          retryBtn.id = "retry-benchmarks-btn";
          retryBtn.className = "ml-4 px-3 py-1 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded";
          retryBtn.textContent = "Retry " + failedBenchmarkIds.length + " Failed";
          retryBtn.addEventListener("click", retryFailedBenchmarks);
          footerEl.appendChild(retryBtn);
        }
      }

      // Remove temp container and capture its HTML
      const temp = document.getElementById("benchmarks-temp-container");
      if (temp) {
        tableHtml = temp.innerHTML;
        temp.remove();
      }

      html += tableHtml;
      html += "</div></section>";
      resolve(html);
    });

    source.addEventListener("error", function (event) {
      source.close();

      // Remove temp container if it exists
      const temp = document.getElementById("benchmarks-temp-container");
      if (temp) temp.remove();

      // Provide more detail about the error state
      let errorMsg = "Error connecting to benchmark fetching service.";
      if (source.readyState === EventSource.CLOSED) {
        errorMsg += " Connection was closed unexpectedly.";
      }
      if (scrapedCount > 0) {
        errorMsg += " (" + scrapedCount + " of " + totalCount + " fetched before error)";
      }

      html += '<p class="text-error">' + errorMsg + "</p>";
      html += "</div></section>";
      resolve(html);
    });
  });
}

/**
 * @description Retry scraping for failed investment prices.
 * Called when user clicks the "Retry Failed" button.
 */
async function retryFailedPrices() {
  if (failedInvestmentIds.length === 0) return;

  const retryBtn = document.getElementById("retry-prices-btn");
  if (retryBtn) {
    retryBtn.disabled = true;
    retryBtn.textContent = "Retrying...";
  }

  // Reset the status cells to show spinner for failed rows
  for (const id of failedInvestmentIds) {
    const row = document.getElementById("price-row-" + id);
    if (row) {
      const cells = row.querySelectorAll("td");
      if (cells.length >= 3) {
        cells[2].innerHTML = '<span class="text-sm text-brand-400">' + spinnerHtml() + "</span>";
      }
    }
  }

  try {
    const result = await apiRequest("/api/scraper/prices/retry", {
      method: "POST",
      body: JSON.stringify({ ids: failedInvestmentIds }),
    });

    if (result.ok && result.data.results) {
      // Update each row with the retry result
      for (const priceResult of result.data.results) {
        if (priceResult.price) {
          updatePriceRow(priceResult.price);
        }
      }

      // Update footer text
      const footerEl = document.getElementById("prices-footer");
      if (footerEl) {
        const newFailedCount = result.data.failCount;
        const retrySuccessCount = result.data.successCount;

        // Update failed IDs list
        failedInvestmentIds = result.data.results
          .filter(function (r) {
            return !r.success;
          })
          .map(function (r) {
            return r.price ? r.price.investmentId : null;
          })
          .filter(function (id) {
            return id !== null;
          });

        // Update or remove retry button
        if (retryBtn) {
          if (failedInvestmentIds.length > 0) {
            retryBtn.disabled = false;
            retryBtn.textContent = "Retry " + failedInvestmentIds.length + " Failed";
          } else {
            retryBtn.remove();
          }
        }
      }
    }
  } catch (err) {
    // Restore button on error
    if (retryBtn) {
      retryBtn.disabled = false;
      retryBtn.textContent = "Retry " + failedInvestmentIds.length + " Failed";
    }
  }

  // Refresh last scrape times
  await loadLastScrapeTimes();
}

/**
 * @description Retry scraping for failed benchmark values.
 * Called when user clicks the "Retry Failed" button.
 */
async function retryFailedBenchmarks() {
  if (failedBenchmarkIds.length === 0) return;

  const retryBtn = document.getElementById("retry-benchmarks-btn");
  if (retryBtn) {
    retryBtn.disabled = true;
    retryBtn.textContent = "Retrying...";
  }

  // Reset the status cells to show spinner for failed rows
  for (const id of failedBenchmarkIds) {
    const row = document.getElementById("benchmark-row-" + id);
    if (row) {
      const cells = row.querySelectorAll("td");
      if (cells.length >= 3) {
        cells[2].innerHTML = '<span class="text-sm text-brand-400">' + spinnerHtml() + "</span>";
      }
    }
  }

  try {
    const result = await apiRequest("/api/scraper/benchmarks/retry", {
      method: "POST",
      body: JSON.stringify({ ids: failedBenchmarkIds }),
    });

    if (result.ok && result.data.results) {
      // Update each row with the retry result
      for (const benchmarkResult of result.data.results) {
        if (benchmarkResult.benchmark) {
          updateBenchmarkRow(benchmarkResult.benchmark);
        }
      }

      // Update footer text
      const footerEl = document.getElementById("benchmarks-footer");
      if (footerEl) {
        const newFailedCount = result.data.failCount;
        const retrySuccessCount = result.data.successCount;

        // Update failed IDs list
        failedBenchmarkIds = result.data.results
          .filter(function (r) {
            return !r.success;
          })
          .map(function (r) {
            return r.benchmark ? r.benchmark.benchmarkId : null;
          })
          .filter(function (id) {
            return id !== null;
          });

        // Update or remove retry button
        if (retryBtn) {
          if (failedBenchmarkIds.length > 0) {
            retryBtn.disabled = false;
            retryBtn.textContent = "Retry " + failedBenchmarkIds.length + " Failed";
          } else {
            retryBtn.remove();
          }
        }
      }
    }
  } catch (err) {
    // Restore button on error
    if (retryBtn) {
      retryBtn.disabled = false;
      retryBtn.textContent = "Retry " + failedBenchmarkIds.length + " Failed";
    }
  }

  // Refresh last scrape times
  await loadLastScrapeTimes();
}

/**
 * @description Build the currency rates section for Show Current display.
 * Uses the same layout as Fetch All results but shows the date each rate was stored.
 * @param {Object[]} rates - Array of rate objects from /api/scraper/current-values
 * @returns {string} HTML string for the section
 */
function buildCurrentCurrencyRatesSection(rates) {
  let html = '<section class="mb-8">';
  html += '<div class="bg-white rounded-lg shadow-md p-6">';
  html += '<h3 class="text-lg font-semibold text-brand-700 mb-4">Currency Exchange Rates</h3>';

  if (rates.length === 0) {
    html += '<p class="text-brand-500">No currency rates stored yet.</p>';
  } else {
    html += '<div class="overflow-x-auto">';
    html += '<table class="w-full text-left border-collapse">';
    html += "<thead>";
    html += '<tr class="border-b-2 border-brand-200">';
    html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">Currency</th>';
    html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">Description</th>';
    html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700 text-right">Rate (per 1 GBP)</th>';
    html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">Date</th>';
    html += "</tr>";
    html += "</thead>";
    html += "<tbody>";

    for (let i = 0; i < rates.length; i++) {
      const rate = rates[i];
      const rowClass = i % 2 === 0 ? "bg-white" : "bg-brand-50";

      html += '<tr class="' + rowClass + ' border-b border-brand-100">';
      html += '<td class="py-2 px-3 text-base font-semibold">' + escapeHtml(rate.code) + "</td>";
      html += '<td class="py-2 px-3 text-base">' + escapeHtml(rate.description) + "</td>";
      html += '<td class="py-2 px-3 text-base text-right font-mono">' + rate.rate.toFixed(4) + "</td>";
      html += '<td class="py-2 px-3 text-sm text-brand-500">' + escapeHtml(formatDisplayDate(rate.rateDate)) + "</td>";
      html += "</tr>";
    }

    html += "</tbody></table></div>";
  }

  html += "</div></section>";
  return html;
}

/**
 * @description Build the investment prices section for Show Current display.
 * Uses the same layout as Fetch All results but shows the date each price was stored.
 * @param {Object[]} prices - Array of price objects from /api/scraper/current-values
 * @returns {string} HTML string for the section
 */
function buildCurrentPricesSection(prices) {
  let html = '<section class="mb-8">';
  html += '<div class="bg-white rounded-lg shadow-md p-6">';
  html += '<h3 class="text-lg font-semibold text-brand-700 mb-4">Investment Prices</h3>';

  if (prices.length === 0) {
    html += '<p class="text-brand-500">No investments configured.</p>';
  } else {
    html += '<div class="overflow-x-auto">';
    html += '<table class="w-full text-left border-collapse">';
    html += "<thead>";
    html += '<tr class="border-b-2 border-brand-200">';
    html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">Investment</th>';
    html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">Currency</th>';
    html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700 text-right">Price</th>';
    html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">Date</th>';
    html += "</tr>";
    html += "</thead>";
    html += "<tbody>";

    for (let i = 0; i < prices.length; i++) {
      const p = prices[i];
      const rowClass = i % 2 === 0 ? "bg-white" : "bg-brand-50";

      html += '<tr class="' + rowClass + ' border-b border-brand-100">';
      html += '<td class="py-2 px-3 text-base">' + escapeHtml(p.description) + "</td>";
      html += '<td class="py-2 px-3 text-base">' + escapeHtml(p.currency) + "</td>";
      html += '<td class="py-2 px-3 text-base text-right font-mono">' + formatPrice(p.price) + "</td>";
      html += '<td class="py-2 px-3 text-sm text-brand-500">' + (p.priceDate ? escapeHtml(formatDisplayDate(p.priceDate)) : "No data") + "</td>";
      html += "</tr>";
    }

    html += "</tbody></table></div>";
  }

  html += "</div></section>";
  return html;
}

/**
 * @description Build the benchmark values section for Show Current display.
 * Uses the same layout as Fetch All results but shows the date each value was stored.
 * @param {Object[]} benchmarks - Array of benchmark objects from /api/scraper/current-values
 * @returns {string} HTML string for the section
 */
function buildCurrentBenchmarksSection(benchmarks) {
  let html = '<section class="mb-8">';
  html += '<div class="bg-white rounded-lg shadow-md p-6">';
  html += '<h3 class="text-lg font-semibold text-brand-700 mb-4">Benchmark Values</h3>';

  if (benchmarks.length === 0) {
    html += '<p class="text-brand-500">No benchmarks configured.</p>';
  } else {
    html += '<div class="overflow-x-auto">';
    html += '<table class="w-full text-left border-collapse">';
    html += "<thead>";
    html += '<tr class="border-b-2 border-brand-200">';
    html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">Benchmark</th>';
    html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">Type</th>';
    html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700 text-right">Value</th>';
    html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">Date</th>';
    html += "</tr>";
    html += "</thead>";
    html += "<tbody>";

    for (let i = 0; i < benchmarks.length; i++) {
      const bm = benchmarks[i];
      const rowClass = i % 2 === 0 ? "bg-white" : "bg-brand-50";

      html += '<tr class="' + rowClass + ' border-b border-brand-100">';
      html += '<td class="py-2 px-3 text-base">' + escapeHtml(bm.description) + "</td>";
      html += '<td class="py-2 px-3 text-base">' + escapeHtml(bm.benchmarkType === "index" ? "Index" : "Price") + "</td>";
      html += '<td class="py-2 px-3 text-base text-right font-mono">' + formatBenchmarkValue(bm.value) + "</td>";
      html += '<td class="py-2 px-3 text-sm text-brand-500">' + (bm.valueDate ? escapeHtml(formatDisplayDate(bm.valueDate)) : "No data") + "</td>";
      html += "</tr>";
    }

    html += "</tbody></table></div>";
  }

  html += "</div></section>";
  return html;
}

/**
 * @description Show the latest stored currency rates, investment prices and benchmark values.
 * Fetches data from the database (no scraping) and displays using similar layout to Fetch All.
 */
async function showCurrent() {
  const showBtn = document.getElementById("show-current-btn");
  const fetchBtn = document.getElementById("fetch-all-btn");
  const resultsContainer = document.getElementById("results-container");

  // Disable both buttons while loading
  showBtn.disabled = true;
  showBtn.textContent = "Loading...";
  fetchBtn.disabled = true;
  resultsContainer.innerHTML = "";

  try {
    const result = await apiRequest("/api/scraper/current-values");

    if (!result.ok) {
      resultsContainer.innerHTML = '<div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3">';
      resultsContainer.innerHTML += '<p class="font-semibold">Failed to load current values</p>';
      resultsContainer.innerHTML += '<p class="text-sm mt-1">' + escapeHtml(result.detail || result.error || "Unknown error") + "</p>";
      resultsContainer.innerHTML += "</div>";
      return;
    }

    const data = result.data;

    let html = "";
    html += buildCurrentCurrencyRatesSection(data.rates);
    html += buildCurrentPricesSection(data.prices);
    html += buildCurrentBenchmarksSection(data.benchmarks);
    resultsContainer.innerHTML = html;
  } catch (err) {
    resultsContainer.innerHTML = '<div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3">';
    resultsContainer.innerHTML += '<p class="font-semibold">Error loading current values</p>';
    resultsContainer.innerHTML += '<p class="text-sm mt-1">' + escapeHtml(err.message) + "</p>";
    resultsContainer.innerHTML += "</div>";
  } finally {
    // Re-enable buttons
    showBtn.disabled = false;
    showBtn.textContent = "Show Current";
    fetchBtn.disabled = false;
  }
}

// Initialise the page
document.addEventListener("DOMContentLoaded", async function () {
  await Promise.all([loadLastScrapeTimes(), loadScheduleDisplay()]);

  document.getElementById("show-current-btn").addEventListener("click", showCurrent);
  document.getElementById("fetch-all-btn").addEventListener("click", fetchAll);
});

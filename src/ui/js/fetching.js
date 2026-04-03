/**
 * @description Fetching page logic for Portfolio 60.
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
 * @description Track failed investment IDs from the last fetch run.
 * Used for the "Retry Failed" button functionality.
 * @type {number[]}
 */
let failedInvestmentIds = [];

/**
 * @description Track failed benchmark IDs from the last fetch run.
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
 * @description Get the currency symbol for a given currency code.
 * @param {string} code - ISO 4217 currency code (e.g. "GBP", "USD")
 * @returns {string} Currency symbol (e.g. "£", "$")
 */
function getCurrencySymbol(code) {
  const symbols = { GBP: "£", USD: "$", EUR: "€", AUD: "A$", CAD: "C$", CHF: "CHF ", JPY: "¥" };
  return symbols[code] || code + " ";
}

/**
 * @description Format a minor-unit price value for display with the correct currency symbol.
 * Converts from pence/cents to major units (divides by 100).
 * Shows up to 4 decimal places; if the price has more precision, shows up to 6dp.
 * @param {number} value - The price in minor units (pence/cents)
 * @param {string} [currencyCode="GBP"] - ISO 4217 currency code
 * @returns {string} Formatted price string with currency symbol
 */
function formatPrice(value, currencyCode) {
  if (value === null || value === undefined) return "—";
  const symbol = getCurrencySymbol(currencyCode || "GBP");
  const majorUnits = value / 100;
  // Check if more than 4dp of precision exists
  const at4dp = parseFloat(majorUnits.toFixed(4));
  const at6dp = parseFloat(majorUnits.toFixed(6));
  if (at4dp !== at6dp) {
    return symbol + majorUnits.toFixed(6).replace(/0+$/, "");
  }
  let formatted = majorUnits.toFixed(4);
  // Remove trailing zeros but keep at least 2 decimal places
  formatted = formatted.replace(/(\.\d{2}\d*?)0+$/, "$1");
  return symbol + formatted;
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
 * @description Load and display the last successful fetch times for each type.
 */
async function loadLastScrapeTimes() {
  const currencyEl = document.getElementById("last-currency-fetch");
  const investmentEl = document.getElementById("last-investment-fetch");
  const benchmarkEl = document.getElementById("last-benchmark-fetch");

  const result = await apiRequest("/api/fetch/last-fetch");

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
 * @description Update the progress text during fetching.
 * @param {string} text - The progress message to display
 */
function setProgress(text) {
  const progressText = document.getElementById("fetch-progress-text");
  if (progressText) {
    progressText.textContent = text;
  }
}

/**
 * @description Show a decrementing green progress bar during a cooldown pause.
 * Updates the progress text each second and smoothly shrinks the bar from
 * 100% to 0%. Returns a promise that resolves when the countdown finishes.
 * @param {number} totalSeconds - Total cooldown duration in seconds
 * @param {string} messagePrefix - Text shown before the countdown (e.g. "Batch 2 of 5 complete")
 * @returns {Promise<void>} Resolves when the cooldown is complete
 */
function showCooldownBar(totalSeconds, messagePrefix) {
  return new Promise(function (resolve) {
    const barContainer = document.getElementById("cooldown-bar-container");
    const bar = document.getElementById("cooldown-bar");
    if (!barContainer || !bar) {
      // Fall back to a simple sleep if the bar elements are missing
      setTimeout(resolve, totalSeconds * 1000);
      return;
    }

    let remaining = totalSeconds;
    setProgress(messagePrefix + " Cooldown: " + remaining + "s...");

    // Reset bar to full width instantly, then allow transitions for shrinking
    bar.style.transition = "none";
    bar.style.width = "100%";
    barContainer.classList.remove("hidden");

    // Force a reflow so the reset takes effect before re-enabling transition
    void bar.offsetWidth;
    bar.style.transition = "width 1s linear";

    const countdownId = setInterval(function () {
      remaining--;
      if (remaining > 0) {
        setProgress(messagePrefix + " Cooldown: " + remaining + "s...");
        const pct = (remaining / totalSeconds) * 100;
        bar.style.width = pct + "%";
      } else {
        bar.style.width = "0%";
      }
    }, 1000);

    setTimeout(function () {
      clearInterval(countdownId);
      barContainer.classList.add("hidden");
      bar.style.transition = "none";
      bar.style.width = "100%";
      resolve();
    }, totalSeconds * 1000);
  });
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
 * @description Build a pending row for an investment while fetching.
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

  // Status cell - show pass info if retries were needed
  if (price.success) {
    let statusHtml = '<span class="text-sm text-success font-medium">OK</span>';
    if (price.attemptNumber && price.attemptNumber > 1) {
      statusHtml = '<span class="text-sm text-success font-medium">OK (pass ' + price.attemptNumber + ")</span>";
    }
    // Show price date if available (Morningstar API returns this)
    if (price.priceDate) {
      statusHtml += '<br><span class="text-xs text-brand-400">' + escapeHtml(price.priceDate) + "</span>";
    }
    cells[2].innerHTML = statusHtml;
  } else if (price.errorCode === "MANUALLY_PRICED") {
    cells[2].innerHTML = '<span class="text-sm font-medium text-amber-600">Manually priced</span>';
  } else {
    if (price.attemptNumber && price.maxAttempts) {
      cells[2].innerHTML = '<span class="text-sm text-error font-medium">Failed (pass ' + price.attemptNumber + " of " + price.maxAttempts + ")</span>";
    } else {
      cells[2].innerHTML = '<span class="text-sm text-error font-medium">Failed</span>';
    }
  }

  // Raw text cell
  if (price.errorCode === "MANUALLY_PRICED") {
    cells[3].innerHTML = '<span class="text-sm text-amber-600">Skipped</span>';
  } else {
    cells[3].textContent = price.rawPrice || price.error || "—";
  }

  // Parsed price cell
  cells[4].textContent = formatPrice(price.priceMinorUnit, price.currency);
}

/**
 * @description Build a pending row for a benchmark while fetching.
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

  // Status cell - show pass info if retries were needed
  if (benchmark.success) {
    if (benchmark.attemptNumber && benchmark.attemptNumber > 1) {
      cells[2].innerHTML = '<span class="text-sm text-success font-medium">OK (pass ' + benchmark.attemptNumber + ")</span>";
    } else {
      cells[2].innerHTML = '<span class="text-sm text-success font-medium">OK</span>';
    }
  } else {
    if (benchmark.attemptNumber && benchmark.maxAttempts) {
      cells[2].innerHTML = '<span class="text-sm text-error font-medium">Failed (pass ' + benchmark.attemptNumber + " of " + benchmark.maxAttempts + ")</span>";
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
 * @description Fetch all rates, prices and benchmark values in sequence.
 * This mirrors what a cron job would do:
 * 1. Fetch currency rates
 * 2. Fetch investment prices (using SSE stream)
 * 3. Fetch benchmark values (using SSE stream)
 */
/**
 * @description Enable or disable all fetch-related buttons on the page.
 * @param {boolean} disabled - Whether to disable (true) or enable (false) the buttons
 */
function setAllFetchButtonsDisabled(disabled) {
  const ids = ["fetch-all-btn", "show-current-btn", "fetch-currencies-btn", "fetch-prices-btn", "fetch-benchmarks-btn", "retry-failed-prices-btn", "retry-failed-benchmarks-btn"];
  for (const id of ids) {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = disabled;
  }
}

async function fetchAll() {
  const fetchBtn = document.getElementById("fetch-all-btn");
  const progressDiv = document.getElementById("fetch-progress");
  const resultsContainer = document.getElementById("results-container");

  // Disable all buttons and show progress
  setAllFetchButtonsDisabled(true);
  fetchBtn.textContent = "Fetching...";
  progressDiv.classList.remove("hidden");
  resultsContainer.innerHTML = "";

  // Create section containers so each can be independently retried
  resultsContainer.innerHTML = '<div id="section-currencies"></div>' + '<div id="section-prices"></div>' + '<div id="section-benchmarks"></div>';

  try {
    // Step 1: Fetch currency rates
    setProgress("Fetching currency exchange rates...");
    await runCurrenciesSection();

    // Step 2: Fetch investment prices via SSE
    setProgress("Fetching investment prices...");
    await runPricesSection();

    // Step 3: Fetch benchmark values via SSE
    setProgress("Fetching benchmark values...");
    await runBenchmarksSection();
  } catch (err) {
    resultsContainer.insertAdjacentHTML("beforeend", '<div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3 mb-4">' + '<p class="font-semibold">Error during fetching</p>' + '<p class="text-sm mt-1">' + escapeHtml(err.message) + "</p>" + "</div>");
  }

  // Reset buttons and hide progress
  setAllFetchButtonsDisabled(false);
  fetchBtn.textContent = "Fetch All";
  progressDiv.classList.add("hidden");

  // Refresh last fetch times and failure status
  await Promise.all([loadLastScrapeTimes(), loadLatestFailures()]);
}

/**
 * @description Run the currencies section: fetch rates and populate #section-currencies.
 * On failure, shows an error message with a retry button.
 */
async function runCurrenciesSection() {
  const container = document.getElementById("section-currencies");

  const currencyResult = await apiRequest("/api/fetch/currency-rates", {
    method: "POST",
  });

  if (currencyResult.ok && currencyResult.data.rates) {
    // Cache exchange rates for display purposes
    cachedExchangeRates = { GBP: 1 };
    for (const r of currencyResult.data.rates) {
      cachedExchangeRates[r.code] = r.rate;
    }
    container.innerHTML = buildCurrencyRatesSection(currencyResult.data);
  } else {
    let html = '<section class="mb-8"><div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3">';
    html += '<p class="font-semibold">Failed to fetch currency rates</p>';
    html += '<p class="text-sm mt-1">' + escapeHtml(currencyResult.detail || currencyResult.error || "Unknown error") + "</p>";
    html += '<p class="mt-3"><button onclick="retryCurrenciesSection()" class="bg-amber-500 hover:bg-amber-600 text-white rounded px-3 py-1 text-sm">Retry Currency Rates</button></p>';
    html += "</div></section>";
    container.innerHTML = html;
  }
}

/**
 * @description Run the investment prices section: stream prices via SSE and populate #section-prices.
 * On SSE connection error, shows an error message with a retry button.
 */
async function runPricesSection() {
  const container = document.getElementById("section-prices");
  container.innerHTML = "";
  const html = await fetchPricesStream();
  container.innerHTML = html;

  // Re-attach click listener lost during innerHTML serialization
  const retryBtn = document.getElementById("retry-prices-btn");
  if (retryBtn) {
    retryBtn.addEventListener("click", retryFailedPrices);
  }
}

/**
 * @description Run the benchmarks section: stream values via SSE and populate #section-benchmarks.
 * On SSE connection error, shows an error message with a retry button.
 */
async function runBenchmarksSection() {
  const container = document.getElementById("section-benchmarks");
  container.innerHTML = "";
  const html = await fetchBenchmarksStream();
  container.innerHTML = html;

  // Re-attach click listener lost during innerHTML serialization
  const retryBtn = document.getElementById("retry-benchmarks-btn");
  if (retryBtn) {
    retryBtn.addEventListener("click", retryFailedBenchmarks);
  }
}

/**
 * @description Retry just the currencies section after a failure.
 * Called from the retry button in the error HTML.
 */
async function retryCurrenciesSection() {
  const container = document.getElementById("section-currencies");
  container.innerHTML = '<section class="mb-8"><div class="bg-white rounded-lg shadow-md p-6">' + '<h3 class="text-lg font-semibold text-brand-700 mb-4">Currency Exchange Rates</h3>' + '<p class="text-brand-400">' + spinnerHtml() + " Retrying currency rates...</p>" + "</div></section>";
  await runCurrenciesSection();
  await loadLastScrapeTimes();
}

/**
 * @description Retry just the investment prices section after a failure.
 * Called from the retry button in the error HTML.
 */
async function retryPricesSection() {
  const container = document.getElementById("section-prices");
  container.innerHTML = '<section class="mb-8"><div class="bg-white rounded-lg shadow-md p-6">' + '<h3 class="text-lg font-semibold text-brand-700 mb-4">Investment Prices</h3>' + '<p class="text-brand-400">' + spinnerHtml() + " Retrying investment prices...</p>" + "</div></section>";
  await runPricesSection();
  await loadLastScrapeTimes();
}

/**
 * @description Retry just the benchmarks section after a failure.
 * Called from the retry button in the error HTML.
 */
async function retryBenchmarksSection() {
  const container = document.getElementById("section-benchmarks");
  container.innerHTML = '<section class="mb-8"><div class="bg-white rounded-lg shadow-md p-6">' + '<h3 class="text-lg font-semibold text-brand-700 mb-4">Benchmark Values</h3>' + '<p class="text-brand-400">' + spinnerHtml() + " Retrying benchmark values...</p>" + "</div></section>";
  await runBenchmarksSection();
  await loadLastScrapeTimes();
}

/**
 * @description Run a single SSE stream for a batch of investment IDs.
 * Resolves when the stream completes (done or error). Updates existing
 * DOM rows as price events arrive.
 * @param {number[]} ids - Investment IDs to fetch in this batch
 * @param {boolean} skipCurrencyRates - Whether to skip currency rate fetch
 * @param {Set<number>} completedIds - Set of already-completed investment IDs (mutated)
 * @returns {Promise<{successCount: number, failCount: number, failedIds: number[], error: string|null}>}
 */
function fetchPriceBatch(ids, skipCurrencyRates, completedIds) {
  return new Promise(function (resolve) {
    const streamUrl = "/api/fetch/prices/stream?ids=" + ids.join(",") + (skipCurrencyRates ? "&skipCurrencyRates=true" : "");
    const source = new EventSource(streamUrl);

    let batchSuccess = 0;
    let batchFail = 0;
    let passItemCount = 0;
    let currentPass = 1;
    let passTotal = ids.length;

    source.addEventListener("init", function () {
      // Table rows already exist — nothing to build
    });

    source.addEventListener("backfill", function (event) {
      const data = JSON.parse(event.data);
      setProgress(data.message);
    });

    source.addEventListener("backfill_progress", function (event) {
      const data = JSON.parse(event.data);
      if (data.cooldownSeconds) {
        // Server is pausing — show a decrementing progress bar client-side
        showCooldownBar(data.cooldownSeconds, "Backfill: Batch complete.");
      } else if (data.message) {
        setProgress("Backfill: " + data.message);
      }
    });

    source.addEventListener("retry_pass", function (event) {
      const passInfo = JSON.parse(event.data);
      currentPass = passInfo.pass;
      passItemCount = 0;
      passTotal = passInfo.retryCount;
    });

    source.addEventListener("price", function (event) {
      const price = JSON.parse(event.data);
      passItemCount++;
      if (price.success) {
        batchSuccess++;
        completedIds.add(price.investmentId);
      } else {
        batchFail++;
      }
      updatePriceRow(price);

      // Update progress with batch context
      let progressMsg = "Fetching investment prices... " + completedIds.size + " of " + passTotal;
      if (currentPass > 1) {
        progressMsg = "Pass " + currentPass + ": re-trying... " + passItemCount + " of " + passTotal;
      }
      setProgress(progressMsg);
    });

    source.addEventListener("done", function (event) {
      const data = JSON.parse(event.data);
      source.close();
      resolve({
        successCount: data.successCount,
        failCount: data.failCount,
        failedIds: data.failedIds || [],
        error: null,
      });
    });

    source.addEventListener("error", function () {
      source.close();
      // Work out which IDs from this batch were not completed
      const batchFailedIds = ids.filter(function (id) { return !completedIds.has(id); });
      resolve({
        successCount: batchSuccess,
        failCount: batchFailedIds.length,
        failedIds: batchFailedIds,
        error: "Connection dropped",
      });
    });
  });
}

/**
 * @description Sleep for a given number of milliseconds (client-side).
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function clientSleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

/**
 * @description Fetch investment prices in batches using separate SSE streams.
 * Each batch opens a fresh connection to the server, which launches a fresh
 * browser session. Between batches, a cooldown countdown is shown to avoid
 * rate-limiting by target websites.
 * @returns {Promise<string>} HTML string for the prices section
 */
async function fetchPricesStream() {
  // Fetch the price method from server config
  let priceMethod = "scrape";
  try {
    const configResult = await apiRequest("/api/config/price-method");
    if (configResult.ok) {
      priceMethod = configResult.data.priceMethod || "scrape";
    }
  } catch {
    // Fall back to default
  }
  const methodLabel = priceMethod === "api" ? "Investment Prices (Morningstar API)" : "Investment Prices";

  let html = '<section class="mb-8">';
  html += '<div class="bg-white rounded-lg shadow-md p-6">';
  html += '<h3 class="text-lg font-semibold text-brand-700 mb-4">' + escapeHtml(methodLabel) + "</h3>";

  // Step 1: Get the full investment list and batch config
  const listUrl = "/api/fetch/prices/list";
  const listResult = await apiRequest(listUrl);
  if (!listResult.ok) {
    html += '<p class="text-error">Failed to get investment list: ' + escapeHtml(listResult.data.error || "Unknown error") + "</p>";
    html += '<p class="mt-3"><button onclick="retryPricesSection()" class="bg-amber-500 hover:bg-amber-600 text-white rounded px-3 py-1 text-sm">Retry Investment Prices</button></p>';
    html += "</div></section>";
    return html;
  }

  const allInvestments = listResult.data.investments;
  const batchSize = listResult.data.batchSize || 8;
  const cooldownSeconds = listResult.data.cooldownSeconds || 120;
  const totalCount = allInvestments.length;

  if (totalCount === 0) {
    const noInvestmentsMsg = priceMethod === "api"
      ? "No investments configured for automatic pricing."
      : "No investments with URL and selector configured.";
    html += '<p class="text-brand-500">' + escapeHtml(noInvestmentsMsg) + "</p>";
    html += "</div></section>";
    return html;
  }

  // Step 2: Build the full table with all investments as "pending"
  const tempContainer = document.createElement("div");
  tempContainer.id = "prices-temp-container";

  let initHtml = '<div class="overflow-x-auto">';
  initHtml += '<table class="w-full text-left border-collapse">';
  initHtml += "<thead>";
  initHtml += '<tr class="border-b-2 border-brand-200">';
  initHtml += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">Investment</th>';
  initHtml += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">Currency</th>';
  initHtml += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">Status</th>';
  initHtml += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">Raw Text</th>';
  initHtml += '<th class="py-2 px-3 text-sm font-semibold text-brand-700 text-right">Price</th>';
  initHtml += "</tr>";
  initHtml += "</thead>";
  initHtml += '<tbody id="prices-tbody">';

  for (let i = 0; i < allInvestments.length; i++) {
    initHtml += buildPendingPriceRow(allInvestments[i], i);
  }

  initHtml += "</tbody></table></div>";
  initHtml += '<p id="prices-footer" class="text-sm text-brand-400 mt-2"></p>';

  tempContainer.innerHTML = initHtml;
  const sectionContainer = document.getElementById("section-prices") || document.getElementById("results-container");
  sectionContainer.appendChild(tempContainer);

  // Step 3: Split investments into batches and fetch each with a fresh stream
  const allIds = allInvestments.map(function (inv) { return inv.investmentId; });
  const completedInvestmentIds = new Set();
  let totalSuccess = 0;
  let totalFail = 0;
  const allFailedIds = [];

  const numBatches = Math.ceil(allIds.length / batchSize);

  for (let batchIndex = 0; batchIndex < numBatches; batchIndex++) {
    const batchStart = batchIndex * batchSize;
    const batchIds = allIds.slice(batchStart, batchStart + batchSize);
    const batchNum = batchIndex + 1;
    const isFirstBatch = batchIndex === 0;

    setProgress("Batch " + batchNum + " of " + numBatches + ": fetching prices for " + batchIds.length + " investment" + (batchIds.length === 1 ? "" : "s") + "...");

    // Mark this batch's rows as "in progress"
    for (const id of batchIds) {
      const row = document.getElementById("price-row-" + id);
      if (row) {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 3) {
          cells[2].innerHTML = '<span class="text-sm text-brand-400">' + spinnerHtml() + " Fetching...</span>";
        }
      }
    }

    // Open a fresh SSE stream for this batch
    // First batch fetches currency rates; subsequent batches skip them
    const batchResult = await fetchPriceBatch(batchIds, !isFirstBatch, completedInvestmentIds);

    totalSuccess += batchResult.successCount;
    totalFail += batchResult.failCount;
    if (batchResult.failedIds.length > 0) {
      for (const id of batchResult.failedIds) {
        allFailedIds.push(id);
      }
    }

    // Cooldown between batches (skip after the last batch)
    if (batchIndex < numBatches - 1 && cooldownSeconds > 0) {
      const prefix = "Batch " + batchNum + " of " + numBatches + " complete (" + completedInvestmentIds.size + " of " + totalCount + " done).";
      await showCooldownBar(cooldownSeconds, prefix);
      setProgress("Starting batch " + (batchNum + 1) + "...");
    }
  }

  // Step 4: Build final results
  failedInvestmentIds = allFailedIds;

  const footerEl = document.getElementById("prices-footer");
  if (footerEl) {
    let footerText = totalSuccess + " of " + totalCount + " price" + (totalCount === 1 ? "" : "s") + " fetched successfully";
    if (allFailedIds.length > 0) {
      footerText += " (" + allFailedIds.length + " failed)";
    }
    footerEl.textContent = footerText;

    if (allFailedIds.length > 0) {
      const retryBtn = document.createElement("button");
      retryBtn.id = "retry-prices-btn";
      retryBtn.className = "ml-4 px-3 py-1 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded";
      retryBtn.textContent = "Retry " + allFailedIds.length + " Failed";
      retryBtn.addEventListener("click", retryFailedPrices);
      footerEl.appendChild(retryBtn);
    }
  }

  // Capture table HTML and clean up temp container
  const temp = document.getElementById("prices-temp-container");
  let tableHtml = "";
  if (temp) {
    tableHtml = temp.innerHTML;
    temp.remove();
  }

  html += tableHtml;
  html += "</div></section>";
  return html;
}

/**
 * @description Run a single SSE stream for a batch of benchmark IDs.
 * Resolves when the stream completes (done or error). Updates existing
 * DOM rows as benchmark events arrive.
 * @param {number[]} ids - Benchmark IDs to fetch in this batch
 * @param {Set<number>} completedIds - Set of already-completed benchmark IDs (mutated)
 * @returns {Promise<{successCount: number, failCount: number, failedIds: number[], error: string|null}>}
 */
function fetchBenchmarkBatch(ids, completedIds) {
  return new Promise(function (resolve) {
    const streamUrl = "/api/fetch/benchmarks/stream?ids=" + ids.join(",");
    const source = new EventSource(streamUrl);

    let batchSuccess = 0;
    let batchFail = 0;
    let passItemCount = 0;
    let currentPass = 1;
    let passTotal = ids.length;

    source.addEventListener("init", function () {
      // Table rows already exist — nothing to build
    });

    source.addEventListener("backfill", function (event) {
      const data = JSON.parse(event.data);
      setProgress(data.message);
    });

    source.addEventListener("backfill_progress", function (event) {
      const data = JSON.parse(event.data);
      if (data.cooldownSeconds) {
        // Server is pausing — show a decrementing progress bar client-side
        showCooldownBar(data.cooldownSeconds, "Backfill: Batch complete.");
      } else if (data.message) {
        setProgress("Backfill: " + data.message);
      }
    });

    source.addEventListener("retry_pass", function (event) {
      const passInfo = JSON.parse(event.data);
      currentPass = passInfo.pass;
      passItemCount = 0;
      passTotal = passInfo.retryCount;
    });

    source.addEventListener("benchmark", function (event) {
      const benchmark = JSON.parse(event.data);
      passItemCount++;
      if (benchmark.success) {
        batchSuccess++;
        completedIds.add(benchmark.benchmarkId);
      } else {
        batchFail++;
      }
      updateBenchmarkRow(benchmark);

      let progressMsg = "Fetching benchmark values... " + completedIds.size + " of " + passTotal;
      if (currentPass > 1) {
        progressMsg = "Pass " + currentPass + ": re-trying... " + passItemCount + " of " + passTotal;
      }
      setProgress(progressMsg);
    });

    source.addEventListener("done", function (event) {
      const data = JSON.parse(event.data);
      source.close();
      resolve({
        successCount: data.successCount,
        failCount: data.failCount,
        failedIds: data.failedIds || [],
        error: null,
      });
    });

    source.addEventListener("error", function () {
      source.close();
      const batchFailedIds = ids.filter(function (id) { return !completedIds.has(id); });
      resolve({
        successCount: batchSuccess,
        failCount: batchFailedIds.length,
        failedIds: batchFailedIds,
        error: "Connection dropped",
      });
    });
  });
}

/**
 * @description Fetch benchmark values in batches using separate SSE streams.
 * Each batch opens a fresh connection to the server, which launches a fresh
 * browser session. Between batches, a cooldown countdown is shown.
 * @returns {Promise<string>} HTML string for the benchmarks section
 */
async function fetchBenchmarksStream() {
  let html = '<section class="mb-8">';
  html += '<div class="bg-white rounded-lg shadow-md p-6">';
  html += '<h3 class="text-lg font-semibold text-brand-700 mb-4">Benchmark Values</h3>';

  // Step 1: Get the full benchmark list and batch config
  const listResult = await apiRequest("/api/fetch/benchmarks/list");
  if (!listResult.ok) {
    html += '<p class="text-error">Failed to get benchmark list: ' + escapeHtml(listResult.data.error || "Unknown error") + "</p>";
    html += '<p class="mt-3"><button onclick="retryBenchmarksSection()" class="bg-amber-500 hover:bg-amber-600 text-white rounded px-3 py-1 text-sm">Retry Benchmark Values</button></p>';
    html += "</div></section>";
    return html;
  }

  const allBenchmarks = listResult.data.benchmarks;
  const batchSize = listResult.data.batchSize || 8;
  const cooldownSeconds = listResult.data.cooldownSeconds || 120;
  const totalCount = allBenchmarks.length;

  if (totalCount === 0) {
    html += '<p class="text-brand-500">No benchmarks with URL and selector configured.</p>';
    html += "</div></section>";
    return html;
  }

  // Step 2: Build the full table with all benchmarks as "pending"
  const tempContainer = document.createElement("div");
  tempContainer.id = "benchmarks-temp-container";

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

  for (let i = 0; i < allBenchmarks.length; i++) {
    initHtml += buildPendingBenchmarkRow(allBenchmarks[i], i);
  }

  initHtml += "</tbody></table></div>";
  initHtml += '<p id="benchmarks-footer" class="text-sm text-brand-400 mt-2"></p>';

  tempContainer.innerHTML = initHtml;
  const sectionContainer = document.getElementById("section-benchmarks") || document.getElementById("results-container");
  sectionContainer.appendChild(tempContainer);

  // Step 3: Split benchmarks into batches and fetch each with a fresh stream
  const allIds = allBenchmarks.map(function (bm) { return bm.benchmarkId; });
  const completedBenchmarkIds = new Set();
  let totalSuccess = 0;
  let totalFail = 0;
  const allFailedIds = [];

  const numBatches = Math.ceil(allIds.length / batchSize);

  for (let batchIndex = 0; batchIndex < numBatches; batchIndex++) {
    const batchStart = batchIndex * batchSize;
    const batchIds = allIds.slice(batchStart, batchStart + batchSize);
    const batchNum = batchIndex + 1;

    setProgress("Batch " + batchNum + " of " + numBatches + ": fetching values for " + batchIds.length + " benchmark" + (batchIds.length === 1 ? "" : "s") + "...");

    // Mark this batch's rows as "in progress"
    for (const id of batchIds) {
      const row = document.getElementById("benchmark-row-" + id);
      if (row) {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 3) {
          cells[2].innerHTML = '<span class="text-sm text-brand-400">' + spinnerHtml() + " Fetching...</span>";
        }
      }
    }

    const batchResult = await fetchBenchmarkBatch(batchIds, completedBenchmarkIds);

    totalSuccess += batchResult.successCount;
    totalFail += batchResult.failCount;
    if (batchResult.failedIds.length > 0) {
      for (const id of batchResult.failedIds) {
        allFailedIds.push(id);
      }
    }

    // Cooldown between batches (skip after the last batch)
    if (batchIndex < numBatches - 1 && cooldownSeconds > 0) {
      const prefix = "Batch " + batchNum + " of " + numBatches + " complete (" + completedBenchmarkIds.size + " of " + totalCount + " done).";
      await showCooldownBar(cooldownSeconds, prefix);
      setProgress("Starting batch " + (batchNum + 1) + "...");
    }
  }

  // Step 4: Build final results
  failedBenchmarkIds = allFailedIds;

  const footerEl = document.getElementById("benchmarks-footer");
  if (footerEl) {
    let footerText = totalSuccess + " of " + totalCount + " benchmark" + (totalCount === 1 ? "" : "s") + " fetched successfully";
    if (allFailedIds.length > 0) {
      footerText += " (" + allFailedIds.length + " failed)";
    }
    footerEl.textContent = footerText;

    if (allFailedIds.length > 0) {
      const retryBtn = document.createElement("button");
      retryBtn.id = "retry-benchmarks-btn";
      retryBtn.className = "ml-4 px-3 py-1 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded";
      retryBtn.textContent = "Retry " + allFailedIds.length + " Failed";
      retryBtn.addEventListener("click", retryFailedBenchmarks);
      footerEl.appendChild(retryBtn);
    }
  }

  // Capture table HTML and clean up temp container
  const temp = document.getElementById("benchmarks-temp-container");
  let tableHtml = "";
  if (temp) {
    tableHtml = temp.innerHTML;
    temp.remove();
  }

  html += tableHtml;
  html += "</div></section>";
  return html;
}

/**
 * @description Retry fetching for failed investment prices.
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
    const result = await apiRequest("/api/fetch/prices/retry", {
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

  // Refresh last fetch times
  await loadLastScrapeTimes();
}

/**
 * @description Retry fetching for failed benchmark values.
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
    const result = await apiRequest("/api/fetch/benchmarks/retry", {
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

  // Refresh last fetch times
  await loadLastScrapeTimes();
}

/**
 * @description Build the currency rates section for Show Current display.
 * Uses the same layout as Fetch All results but shows the date each rate was stored.
 * @param {Object[]} rates - Array of rate objects from /api/fetch/current-values
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
    html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">As At</th>';
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
 * @param {Object[]} prices - Array of price objects from /api/fetch/current-values
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
    html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">As At</th>';
    html += "</tr>";
    html += "</thead>";
    html += "<tbody>";

    for (let i = 0; i < prices.length; i++) {
      const p = prices[i];
      const rowClass = i % 2 === 0 ? "bg-white" : "bg-brand-50";

      html += '<tr class="' + rowClass + ' border-b border-brand-100">';
      html += '<td class="py-2 px-3 text-base">' + escapeHtml(p.description) + "</td>";
      html += '<td class="py-2 px-3 text-base">' + escapeHtml(p.currency) + "</td>";
      html += '<td class="py-2 px-3 text-base text-right font-mono">' + formatPrice(p.price, p.currency) + "</td>";
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
 * @param {Object[]} benchmarks - Array of benchmark objects from /api/fetch/current-values
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
    html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">As At</th>';
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
 * Fetches data from the database (no API calls) and displays using similar layout to Fetch All.
 */
async function showCurrent() {
  const showBtn = document.getElementById("show-current-btn");
  const resultsContainer = document.getElementById("results-container");

  // Disable all buttons while loading
  setAllFetchButtonsDisabled(true);
  showBtn.textContent = "Loading...";
  resultsContainer.innerHTML = "";

  try {
    const result = await apiRequest("/api/fetch/current-values");

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
    setAllFetchButtonsDisabled(false);
    showBtn.textContent = "Show Current";
  }
}

/**
 * @description Fetch only currency rates (independent of prices/benchmarks).
 */
async function fetchCurrenciesOnly() {
  const btn = document.getElementById("fetch-currencies-btn");
  const progressDiv = document.getElementById("fetch-progress");
  const resultsContainer = document.getElementById("results-container");

  setAllFetchButtonsDisabled(true);
  btn.textContent = "Fetching...";
  progressDiv.classList.remove("hidden");
  setProgress("Fetching currency exchange rates...");
  resultsContainer.innerHTML = '<div id="section-currencies"></div>';

  try {
    await runCurrenciesSection();
  } catch (err) {
    resultsContainer.insertAdjacentHTML("beforeend", '<div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3 mb-4">' + '<p class="font-semibold">Error fetching currencies</p>' + '<p class="text-sm mt-1">' + escapeHtml(err.message) + "</p>" + "</div>");
  }

  setAllFetchButtonsDisabled(false);
  btn.textContent = "Fetch Currencies";
  progressDiv.classList.add("hidden");
  await Promise.all([loadLastScrapeTimes(), loadLatestFailures()]);
}

/**
 * @description Fetch only investment prices (currencies are fetched server-side first).
 */
async function fetchPricesOnly() {
  const btn = document.getElementById("fetch-prices-btn");
  const progressDiv = document.getElementById("fetch-progress");
  const resultsContainer = document.getElementById("results-container");

  setAllFetchButtonsDisabled(true);
  btn.textContent = "Fetching...";
  progressDiv.classList.remove("hidden");
  setProgress("Fetching investment prices...");
  resultsContainer.innerHTML = '<div id="section-currencies"></div><div id="section-prices"></div>';

  try {
    // The prices SSE stream fetches currency rates server-side and returns them
    // in the init event, so the currencies section is populated automatically.
    await runPricesSection();
  } catch (err) {
    resultsContainer.insertAdjacentHTML("beforeend", '<div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3 mb-4">' + '<p class="font-semibold">Error fetching prices</p>' + '<p class="text-sm mt-1">' + escapeHtml(err.message) + "</p>" + "</div>");
  }

  setAllFetchButtonsDisabled(false);
  btn.textContent = "Fetch Prices";
  progressDiv.classList.add("hidden");
  await Promise.all([loadLastScrapeTimes(), loadLatestFailures()]);
}

/**
 * @description Fetch only benchmark values.
 */
async function fetchBenchmarksOnly() {
  const btn = document.getElementById("fetch-benchmarks-btn");
  const progressDiv = document.getElementById("fetch-progress");
  const resultsContainer = document.getElementById("results-container");

  setAllFetchButtonsDisabled(true);
  btn.textContent = "Fetching...";
  progressDiv.classList.remove("hidden");
  setProgress("Fetching benchmark values...");
  resultsContainer.innerHTML = '<div id="section-benchmarks"></div>';

  try {
    await runBenchmarksSection();
  } catch (err) {
    resultsContainer.insertAdjacentHTML("beforeend", '<div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3 mb-4">' + '<p class="font-semibold">Error fetching benchmarks</p>' + '<p class="text-sm mt-1">' + escapeHtml(err.message) + "</p>" + "</div>");
  }

  setAllFetchButtonsDisabled(false);
  btn.textContent = "Fetch Benchmarks";
  progressDiv.classList.add("hidden");
  await Promise.all([loadLastScrapeTimes(), loadLatestFailures()]);
}

/**
 * @description Cached latest failures data from the API.
 * Used by retry-from-DB buttons.
 * @type {{investmentFailures: Object[], benchmarkFailures: Object[]}}
 */
let latestFailuresData = { investmentFailures: [], benchmarkFailures: [] };

/**
 * @description Load latest failures from the DB and show/hide the retry section.
 * Called on page load and after every fetch/retry operation.
 */
async function loadLatestFailures() {
  try {
    const result = await apiRequest("/api/fetch/latest-failures");
    if (!result.ok) return;

    latestFailuresData = result.data;
    const section = document.getElementById("retry-failures-section");
    const priceBtn = document.getElementById("retry-failed-prices-btn");
    const benchmarkBtn = document.getElementById("retry-failed-benchmarks-btn");
    const summary = document.getElementById("retry-failures-summary");

    const priceCount = latestFailuresData.investmentFailures.length;
    const benchmarkCount = latestFailuresData.benchmarkFailures.length;

    if (priceCount === 0 && benchmarkCount === 0) {
      section.classList.add("hidden");
      return;
    }

    // Build summary text
    const parts = [];
    if (priceCount > 0) {
      parts.push(priceCount + " investment price" + (priceCount === 1 ? "" : "s"));
    }
    if (benchmarkCount > 0) {
      parts.push(benchmarkCount + " benchmark value" + (benchmarkCount === 1 ? "" : "s"));
    }
    summary.textContent = parts.join(" and ") + " failed on the most recent fetch.";

    // Show/hide individual retry buttons
    if (priceCount > 0) {
      priceBtn.textContent = "Retry " + priceCount + " Failed Price" + (priceCount === 1 ? "" : "s");
      priceBtn.classList.remove("hidden");
    } else {
      priceBtn.classList.add("hidden");
    }

    if (benchmarkCount > 0) {
      benchmarkBtn.textContent = "Retry " + benchmarkCount + " Failed Benchmark" + (benchmarkCount === 1 ? "" : "s");
      benchmarkBtn.classList.remove("hidden");
    } else {
      benchmarkBtn.classList.add("hidden");
    }

    section.classList.remove("hidden");
  } catch {
    // Silently fail — this is a non-critical enhancement
  }
}

/**
 * @description Retry failed investment prices using IDs from the latest failures query.
 */
async function retryFailedPricesFromDb() {
  const ids = latestFailuresData.investmentFailures.map(function (f) {
    return f.reference_id;
  });
  if (ids.length === 0) return;

  const progressDiv = document.getElementById("fetch-progress");
  const resultsContainer = document.getElementById("results-container");

  setAllFetchButtonsDisabled(true);
  progressDiv.classList.remove("hidden");
  setProgress("Retrying " + ids.length + " failed investment price" + (ids.length === 1 ? "" : "s") + "...");
  resultsContainer.innerHTML = '<div id="section-prices"></div>';

  try {
    const result = await apiRequest("/api/fetch/prices/retry", {
      method: "POST",
      body: { ids: ids },
    });

    const container = document.getElementById("section-prices");
    if (result.ok && result.data) {
      let html = '<section class="mb-8"><div class="bg-white rounded-lg shadow-md p-6">';
      html += '<h3 class="text-lg font-semibold text-brand-700 mb-4">Retry Results — Investment Prices</h3>';
      html += "<p class=\"text-sm text-brand-500 mb-3\">" + result.data.successCount + " of " + result.data.total + " succeeded</p>";
      html += "</div></section>";
      container.innerHTML = html;
    } else {
      container.innerHTML = '<section class="mb-8"><div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3">' + "<p>Retry failed: " + escapeHtml(result.error || "Unknown error") + "</p></div></section>";
    }
  } catch (err) {
    const container = document.getElementById("section-prices");
    container.innerHTML = '<section class="mb-8"><div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3">' + "<p>Error: " + escapeHtml(err.message) + "</p></div></section>";
  }

  setAllFetchButtonsDisabled(false);
  progressDiv.classList.add("hidden");
  await Promise.all([loadLastScrapeTimes(), loadLatestFailures()]);
}

/**
 * @description Retry failed benchmark values using IDs from the latest failures query.
 */
async function retryFailedBenchmarksFromDb() {
  const ids = latestFailuresData.benchmarkFailures.map(function (f) {
    return f.reference_id;
  });
  if (ids.length === 0) return;

  const progressDiv = document.getElementById("fetch-progress");
  const resultsContainer = document.getElementById("results-container");

  setAllFetchButtonsDisabled(true);
  progressDiv.classList.remove("hidden");
  setProgress("Retrying " + ids.length + " failed benchmark value" + (ids.length === 1 ? "" : "s") + "...");
  resultsContainer.innerHTML = '<div id="section-benchmarks"></div>';

  try {
    const result = await apiRequest("/api/fetch/benchmarks/retry", {
      method: "POST",
      body: { ids: ids },
    });

    const container = document.getElementById("section-benchmarks");
    if (result.ok && result.data) {
      let html = '<section class="mb-8"><div class="bg-white rounded-lg shadow-md p-6">';
      html += '<h3 class="text-lg font-semibold text-brand-700 mb-4">Retry Results — Benchmark Values</h3>';
      html += "<p class=\"text-sm text-brand-500 mb-3\">" + result.data.successCount + " of " + result.data.total + " succeeded</p>";
      html += "</div></section>";
      container.innerHTML = html;
    } else {
      container.innerHTML = '<section class="mb-8"><div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3">' + "<p>Retry failed: " + escapeHtml(result.error || "Unknown error") + "</p></div></section>";
    }
  } catch (err) {
    const container = document.getElementById("section-benchmarks");
    container.innerHTML = '<section class="mb-8"><div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3">' + "<p>Error: " + escapeHtml(err.message) + "</p></div></section>";
  }

  setAllFetchButtonsDisabled(false);
  progressDiv.classList.add("hidden");
  await Promise.all([loadLastScrapeTimes(), loadLatestFailures()]);
}

// Initialise the page
// ---------------------------------------------------------------------------
// Fetch Server sync
// ---------------------------------------------------------------------------

/**
 * @description Load and display the fetch server status.
 * Shows the fetch server section only if it is configured.
 */
async function loadFetchServerStatus() {
  try {
    const response = await fetch("/api/fetch/server-status");
    const data = await response.json();

    if (!data.enabled) return;

    // Show the section
    const section = document.getElementById("fetch-server-section");
    section.classList.remove("hidden");

    const statusEl = document.getElementById("fetch-server-status");

    if (!data.reachable) {
      statusEl.textContent = "Server not reachable";
      statusEl.className = "text-sm text-red-600";
      return;
    }

    const parts = [];
    if (data.lastFetch) {
      parts.push("Last fetch: " + formatDisplayDate(data.lastFetch.split("T")[0]) + " " + data.lastFetch.split("T")[1].substring(0, 5));
    }
    if (data.lastFetchResult) {
      const r = data.lastFetchResult;
      parts.push("Prices: " + r.priceSuccess + " OK" + (r.priceFailed > 0 ? ", " + r.priceFailed + " failed" : ""));
      parts.push("Currency: " + (r.currencySuccess ? "OK" : "failed"));
    }
    if (data.nextScheduledFetch) {
      const nextDate = new Date(data.nextScheduledFetch);
      parts.push("Next: " + formatDisplayDate(nextDate.toISOString().split("T")[0]) + " " + nextDate.toTimeString().substring(0, 5));
    }
    if (data.serverUptime) {
      parts.push("Uptime: " + data.serverUptime);
    }

    statusEl.textContent = parts.join("  ·  ");
    statusEl.className = "text-sm text-brand-500";
  } catch {
    // Fetch server not configured or unreachable — leave hidden
  }
}

/**
 * @description Trigger a manual sync from the fetch server.
 */
async function syncFromServer() {
  const btn = document.getElementById("sync-from-server-btn");
  const resultEl = document.getElementById("fetch-server-sync-result");

  btn.disabled = true;
  btn.textContent = "Syncing...";
  resultEl.textContent = "";

  try {
    const response = await fetch("/api/fetch/sync", { method: "POST" });
    const data = await response.json();

    if (data.success) {
      const parts = [];
      if (data.live) {
        parts.push("Live: " + data.live.prices + " prices, " + data.live.rates + " rates, " + data.live.benchmarks + " benchmarks");
      }
      if (data.test) {
        parts.push("Test: " + data.test.prices + " prices, " + data.test.rates + " rates, " + data.test.benchmarks + " benchmarks");
      }
      resultEl.textContent = parts.join("  ·  ");
      resultEl.className = "text-sm text-green-600";
    } else {
      resultEl.textContent = data.error || "Sync failed";
      resultEl.className = "text-sm text-red-600";
    }
  } catch (err) {
    resultEl.textContent = "Sync failed: " + err.message;
    resultEl.className = "text-sm text-red-600";
  } finally {
    btn.disabled = false;
    btn.textContent = "Sync from Server";
  }
}

/**
 * @description Load and display the fetch server log.
 * Fetches the last 80 entries from the remote server via the proxy endpoint.
 * Shows the last 20 entries visible by default with the panel scrolled to the bottom.
 * Only shown when fetch server is enabled and reachable.
 */
async function loadFetchServerLog() {
  try {
    const response = await fetch("/api/fetch/server-log");
    const data = await response.json();

    if (!data.enabled) return;

    const section = document.getElementById("fetch-server-log-section");
    const container = document.getElementById("fetch-server-log-container");

    if (!data.reachable || !data.entries || data.entries.length === 0) {
      section.classList.remove("hidden");
      container.innerHTML = '<p class="text-sm text-brand-500 p-3">No log entries available.</p>';
      return;
    }

    section.classList.remove("hidden");

    // Build the log table — entries arrive newest-first, display newest first
    const entries = data.entries;
    let html = '<table class="w-full text-xs">';
    html += '<thead class="sticky top-0 bg-brand-50"><tr class="text-left">';
    html += '<th class="py-1.5 px-3 font-medium text-brand-700">Date/Time</th>';
    html += '<th class="py-1.5 px-3 font-medium text-brand-700">Type</th>';
    html += '<th class="py-1.5 px-3 font-medium text-brand-700 text-right">OK</th>';
    html += '<th class="py-1.5 px-3 font-medium text-brand-700 text-right">Failed</th>';
    html += '<th class="py-1.5 px-3 font-medium text-brand-700">Error</th>';
    html += '</tr></thead><tbody>';

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const dt = entry.fetch_datetime || "";
      const displayDate = dt.length >= 16 ? dt.substring(0, 10) + " " + dt.substring(11, 16) : dt;
      const hasFailed = entry.items_failed > 0;
      const hasError = entry.error_message && entry.error_message.length > 0;
      const rowClass = (hasFailed || hasError) ? "bg-red-50" : "";

      html += '<tr class="border-t border-brand-100 ' + rowClass + '">';
      html += '<td class="py-1.5 px-3 text-brand-600 whitespace-nowrap">' + escapeHtml(displayDate) + '</td>';
      html += '<td class="py-1.5 px-3 text-brand-600">' + escapeHtml(entry.fetch_type || "") + '</td>';
      html += '<td class="py-1.5 px-3 text-right text-green-700">' + (entry.items_success || 0) + '</td>';
      html += '<td class="py-1.5 px-3 text-right' + (hasFailed ? ' text-red-600 font-medium' : ' text-brand-500') + '">' + (entry.items_failed || 0) + '</td>';
      html += '<td class="py-1.5 px-3 text-red-600 truncate max-w-xs" title="' + escapeHtml(entry.error_message || "") + '">' + escapeHtml(entry.error_message || "") + '</td>';
      html += '</tr>';
    }

    html += '</tbody></table>';
    container.innerHTML = html;
  } catch {
    // Fetch server log not available — leave hidden
  }
}

/**
 * @description Trigger a Fetch All on the remote fetch server.
 * The fetch runs asynchronously; the user can refresh the log to see results.
 */
async function rerunServerFetchAll() {
  const btn = document.getElementById("rerun-fetch-btn");
  const resultEl = document.getElementById("rerun-fetch-result");

  btn.disabled = true;
  btn.textContent = "Starting...";
  resultEl.textContent = "";

  try {
    const response = await fetch("/api/fetch/server-rerun", { method: "POST" });
    const data = await response.json();

    if (data.success) {
      resultEl.textContent = data.message || "Fetch started — refresh log to see results";
      resultEl.className = "text-sm text-green-600";
      setTimeout(function () { resultEl.textContent = ""; }, 5000);
    } else {
      resultEl.textContent = data.error || "Failed to trigger fetch";
      resultEl.className = "text-sm text-red-600";
    }
  } catch (err) {
    resultEl.textContent = "Failed: " + err.message;
    resultEl.className = "text-sm text-red-600";
  } finally {
    btn.disabled = false;
    btn.textContent = "Rerun Fetch All";
  }
}

document.addEventListener("DOMContentLoaded", async function () {
  await Promise.all([loadLastScrapeTimes(), loadScheduleDisplay(), loadLatestFailures(), loadFetchServerStatus()]);

  document.getElementById("show-current-btn").addEventListener("click", showCurrent);
  document.getElementById("fetch-all-btn").addEventListener("click", fetchAll);
  document.getElementById("fetch-currencies-btn").addEventListener("click", fetchCurrenciesOnly);
  document.getElementById("fetch-prices-btn").addEventListener("click", fetchPricesOnly);
  document.getElementById("fetch-benchmarks-btn").addEventListener("click", fetchBenchmarksOnly);
  document.getElementById("retry-failed-prices-btn").addEventListener("click", retryFailedPricesFromDb);
  document.getElementById("retry-failed-benchmarks-btn").addEventListener("click", retryFailedBenchmarksFromDb);
  document.getElementById("sync-from-server-btn").addEventListener("click", syncFromServer);

  const showLogBtn = document.getElementById("show-server-log-btn");
  if (showLogBtn) {
    showLogBtn.addEventListener("click", function () {
      const logSection = document.getElementById("fetch-server-log-section");
      if (logSection && logSection.classList.contains("hidden")) {
        loadFetchServerLog();
        showLogBtn.textContent = "Hide Fetch Server Log";
      } else if (logSection) {
        logSection.classList.add("hidden");
        showLogBtn.textContent = "Show Fetch Server Log";
      }
    });
  }

  const refreshLogBtn = document.getElementById("refresh-server-log-btn");
  if (refreshLogBtn) {
    refreshLogBtn.addEventListener("click", loadFetchServerLog);
  }

  const rerunBtn = document.getElementById("rerun-fetch-btn");
  if (rerunBtn) {
    rerunBtn.addEventListener("click", rerunServerFetchAll);
  }
});

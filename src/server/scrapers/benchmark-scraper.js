import { getAllBenchmarks, getBenchmarkById } from "../db/benchmarks-db.js";
import { upsertBenchmarkData } from "../db/benchmark-data-db.js";
import { recordScrapingAttempt } from "../db/scraping-history-db.js";
import { SCRAPE_DELAY_PROFILES, DEFAULT_SCRAPE_DELAY_PROFILE } from "../../shared/constants.js";
import { launchBrowser, createStealthContext, createStealthPage, navigateTo } from "./browser-utils.js";
import { getSelector } from "../config.js";

/**
 * @description Parse a benchmark value string extracted from a web page into a numeric value.
 * Handles common formats found on financial websites:
 * - Currency symbols: £, $, €, etc.
 * - Currency abbreviations: GBP, USD, EUR, etc. (leading or trailing)
 * - Thousands separators: commas
 * - Whitespace and non-breaking spaces
 * - Index point notation (pure numbers, typically no currency)
 * - Negative values with minus sign or parentheses
 *
 * For benchmarks, the value is always treated as the final value (no minor/major unit
 * distinction like prices). Index values are point values; price-based benchmarks
 * (e.g. gold spot price) are stored as received.
 *
 * @param {string} rawText - The raw text content from the web page element
 * @returns {{value: number|null, raw: string}} Parsed result
 *   - value: the numeric benchmark value, or null if parsing failed
 *   - raw: the original raw text for debugging
 */
export function parseBenchmarkValue(rawText) {
  if (!rawText || typeof rawText !== "string") {
    return { value: null, raw: rawText || "" };
  }

  const raw = rawText.trim();

  if (raw === "") {
    return { value: null, raw: "" };
  }

  let cleaned = raw;

  // Remove currency symbols, whitespace, non-breaking spaces
  cleaned = cleaned.replace(/[£$€¥\u00a0\s]/g, "");

  // Remove leading currency abbreviations (e.g. "GBP", "USD", "EUR")
  cleaned = cleaned.replace(/^[A-Za-z]+/, "");

  // Remove trailing currency abbreviations or suffixes (e.g. "p", "GBX")
  cleaned = cleaned.replace(/[A-Za-z]+$/, "");

  // Remove thousands-separator commas
  cleaned = cleaned.replace(/,/g, "");

  // Handle parenthesised negatives: (123.45) -> -123.45
  const parenMatch = cleaned.match(/^\(([0-9.]+)\)$/);
  if (parenMatch) {
    cleaned = "-" + parenMatch[1];
  }

  // Parse the remaining string as a float
  const value = parseFloat(cleaned);

  if (isNaN(value)) {
    return { value: null, raw: raw };
  }

  return { value: value, raw: raw };
}

/**
 * @description Scrape the current value for a single benchmark using Playwright.
 * Launches a headless Chromium browser, navigates to the benchmark URL,
 * waits for the CSS selector, and extracts the text content.
 * Stores successful values in the benchmark_data table and records all attempts in scraping_history.
 *
 * @param {Object} benchmark - The benchmark object (from getAllBenchmarks or getBenchmarkById)
 * @param {Object} [browser=null] - An existing Playwright browser instance to reuse.
 *   If null, a new browser is launched and closed after scraping.
 * @param {Object} [options={}] - Additional options
 * @param {number} [options.startedBy=0] - 0 = manual/interactive, 1 = scheduled/cron
 * @param {number} [options.attemptNumber=1] - Retry attempt counter (1-5)
 * @param {boolean} [options.testMode=false] - If true, skip database writes (for testing)
 * @returns {Promise<{success: boolean, benchmarkId: number, description: string, benchmarkType: string, rawValue: string, parsedValue: number|null, currency: string, error?: string}>}
 */
export async function scrapeSingleBenchmarkValue(benchmark, browser = null, options = {}) {
  const startedBy = options.startedBy || 0;
  const attemptNumber = options.attemptNumber || 1;
  const testMode = options.testMode || false;
  const scrapeTime = options.scrapeTime || new Date().toTimeString().slice(0, 8);
  const result = {
    success: false,
    benchmarkId: benchmark.id,
    description: benchmark.description,
    benchmarkType: benchmark.benchmark_type,
    rawValue: "",
    parsedValue: null,
    currency: benchmark.currency_code || "",
    error: "",
  };

  if (!benchmark.benchmark_url) {
    result.error = "No URL configured";
    // Record failed attempt in history (skip in test mode)
    if (!testMode) {
      recordScrapingAttempt({
        scrapeType: "benchmark",
        referenceId: benchmark.id,
        startedBy: startedBy,
        attemptNumber: attemptNumber,
        success: false,
        errorCode: "NO_URL",
        errorMessage: result.error,
      });
    }
    return result;
  }

  // Look up selector from config if not provided in the benchmark record
  const selectorInfo = getSelector(benchmark.benchmark_url, benchmark.selector);

  if (!selectorInfo.selector) {
    result.error = "No CSS selector configured and URL does not match any known site";
    // Record failed attempt in history (skip in test mode)
    if (!testMode) {
      recordScrapingAttempt({
        scrapeType: "benchmark",
        referenceId: benchmark.id,
        startedBy: startedBy,
        attemptNumber: attemptNumber,
        success: false,
        errorCode: "NO_SELECTOR",
        errorMessage: result.error,
      });
    }
    return result;
  }

  const activeSelector = selectorInfo.selector;
  const waitStrategy = selectorInfo.waitStrategy || "domcontentloaded";

  const ownBrowser = browser === null;
  let browserInstance = browser;
  let page = null;
  let errorCode = null;

  // Track navigation and selector status separately for better diagnostics
  let navigationSucceeded = false;
  let pageTitle = "";

  try {
    if (ownBrowser) {
      browserInstance = await launchBrowser();
    }

    // Create stealth context with anti-bot bypasses (including Google consent cookie)
    const context = await createStealthContext(browserInstance, benchmark.benchmark_url);
    page = await createStealthPage(context);

    // Navigate to the benchmark URL with appropriate settings for the site
    await navigateTo(page, benchmark.benchmark_url);
    navigationSucceeded = true;

    // Capture page title for diagnostics
    try {
      pageTitle = await page.title();
    } catch {
      pageTitle = "(could not get title)";
    }

    // Wait for the selector to appear on the page (longer timeout for heavy JS sites)
    const selectorTimeout = waitStrategy === "networkidle" ? 30000 : 20000;
    const element = await page.waitForSelector(activeSelector, {
      timeout: selectorTimeout,
    });

    if (!element) {
      result.error = "Navigation OK. Selector not found on page. Page title: " + pageTitle;
      errorCode = "SELECTOR_NOT_FOUND";
    } else {
      // Extract the text content of the matched element
      const rawText = await element.textContent();
      result.rawValue = rawText ? rawText.trim() : "";

      // Parse the benchmark value
      const parsed = parseBenchmarkValue(result.rawValue);
      result.parsedValue = parsed.value;

      if (parsed.value === null) {
        result.error = "Could not parse value from text: " + result.rawValue;
        errorCode = "PARSE_ERROR";
      } else {
        result.success = true;

        // Store the value in the database (skip in test mode)
        if (!testMode) {
          const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
          upsertBenchmarkData(benchmark.id, today, scrapeTime, result.parsedValue);
        }
      }
    }
  } catch (err) {
    // Provide more detailed error message based on what stage failed
    if (navigationSucceeded) {
      // Navigation worked but selector failed (likely timeout waiting for selector)
      result.error = "Navigation OK (page: " + (pageTitle || "unknown") + "). Selector failed: " + err.message;
      errorCode = "SELECTOR_TIMEOUT";
    } else {
      // Navigation itself failed
      result.error = "Navigation failed: " + err.message;
      if (err.message.includes("timeout") || err.message.includes("Timeout")) {
        errorCode = "NAVIGATION_TIMEOUT";
      } else if (err.message.includes("net::ERR_")) {
        errorCode = "NETWORK_ERROR";
      } else {
        errorCode = "BROWSER_ERROR";
      }
    }
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        // Ignore close errors
      }
    }
    if (ownBrowser && browserInstance) {
      try {
        await browserInstance.close();
      } catch {
        // Ignore close errors
      }
    }
  }

  // Record the scraping attempt in history (skip in test mode)
  if (!testMode) {
    recordScrapingAttempt({
      scrapeType: "benchmark",
      referenceId: benchmark.id,
      startedBy: startedBy,
      attemptNumber: attemptNumber,
      success: result.success,
      errorCode: result.success ? null : errorCode,
      errorMessage: result.success ? null : result.error,
    });
  }

  return result;
}

/**
 * @description Extract the hostname from a URL string for domain comparison.
 * Returns an empty string if the URL is invalid or missing.
 * @param {string} url - The URL to extract the hostname from
 * @returns {string} The hostname (e.g. "www.londonstockexchange.com") or ""
 */
export function extractDomain(url) {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/**
 * @description Get the active scrape delay profile. Uses the SCRAPE_DELAY_PROFILE
 * environment variable if set, otherwise falls back to DEFAULT_SCRAPE_DELAY_PROFILE.
 * @returns {{sameDomain: {min: number, max: number}, differentDomain: {min: number, max: number}}}
 */
export function getDelayProfile() {
  const profileName = process.env.SCRAPE_DELAY_PROFILE || DEFAULT_SCRAPE_DELAY_PROFILE;
  return SCRAPE_DELAY_PROFILES[profileName] || SCRAPE_DELAY_PROFILES[DEFAULT_SCRAPE_DELAY_PROFILE];
}

/**
 * @description Calculate a random delay in milliseconds based on whether consecutive
 * requests target the same domain. Uses the active delay profile.
 * @param {string} previousDomain - Hostname of the previous request (empty string if first request)
 * @param {string} currentDomain - Hostname of the current request
 * @returns {number} Delay in milliseconds (0 if this is the first request)
 */
export function calculateDelay(previousDomain, currentDomain) {
  if (!previousDomain) return 0;

  const profile = getDelayProfile();
  const range = previousDomain === currentDomain ? profile.sameDomain : profile.differentDomain;
  return Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
}

/**
 * @description Sleep for a given number of milliseconds.
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

/**
 * @description Scrape values for all benchmarks that have a URL and selector configured.
 *
 * Uses a single shared browser instance for efficiency. Includes random delays
 * between requests to avoid being rate-limited or blocked by target sites.
 * Delay durations depend on the active profile (interactive or cron) and whether
 * consecutive requests hit the same domain.
 *
 * @param {Function|null} [onProgress=null] - Optional callback called after each benchmark
 *   is scraped. Receives the benchmark result object as its argument. Used by the SSE
 *   streaming endpoint to send incremental updates to the client.
 * @param {Object} [options={}] - Additional options
 * @param {number} [options.startedBy=0] - 0 = manual/interactive, 1 = scheduled/cron
 * @param {number} [options.attemptNumber=1] - Retry attempt counter (1-5)
 * @returns {Promise<{success: boolean, benchmarks: Object[], message: string}>}
 */
export async function scrapeAllBenchmarks(onProgress = null, options = {}) {
  const startedBy = options.startedBy || 0;
  const attemptNumber = options.attemptNumber || 1;
  const scrapeTime = options.scrapeTime || new Date().toTimeString().slice(0, 8);

  // Get all benchmarks that can be scraped (have URL + selector from config or custom)
  const scrapeable = getScrapeableBenchmarks();

  if (scrapeable.length === 0) {
    return {
      success: true,
      benchmarks: [],
      message: "No benchmarks with URL and selector configured",
    };
  }

  // Launch a shared browser and scrape each benchmark
  let browser = null;
  const benchmarks = [];

  try {
    browser = await launchBrowser();
    let previousDomain = "";

    for (const benchmark of scrapeable) {
      // Random delay between requests to avoid rate-limiting/blocking
      const currentDomain = extractDomain(benchmark.benchmark_url);
      const delayMs = calculateDelay(previousDomain, currentDomain);
      if (delayMs > 0) {
        await sleep(delayMs);
      }

      const benchmarkResult = await scrapeSingleBenchmarkValue(benchmark, browser, {
        startedBy: startedBy,
        attemptNumber: attemptNumber,
        scrapeTime: scrapeTime,
      });
      benchmarks.push(benchmarkResult);
      previousDomain = currentDomain;

      // Notify the caller after each benchmark is scraped
      if (onProgress) {
        onProgress(benchmarkResult);
      }
    }
  } catch (err) {
    return {
      success: false,
      benchmarks: benchmarks,
      message: "Browser error during benchmark scraping: " + err.message,
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Ignore close errors
      }
    }
  }

  const successCount = benchmarks.filter(function (b) {
    return b.success;
  }).length;
  const failCount = benchmarks.length - successCount;

  let message = "Scraped " + successCount + " of " + benchmarks.length + " benchmark value" + (benchmarks.length === 1 ? "" : "s");
  if (failCount > 0) {
    message += " (" + failCount + " failed)";
  }

  return {
    success: true,
    benchmarks: benchmarks,
    message: message,
  };
}

/**
 * @description Get the list of scrapeable benchmarks.
 * A benchmark is scrapeable if it has a URL AND either:
 * - has a custom selector configured, OR
 * - its URL matches a known site in the scraper config
 * Used by the SSE endpoint to send the benchmark list before scraping begins.
 * @returns {Object[]} Array of benchmark objects that can be scraped
 */
export function getScrapeableBenchmarks() {
  const allBenchmarks = getAllBenchmarks();
  return allBenchmarks.filter(function (bm) {
    if (!bm.benchmark_url) {
      return false;
    }
    // Has custom selector, or URL matches a known site
    const selectorInfo = getSelector(bm.benchmark_url, bm.selector);
    return selectorInfo.selector !== null;
  });
}

/**
 * @description Scrape the value for a single benchmark by its ID.
 *
 * @param {number} id - The benchmark ID
 * @param {Object} [options={}] - Additional options
 * @param {number} [options.startedBy=0] - 0 = manual/interactive, 1 = scheduled/cron
 * @param {number} [options.attemptNumber=1] - Retry attempt counter (1-5)
 * @param {boolean} [options.testMode=false] - If true, skip database writes (for testing)
 * @returns {Promise<{success: boolean, benchmark: Object|null, message: string, error?: string}>}
 */
export async function scrapeBenchmarkById(id, options = {}) {
  const testMode = options.testMode || false;
  const scrapeTime = options.scrapeTime || new Date().toTimeString().slice(0, 8);
  const benchmark = getBenchmarkById(id);

  if (!benchmark) {
    return {
      success: false,
      benchmark: null,
      message: "Benchmark not found",
      error: "No benchmark with ID " + id,
    };
  }

  const benchmarkResult = await scrapeSingleBenchmarkValue(benchmark, null, {
    startedBy: options.startedBy || 0,
    attemptNumber: options.attemptNumber || 1,
    testMode: testMode,
    scrapeTime: scrapeTime,
  });

  return {
    success: benchmarkResult.success,
    benchmark: benchmarkResult,
    message: benchmarkResult.success ? "Value scraped for " + benchmark.description : "Failed to scrape value for " + benchmark.description,
    error: benchmarkResult.error || undefined,
  };
}

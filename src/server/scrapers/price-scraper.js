import { getAllInvestments, getInvestmentById, updateInvestmentScrapingSource } from "../db/investments-db.js";
import { updateTestInvestmentScrapingSource } from "../db/test-investments-db.js";
import { fetchCurrencyRates } from "./currency-scraper.js";
import { SCRAPE_DELAY_PROFILES, DEFAULT_SCRAPE_DELAY_PROFILE } from "../../shared/constants.js";
import { upsertPrice } from "../db/prices-db.js";
import { recordScrapingAttempt } from "../db/scraping-history-db.js";
import { launchBrowser, createStealthContext, createStealthPage, navigateTo, isBrowserAlive } from "./browser-utils.js";
import { getSelector } from "../config.js";
import { buildFtMarketsUrl, buildFtMarketsAlternateUrl, getFtMarketsSelector, buildFidelitySearchUrl, detectPublicIdType } from "../../shared/public-id-utils.js";

/**
 * @description Parse a price string extracted from a web page into a numeric value.
 * Handles common formats found on financial websites:
 * - Currency symbols: £, $, €, etc.
 * - Currency abbreviations: GBP, USD, EUR, etc. (leading or trailing)
 * - Thousands separators: commas
 * - Whitespace and non-breaking spaces
 * - Pence/minor-unit notation: "123.45p", "123.45P", "123.45GBX"
 * - Negative values with minus sign or parentheses
 *
 * @param {string} rawText - The raw text content from the web page element
 * @returns {{value: number|null, isMinorUnit: boolean, raw: string}} Parsed result
 *   - value: the numeric price, or null if parsing failed
 *   - isMinorUnit: true if the price is in minor units (pence/cents).
 *     Default is true (assume pence) unless a major-unit indicator is found
 *     (currency symbol £/$/ etc. or abbreviation GBP/USD/EUR etc.).
 *   - raw: the original raw text for debugging
 */
export function parsePrice(rawText) {
  if (!rawText || typeof rawText !== "string") {
    return { value: null, isMinorUnit: false, raw: rawText || "" };
  }

  const raw = rawText.trim();

  if (raw === "") {
    return { value: null, isMinorUnit: false, raw: "" };
  }

  // Default: assume minor units (pence/cents) unless we find a major-unit indicator
  let isMinorUnit = true;
  let cleaned = raw;

  // Strip explicit minor-unit suffixes (p/P/GBX) — these confirm the default
  if (/GBX\s*$/i.test(cleaned)) {
    cleaned = cleaned.replace(/GBX\s*$/i, "");
  } else if (/p\s*$/i.test(cleaned)) {
    cleaned = cleaned.replace(/p\s*$/i, "");
  }

  // Detect major-unit currency symbols — these override the default to major units
  if (/[£$€¥]/.test(cleaned)) {
    isMinorUnit = false;
  }

  // Remove currency symbols, whitespace, non-breaking spaces
  cleaned = cleaned.replace(/[£$€¥\u00a0\s]/g, "");

  // Detect and strip leading currency abbreviations (e.g. "GBP", "USD", "EUR")
  // These indicate major units
  const leadingAbbr = cleaned.match(/^[A-Za-z]+/);
  if (leadingAbbr) {
    isMinorUnit = false;
    cleaned = cleaned.replace(/^[A-Za-z]+/, "");
  }

  // Detect and strip trailing currency abbreviations
  const trailingAbbr = cleaned.match(/[A-Za-z]+$/);
  if (trailingAbbr) {
    isMinorUnit = false;
    cleaned = cleaned.replace(/[A-Za-z]+$/, "");
  }

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
    return { value: null, isMinorUnit: false, raw: raw };
  }

  return { value: value, isMinorUnit: isMinorUnit, raw: raw };
}

/**
 * @description Normalise a parsed price to the currency's minor unit (pence, cents, etc.).
 * If the price is already in minor units (isMinorUnit === true), returns as-is.
 * If the price is in major units (pounds, dollars), multiplies by 100.
 * Result is rounded to 4 decimal places for consistency.
 *
 * @param {number} value - The parsed numeric price
 * @param {boolean} isMinorUnit - Whether the value is already in minor units
 * @returns {number} The price in minor units, rounded to 4 decimal places
 */
export function normaliseToMinorUnit(value, isMinorUnit) {
  if (isMinorUnit) {
    return Math.round(value * 10000) / 10000;
  }
  return Math.round(value * 100 * 10000) / 10000;
}

/**
 * @description Discover the Fidelity UK factsheet URL for a given ISIN by searching
 * the Fidelity website. Navigates to the Fidelity search page, waits for the
 * search results iframe to load, and extracts the "View Factsheet" link href.
 *
 * The search results are rendered inside an iframe (#answers-frame) from Fidelity's
 * Yext search platform. The factsheet link has the class "HitchhikerCTA".
 *
 * @param {string} isin - The ISIN code to search for (e.g. "GB00BJS8SH10")
 * @param {import('playwright').Browser} browser - An existing browser instance to use
 * @returns {Promise<{success: boolean, url: string|null, error: string|null}>}
 */
export async function scrapeFidelityFactsheetUrl(isin, browser) {
  const searchUrl = buildFidelitySearchUrl(isin);
  if (!searchUrl) {
    return { success: false, url: null, error: "Invalid ISIN for Fidelity search: " + isin };
  }

  let page = null;
  try {
    const context = await createStealthContext(browser, searchUrl);
    page = await createStealthPage(context);

    // Navigate to the Fidelity search page
    await navigateTo(page, searchUrl, { waitUntil: "networkidle" });

    // The search results are inside an iframe (#answers-frame)
    const iframeEl = await page.waitForSelector("#answers-frame", { timeout: 15000 });
    if (!iframeEl) {
      return { success: false, url: null, error: "Fidelity search iframe not found" };
    }

    const frame = await iframeEl.contentFrame();
    if (!frame) {
      return { success: false, url: null, error: "Could not access Fidelity search iframe content" };
    }

    // Wait for the "View Factsheet" link to appear inside the iframe
    const factsheetLink = await frame.waitForSelector("a.HitchhikerCTA", { timeout: 15000 });
    if (!factsheetLink) {
      return { success: false, url: null, error: "View Factsheet link not found in search results for ISIN: " + isin };
    }

    const href = await factsheetLink.getAttribute("href");
    if (!href || !href.includes("factsheet")) {
      return { success: false, url: null, error: "Factsheet link has unexpected href: " + (href || "(empty)") };
    }

    return { success: true, url: href, error: null };
  } catch (err) {
    return { success: false, url: null, error: "Fidelity search failed: " + err.message };
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        // Ignore close errors
      }
    }
  }
}

/**
 * @description Scrape the current price for a single investment using Playwright.
 * Launches a headless Chromium browser, navigates to the investment URL,
 * waits for the CSS selector, and extracts the text content.
 * Stores successful prices in the prices table and records all attempts in scraping_history.
 *
 * When the primary source (manual URL or FT Markets) fails for an ISIN-based investment,
 * attempts a Fidelity UK fallback: searches Fidelity by ISIN to discover the factsheet
 * URL, then scrapes the price from that page. On success, writes the factsheet URL back
 * to the investment record so subsequent scrapes go direct without the search step.
 *
 * @param {Object} investment - The investment object (from getAllInvestments or getInvestmentById)
 * @param {Object} [browser=null] - An existing Playwright browser instance to reuse.
 *   If null, a new browser is launched and closed after scraping.
 * @param {Object} [options={}] - Additional options
 * @param {number} [options.startedBy=0] - 0 = manual/interactive, 1 = scheduled/cron, 3 = test investments
 * @param {number} [options.attemptNumber=1] - Retry attempt counter (1-5)
 * @param {boolean} [options.testMode=false] - If true, skip writing to the live prices table.
 *   Scraping history is still recorded when startedBy=3 (test investments).
 * @param {string} [options.sourceTable="investments"] - Which table this investment comes from:
 *   "investments" or "test_investments". Used by the Fidelity fallback to write back
 *   the discovered factsheet URL to the correct table.
 * @returns {Promise<{success: boolean, investmentId: number, description: string, rawPrice: string, parsedPrice: number|null, isMinorUnit: boolean, priceMinorUnit: number|null, currency: string, error?: string, fallbackUsed?: boolean}>}
 */
export async function scrapeSingleInvestmentPrice(investment, browser = null, options = {}) {
  const startedBy = options.startedBy || 0;
  const attemptNumber = options.attemptNumber || 1;
  const testMode = options.testMode || false;
  const scrapeTime = options.scrapeTime || new Date().toTimeString().slice(0, 8);
  const sourceTable = options.sourceTable || "investments";
  // Record scraping history for live scrapes and test investment scrapes (startedBy=3),
  // but not for unit test mode where testMode=true and startedBy is 0 or 1.
  const recordHistory = !testMode || startedBy === 3;
  const result = {
    success: false,
    investmentId: investment.id,
    description: investment.description,
    rawPrice: "",
    parsedPrice: null,
    isMinorUnit: false,
    priceMinorUnit: null,
    currency: investment.currency_code || "",
    error: "",
    fallbackUsed: false,
  };

  // Resolve the scraping URL and selector. Priority:
  // 1. Manual investment_url (user override always wins)
  // 2. Auto-generated URL from public_id via FT Markets
  // 3. No URL available — skip
  let scrapeUrl = investment.investment_url || null;
  let scrapeSelector = investment.selector || null;
  let urlWasAutoGenerated = false;

  if (!scrapeUrl && investment.public_id) {
    scrapeUrl = buildFtMarketsUrl(investment.public_id, investment.currency_code);
    if (scrapeUrl) {
      scrapeSelector = getFtMarketsSelector();
      urlWasAutoGenerated = true;
    }
  }

  if (!scrapeUrl) {
    result.error = "No URL configured and no public ID available";
    if (recordHistory) {
      recordScrapingAttempt({
        scrapeType: "investment",
        referenceId: investment.id,
        startedBy: startedBy,
        attemptNumber: attemptNumber,
        success: false,
        errorCode: "NO_URL",
        errorMessage: result.error,
      });
    }
    return result;
  }

  // Look up selector from config if not provided in the investment record or auto-generated
  const selectorInfo = getSelector(scrapeUrl, scrapeSelector);

  if (!selectorInfo.selector) {
    result.error = "No CSS selector configured and URL does not match any known site";
    if (recordHistory) {
      recordScrapingAttempt({
        scrapeType: "investment",
        referenceId: investment.id,
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
    const context = await createStealthContext(browserInstance, scrapeUrl);
    page = await createStealthPage(context);

    // Navigate to the scraping URL using the wait strategy from site config
    await navigateTo(page, scrapeUrl, { waitUntil: waitStrategy });
    navigationSucceeded = true;

    // Capture page title for diagnostics
    try {
      pageTitle = await page.title();
    } catch {
      pageTitle = "(could not get title)";
    }

    // Wait for the selector to appear on the page (longer timeout for heavy JS sites)
    const selectorTimeout = waitStrategy === "networkidle" ? 45000 : 20000;
    const element = await page.waitForSelector(activeSelector, {
      timeout: selectorTimeout,
    });

    if (!element) {
      result.error = "Navigation OK. Selector not found on page. Page title: " + pageTitle;
      errorCode = "SELECTOR_NOT_FOUND";
    } else {
      // Extract the text content of the matched element
      const rawText = await element.textContent();
      result.rawPrice = rawText ? rawText.trim() : "";

      // Parse the price
      const parsed = parsePrice(result.rawPrice);
      result.parsedPrice = parsed.value;
      result.isMinorUnit = parsed.isMinorUnit;

      // FT Markets prices labelled "PRICE (GBP)" are in pounds, not pence.
      // The raw text is just a number (e.g. "3.83") with no currency indicator,
      // so parsePrice defaults to minor units. Override when the URL tells us
      // the price is in major units (GBP, USD, EUR — anything except GBX).
      if (scrapeUrl && scrapeUrl.includes("markets.ft.com") && parsed.isMinorUnit) {
        const ftCurrencyMatch = scrapeUrl.match(/[?&]s=[^:]+:([A-Z]+)/i);
        if (ftCurrencyMatch && ftCurrencyMatch[1].toUpperCase() !== "GBX") {
          result.isMinorUnit = false;
          parsed.isMinorUnit = false;
        }
      }

      if (parsed.value === null) {
        result.error = "Could not parse price from text: " + result.rawPrice;
        errorCode = "PARSE_ERROR";
      } else {
        result.priceMinorUnit = normaliseToMinorUnit(parsed.value, parsed.isMinorUnit);
        result.success = true;

        // Store the price in the database (skip in test mode)
        if (!testMode) {
          const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
          upsertPrice(investment.id, today, scrapeTime, result.priceMinorUnit);
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
      browserInstance = null; // Clear so fallback knows to launch its own
    }
  }

  // Record the primary scraping attempt in history
  if (recordHistory) {
    recordScrapingAttempt({
      scrapeType: "investment",
      referenceId: investment.id,
      startedBy: startedBy,
      attemptNumber: attemptNumber,
      success: result.success,
      errorCode: result.success ? null : errorCode,
      errorMessage: result.success ? null : result.error,
    });
  }

  // --- GBP/GBX alternate URL retry ---
  // FT Markets lists some UK funds under GBP and others under GBX (pence sterling).
  // When an auto-generated ISIN URL fails, retry with the alternate currency suffix
  // before falling back to Fidelity.
  if (!result.success && urlWasAutoGenerated) {
    const alternateUrl = buildFtMarketsAlternateUrl(investment.public_id, investment.currency_code);
    if (alternateUrl) {
      let altBrowser = browserInstance;
      const launchedAltBrowser = !altBrowser;
      let altPage = null;

      try {
        if (launchedAltBrowser) {
          altBrowser = await launchBrowser();
        }

        const altContext = await createStealthContext(altBrowser, alternateUrl);
        altPage = await createStealthPage(altContext);

        await navigateTo(altPage, alternateUrl, { waitUntil: "networkidle" });

        const altSelectorTimeout = 45000;
        const altElement = await altPage.waitForSelector(getFtMarketsSelector(), {
          timeout: altSelectorTimeout,
        });

        if (altElement) {
          const altRawText = await altElement.textContent();
          const altRaw = altRawText ? altRawText.trim() : "";
          const altParsed = parsePrice(altRaw);

          // Apply the same FT Markets GBP/GBX override as the primary scrape
          if (altParsed.isMinorUnit) {
            const altCurrencyMatch = alternateUrl.match(/[?&]s=[^:]+:([A-Z]+)/i);
            if (altCurrencyMatch && altCurrencyMatch[1].toUpperCase() !== "GBX") {
              altParsed.isMinorUnit = false;
            }
          }

          if (altParsed.value !== null) {
            result.success = true;
            result.rawPrice = altRaw;
            result.parsedPrice = altParsed.value;
            result.isMinorUnit = altParsed.isMinorUnit;
            result.priceMinorUnit = normaliseToMinorUnit(altParsed.value, altParsed.isMinorUnit);
            result.error = "";

            if (!testMode) {
              const today = new Date().toISOString().split("T")[0];
              upsertPrice(investment.id, today, scrapeTime, result.priceMinorUnit);
            }
          }
        }
      } catch {
        // Alternate URL also failed — continue to Fidelity fallback
      } finally {
        if (altPage) {
          try {
            await altPage.close();
          } catch {
            /* ignore */
          }
        }
        if (launchedAltBrowser && altBrowser) {
          try {
            await altBrowser.close();
          } catch {
            /* ignore */
          }
          browserInstance = null;
        }
      }
    }
  }

  // --- Fidelity fallback ---
  // If the primary source failed and the investment has an ISIN public_id,
  // try discovering the Fidelity factsheet URL and scraping the price from there.
  if (!result.success && investment.public_id && detectPublicIdType(investment.public_id) === "isin") {
    const primaryError = result.error;
    let fallbackBrowser = browserInstance;
    const launchedFallbackBrowser = !fallbackBrowser;

    try {
      if (launchedFallbackBrowser) {
        fallbackBrowser = await launchBrowser();
      }

      // Step 1: Search Fidelity to discover the factsheet URL
      const discovery = await scrapeFidelityFactsheetUrl(investment.public_id, fallbackBrowser);
      if (!discovery.success) {
        // Fallback discovery failed — keep the original error
        result.error = primaryError + " | Fidelity fallback also failed: " + discovery.error;
        return result;
      }

      const factsheetUrl = discovery.url;

      // Step 2: Scrape the price from the factsheet page
      const fidelitySelectorInfo = getSelector(factsheetUrl, null);
      if (!fidelitySelectorInfo.selector) {
        result.error = primaryError + " | Fidelity fallback: no selector for factsheet URL";
        return result;
      }

      let fallbackPage = null;
      try {
        const fallbackContext = await createStealthContext(fallbackBrowser, factsheetUrl);
        fallbackPage = await createStealthPage(fallbackContext);

        await navigateTo(fallbackPage, factsheetUrl, {
          waitUntil: fidelitySelectorInfo.waitStrategy || "networkidle",
        });

        const fallbackElement = await fallbackPage.waitForSelector(fidelitySelectorInfo.selector, {
          timeout: 30000,
        });

        if (!fallbackElement) {
          result.error = primaryError + " | Fidelity fallback: selector not found on factsheet page";
          return result;
        }

        const fallbackRawText = await fallbackElement.textContent();
        const fallbackRaw = fallbackRawText ? fallbackRawText.trim() : "";
        const fallbackParsed = parsePrice(fallbackRaw);

        if (fallbackParsed.value === null) {
          result.error = primaryError + " | Fidelity fallback: could not parse price from: " + fallbackRaw;
          return result;
        }

        // Fallback succeeded — update the result
        result.success = true;
        result.rawPrice = fallbackRaw;
        result.parsedPrice = fallbackParsed.value;
        result.isMinorUnit = fallbackParsed.isMinorUnit;
        result.priceMinorUnit = normaliseToMinorUnit(fallbackParsed.value, fallbackParsed.isMinorUnit);
        result.error = "";
        result.fallbackUsed = true;

        // Store the price in the database (skip in test mode)
        if (!testMode) {
          const today = new Date().toISOString().split("T")[0];
          upsertPrice(investment.id, today, scrapeTime, result.priceMinorUnit);
        }

        // Write the discovered factsheet URL back to the investment record
        // so subsequent scrapes go direct to Fidelity without the search step.
        // Selector is left null — the Fidelity config pattern match provides it.
        if (sourceTable === "test_investments") {
          updateTestInvestmentScrapingSource(investment.id, factsheetUrl, null);
        } else {
          updateInvestmentScrapingSource(investment.id, factsheetUrl, null);
        }
      } finally {
        if (fallbackPage) {
          try {
            await fallbackPage.close();
          } catch {
            // Ignore close errors
          }
        }
      }
    } catch (err) {
      result.error = primaryError + " | Fidelity fallback error: " + err.message;
    } finally {
      if (launchedFallbackBrowser && fallbackBrowser) {
        try {
          await fallbackBrowser.close();
        } catch {
          // Ignore close errors
        }
      }
    }
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
 * @description Scrape prices for all investments that have a URL and selector configured.
 * Always fetches currency rates first so that prices and exchange rates are
 * contemporaneous (within minutes of each other).
 *
 * Uses a single shared browser instance for efficiency. Includes random delays
 * between requests to avoid being rate-limited or blocked by target sites.
 * Delay durations depend on the active profile (interactive or cron) and whether
 * consecutive requests hit the same domain.
 *
 * @param {Function|null} [onProgress=null] - Optional callback called after each investment
 *   is scraped. Receives the price result object as its argument. Used by the SSE
 *   streaming endpoint to send incremental updates to the client.
 * @param {Object} [options={}] - Additional options
 * @param {number} [options.startedBy=0] - 0 = manual/interactive, 1 = scheduled/cron
 * @param {number} [options.attemptNumber=1] - Retry attempt counter (1-5)
 * @returns {Promise<{success: boolean, currencyRatesResult: Object, prices: Object[], message: string}>}
 */
export async function scrapeAllPrices(onProgress = null, options = {}) {
  const startedBy = options.startedBy || 0;
  const attemptNumber = options.attemptNumber || 1;
  const scrapeTime = options.scrapeTime || new Date().toTimeString().slice(0, 8);
  // Step 1: Fetch currency rates first (prices and rates must be contemporaneous)
  const currencyRatesResult = await fetchCurrencyRates({ scrapeTime: scrapeTime });

  // Step 2: Get all investments that can be scraped (have URL + selector from config or custom)
  const scrapeable = getScrapeableInvestments();

  if (scrapeable.length === 0) {
    return {
      success: true,
      currencyRatesResult: currencyRatesResult,
      prices: [],
      message: "No investments with URL and selector configured",
    };
  }

  // Step 3: Launch a shared browser and scrape each investment
  let browser = null;
  const prices = [];

  try {
    browser = await launchBrowser();
    let previousDomain = "";

    for (const investment of scrapeable) {
      // If the browser has crashed, relaunch before continuing
      if (!isBrowserAlive(browser)) {
        try {
          await browser.close();
        } catch {
          // Already dead — ignore
        }
        browser = await launchBrowser();
        previousDomain = ""; // Reset domain tracking after relaunch
      }

      // Random delay between requests to avoid rate-limiting/blocking
      // Use the resolved URL (manual URL or auto-generated from public_id) for domain comparison
      const effectiveUrl = investment.investment_url || buildFtMarketsUrl(investment.public_id, investment.currency_code) || "";
      const currentDomain = extractDomain(effectiveUrl);
      const delayMs = calculateDelay(previousDomain, currentDomain);
      if (delayMs > 0) {
        await sleep(delayMs);
      }

      const priceResult = await scrapeSingleInvestmentPrice(investment, browser, {
        startedBy: startedBy,
        attemptNumber: attemptNumber,
        scrapeTime: scrapeTime,
      });
      prices.push(priceResult);
      previousDomain = currentDomain;

      // Notify the caller after each investment is scraped
      if (onProgress) {
        onProgress(priceResult);
      }
    }
  } catch (err) {
    return {
      success: false,
      currencyRatesResult: currencyRatesResult,
      prices: prices,
      message: "Browser error during price scraping: " + err.message,
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

  const successCount = prices.filter(function (p) {
    return p.success;
  }).length;
  const failCount = prices.length - successCount;

  let message = "Scraped " + successCount + " of " + prices.length + " investment price" + (prices.length === 1 ? "" : "s");
  if (failCount > 0) {
    message += " (" + failCount + " failed)";
  }

  return {
    success: true,
    currencyRatesResult: currencyRatesResult,
    prices: prices,
    message: message,
  };
}

/**
 * @description Get the list of scrapeable investments.
 * An investment is scrapeable if it has:
 * - a URL AND either a custom selector or a URL that matches a known site, OR
 * - a public_id (ISIN or ticker) that can generate an FT Markets URL
 * Used by the SSE endpoint to send the investment list before scraping begins.
 * @returns {Object[]} Array of investment objects that can be scraped
 */
export function getScrapeableInvestments() {
  const allInvestments = getAllInvestments();
  return allInvestments.filter(function (inv) {
    // Option 1: has a manual URL with a resolvable selector
    if (inv.investment_url) {
      const selectorInfo = getSelector(inv.investment_url, inv.selector);
      return selectorInfo.selector !== null;
    }
    // Option 2: has a public_id that can generate an FT Markets URL
    if (inv.public_id) {
      return buildFtMarketsUrl(inv.public_id, inv.currency_code) !== null;
    }
    return false;
  });
}

/**
 * @description Resolve the effective scraping URL and CSS selector for an investment
 * without actually scraping. Follows the same priority logic as scrapeSingleInvestmentPrice:
 * 1. Manual investment_url (user override wins)
 * 2. Auto-generated URL from public_id via FT Markets
 * Then resolves the selector from the record or known site config.
 *
 * @param {Object} investment - Investment or test investment object with currency_code joined
 * @returns {{ url: string|null, selector: string|null, urlSource: string, selectorSource: string }}
 */
export function resolveScrapingConfig(investment) {
  let url = investment.investment_url || null;
  let urlSource = url ? "manual" : "";

  if (!url && investment.public_id) {
    url = buildFtMarketsUrl(investment.public_id, investment.currency_code);
    if (url) {
      urlSource = "auto-generated from Public ID";
    }
  }

  if (!url) {
    return { url: null, selector: null, urlSource: "none", selectorSource: "none" };
  }

  let selector = investment.selector || null;
  let selectorSource = selector ? "manual" : "";

  if (!selector && url) {
    const selectorInfo = getSelector(url, null);
    if (selectorInfo.selector) {
      selector = selectorInfo.selector;
      selectorSource = "matched from site config";
    }
  }

  if (!selectorSource) {
    selectorSource = "none";
  }

  return { url, selector, urlSource, selectorSource };
}

/**
 * @description Scrape the price for a single investment by its ID.
 * Does NOT fetch currency rates first (unlike scrapeAllPrices).
 * Use this for re-scraping an individual investment.
 *
 * @param {number} id - The investment ID
 * @param {Object} [options={}] - Additional options
 * @param {boolean} [options.testMode=false] - If true, skip database writes (for testing)
 * @returns {Promise<{success: boolean, price: Object|null, message: string, error?: string}>}
 */
export async function scrapePriceById(id, options = {}) {
  const testMode = options.testMode || false;
  const scrapeTime = options.scrapeTime || new Date().toTimeString().slice(0, 8);
  const investment = getInvestmentById(id);

  if (!investment) {
    return {
      success: false,
      price: null,
      message: "Investment not found",
      error: "No investment with ID " + id,
    };
  }

  const priceResult = await scrapeSingleInvestmentPrice(investment, null, { testMode: testMode, scrapeTime: scrapeTime });

  return {
    success: priceResult.success,
    price: priceResult,
    message: priceResult.success ? "Price scraped for " + investment.description : "Failed to scrape price for " + investment.description,
    error: priceResult.error || undefined,
  };
}

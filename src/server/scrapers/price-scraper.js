import { chromium } from "playwright";
import { getAllInvestments, getInvestmentById } from "../db/investments-db.js";
import { fetchCurrencyRates } from "./currency-scraper.js";
import { SCRAPE_DELAY_PROFILES, DEFAULT_SCRAPE_DELAY_PROFILE } from "../../shared/constants.js";

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
 * @description Scrape the current price for a single investment using Playwright.
 * Launches a headless Chromium browser, navigates to the investment URL,
 * waits for the CSS selector, and extracts the text content.
 *
 * @param {Object} investment - The investment object (from getAllInvestments or getInvestmentById)
 * @param {Object} [browser=null] - An existing Playwright browser instance to reuse.
 *   If null, a new browser is launched and closed after scraping.
 * @returns {Promise<{success: boolean, investmentId: number, description: string, rawPrice: string, parsedPrice: number|null, isMinorUnit: boolean, priceMinorUnit: number|null, currency: string, error?: string}>}
 */
export async function scrapeSingleInvestmentPrice(investment, browser = null) {
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
  };

  if (!investment.investment_url) {
    result.error = "No URL configured";
    return result;
  }

  if (!investment.selector) {
    result.error = "No CSS selector configured";
    return result;
  }

  const ownBrowser = browser === null;
  let browserInstance = browser;
  let page = null;

  try {
    if (ownBrowser) {
      browserInstance = await chromium.launch({ headless: true });
    }

    const context = await browserInstance.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    page = await context.newPage();

    // Navigate to the investment URL with a reasonable timeout
    await page.goto(investment.investment_url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Wait for the selector to appear on the page
    const element = await page.waitForSelector(investment.selector, {
      timeout: 15000,
    });

    if (!element) {
      result.error = "CSS selector not found on page";
      return result;
    }

    // Extract the text content of the matched element
    const rawText = await element.textContent();
    result.rawPrice = rawText ? rawText.trim() : "";

    // Parse the price
    const parsed = parsePrice(result.rawPrice);
    result.parsedPrice = parsed.value;
    result.isMinorUnit = parsed.isMinorUnit;

    if (parsed.value === null) {
      result.error = "Could not parse price from text: " + result.rawPrice;
      return result;
    }

    result.priceMinorUnit = normaliseToMinorUnit(parsed.value, parsed.isMinorUnit);
    result.success = true;
    return result;
  } catch (err) {
    result.error = err.message;
    return result;
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
 * @returns {Promise<{success: boolean, currencyRatesResult: Object, prices: Object[], message: string}>}
 */
export async function scrapeAllPrices(onProgress = null) {
  // Step 1: Fetch currency rates first (prices and rates must be contemporaneous)
  const currencyRatesResult = await fetchCurrencyRates();

  // Step 2: Get all investments with URL and selector
  const allInvestments = getAllInvestments();
  const scrapeable = allInvestments.filter(function (inv) {
    return inv.investment_url && inv.selector;
  });

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
    browser = await chromium.launch({ headless: true });
    let previousDomain = "";

    for (const investment of scrapeable) {
      // Random delay between requests to avoid rate-limiting/blocking
      const currentDomain = extractDomain(investment.investment_url);
      const delayMs = calculateDelay(previousDomain, currentDomain);
      if (delayMs > 0) {
        await sleep(delayMs);
      }

      const priceResult = await scrapeSingleInvestmentPrice(investment, browser);
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
 * @description Get the list of scrapeable investments (those with URL and selector).
 * Used by the SSE endpoint to send the investment list before scraping begins.
 * @returns {Object[]} Array of investment objects that have investment_url and selector
 */
export function getScrapeableInvestments() {
  const allInvestments = getAllInvestments();
  return allInvestments.filter(function (inv) {
    return inv.investment_url && inv.selector;
  });
}

/**
 * @description Scrape the price for a single investment by its ID.
 * Does NOT fetch currency rates first (unlike scrapeAllPrices).
 * Use this for re-scraping an individual investment.
 *
 * @param {number} id - The investment ID
 * @returns {Promise<{success: boolean, price: Object|null, message: string, error?: string}>}
 */
export async function scrapePriceById(id) {
  const investment = getInvestmentById(id);

  if (!investment) {
    return {
      success: false,
      price: null,
      message: "Investment not found",
      error: "No investment with ID " + id,
    };
  }

  const priceResult = await scrapeSingleInvestmentPrice(investment);

  return {
    success: priceResult.success,
    price: priceResult,
    message: priceResult.success ? "Price scraped for " + investment.description : "Failed to scrape price for " + investment.description,
    error: priceResult.error || undefined,
  };
}

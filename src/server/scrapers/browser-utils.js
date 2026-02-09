import { chromium } from "playwright";

/**
 * @description Google consent cookie value. This cookie indicates that the user
 * has accepted Google's cookie consent, bypassing the "Before you continue" page.
 * @type {string}
 */
const GOOGLE_CONSENT_COOKIE_VALUE = "CAISHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzIaAmVuIAEaBgiA_LSmBg";

/**
 * @description Sites that require networkidle wait condition due to heavy JavaScript.
 * These sites don't render their content until JS completes loading.
 * @type {string[]}
 */
const HEAVY_JS_SITES = ["msci.com"];

/**
 * @description Launch a Chromium browser with anti-bot detection settings.
 * Disables automation detection features that sites use to block scrapers.
 * @returns {Promise<import('playwright').Browser>} The launched browser instance
 */
export async function launchBrowser() {
  return await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });
}

/**
 * @description Create a browser context with anti-bot detection bypasses.
 * Sets up a realistic user agent, locale, viewport, and removes webdriver detection.
 * Also pre-sets Google consent cookies for google.com domains.
 *
 * @param {import('playwright').Browser} browser - The browser instance
 * @param {string} [targetUrl=""] - The URL being scraped (used to set domain-specific cookies)
 * @returns {Promise<import('playwright').BrowserContext>} The configured browser context
 */
export async function createStealthContext(browser, targetUrl = "") {
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "en-GB",
    viewport: { width: 1920, height: 1080 },
    extraHTTPHeaders: {
      "Accept-Language": "en-GB,en;q=0.9",
    },
  });

  // Pre-set Google consent cookie if targeting google.com
  if (targetUrl && targetUrl.includes("google.com")) {
    await context.addCookies([
      {
        name: "SOCS",
        value: GOOGLE_CONSENT_COOKIE_VALUE,
        domain: ".google.com",
        path: "/",
      },
    ]);
  }

  return context;
}

/**
 * @description Create a page with anti-bot detection scripts.
 * Removes the webdriver property that sites use to detect Playwright/Puppeteer.
 *
 * @param {import('playwright').BrowserContext} context - The browser context
 * @returns {Promise<import('playwright').Page>} The configured page
 */
export async function createStealthPage(context) {
  const page = await context.newPage();

  // Remove webdriver property that sites use to detect automation
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  return page;
}

/**
 * @description Check if a URL belongs to a site that requires networkidle wait condition.
 * @param {string} url - The URL to check
 * @returns {boolean} True if the site requires networkidle
 */
export function isHeavyJsSite(url) {
  if (!url) return false;
  const lowerUrl = url.toLowerCase();
  return HEAVY_JS_SITES.some(function (site) {
    return lowerUrl.includes(site);
  });
}

/**
 * @description Get the recommended navigation options for a URL.
 * Heavy JS sites use networkidle and longer timeouts.
 * @param {string} url - The URL to navigate to
 * @returns {{waitUntil: string, timeout: number}} Navigation options
 */
export function getNavigationOptions(url) {
  if (isHeavyJsSite(url)) {
    return {
      waitUntil: "networkidle",
      timeout: 60000,
    };
  }
  return {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  };
}

/**
 * @description Check whether a Playwright browser instance is still usable.
 * When the underlying Chromium process crashes or the connection drops,
 * the browser object still exists but all operations on it will throw
 * "Target page, context or browser has been closed". This check detects
 * that state so callers can relaunch.
 * @param {import('playwright').Browser} browser - The browser instance to check
 * @returns {boolean} True if the browser is connected and usable
 */
export function isBrowserAlive(browser) {
  return browser && browser.isConnected();
}

/**
 * @description Navigate to a URL with appropriate settings for the target site.
 * Automatically detects heavy JS sites and uses networkidle for them.
 *
 * @param {import('playwright').Page} page - The page instance
 * @param {string} url - The URL to navigate to
 * @param {Object} [options={}] - Optional overrides
 * @param {number} [options.timeout] - Override timeout in ms
 * @param {string} [options.waitUntil] - Override wait condition
 * @returns {Promise<import('playwright').Response>} The navigation response
 */
export async function navigateTo(page, url, options = {}) {
  const defaults = getNavigationOptions(url);
  const waitUntil = options.waitUntil || defaults.waitUntil;
  // Use a longer timeout for networkidle (even if the URL isn't in HEAVY_JS_SITES)
  const defaultTimeout = waitUntil === "networkidle" ? 60000 : defaults.timeout;
  const timeout = options.timeout || defaultTimeout;

  return await page.goto(url, {
    waitUntil: waitUntil,
    timeout: timeout,
  });
}

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
 * @description Pool of recent Chrome user agent strings across Windows 10/11.
 * A random UA is chosen for each browser context to reduce fingerprinting.
 * Keep this list updated periodically with current Chrome major versions.
 * @type {Array<{ua: string, major: string, platform: string}>}
 */
const UA_POOL = [
  { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", major: "131", platform: "Windows" },
  { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36", major: "130", platform: "Windows" },
  { ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36", major: "129", platform: "Windows" },
  { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", major: "131", platform: "macOS" },
  { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36", major: "130", platform: "macOS" },
  { ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", major: "131", platform: "Linux" },
];

/**
 * @description Pick a random entry from the UA pool.
 * @returns {{ua: string, major: string, platform: string}}
 */
function pickRandomUA() {
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
}

/**
 * @description Build the Sec-CH-UA header value matching a Chrome major version.
 * Real Chrome sends three brands: "Not A(Brand" (decoy), "Chromium", and "Google Chrome".
 * @param {string} major - The Chrome major version number
 * @returns {string} The Sec-CH-UA header value
 */
function buildSecChUa(major) {
  return '"Chromium";v="' + major + '", "Not A(Brand";v="99", "Google Chrome";v="' + major + '"';
}

/**
 * @description Map of known scraping target domains to realistic referer values.
 * A real user typically arrives from Google search or the site's homepage.
 * @type {Object.<string, string>}
 */
const REFERER_MAP = {
  "markets.ft.com": "https://www.google.co.uk/",
  "www.fidelity.co.uk": "https://www.google.co.uk/",
  "www.morningstar.co.uk": "https://www.google.co.uk/",
  "tools.morningstar.co.uk": "https://www.morningstar.co.uk/",
};

/**
 * @description Get a realistic referer for a target URL based on its domain.
 * Falls back to Google UK if the domain is not in the map.
 * @param {string} url - The target URL
 * @returns {string} A referer URL
 */
function getReferer(url) {
  if (!url) return "https://www.google.co.uk/";
  try {
    const hostname = new URL(url).hostname;
    return REFERER_MAP[hostname] || "https://www.google.co.uk/";
  } catch {
    return "https://www.google.co.uk/";
  }
}

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
 * Uses a randomly selected user agent from the pool, sets matching Sec-CH-UA
 * headers, a realistic referer, and standard browser headers that real Chrome
 * sends. Also pre-sets Google consent cookies for google.com domains.
 *
 * @param {import('playwright').Browser} browser - The browser instance
 * @param {string} [targetUrl=""] - The URL being scraped (used to set domain-specific cookies and referer)
 * @returns {Promise<import('playwright').BrowserContext>} The configured browser context
 */
export async function createStealthContext(browser, targetUrl = "") {
  const chosen = pickRandomUA();
  const referer = getReferer(targetUrl);

  const context = await browser.newContext({
    userAgent: chosen.ua,
    locale: "en-GB",
    viewport: { width: 1920, height: 1080 },
    extraHTTPHeaders: {
      "Accept-Language": "en-GB,en;q=0.9",
      "Sec-CH-UA": buildSecChUa(chosen.major),
      "Sec-CH-UA-Mobile": "?0",
      "Sec-CH-UA-Platform": '"' + chosen.platform + '"',
      "Sec-Fetch-Site": "cross-site",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
      Referer: referer,
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

  // Pre-set FT cookie consent to skip the cookie banner
  if (targetUrl && targetUrl.includes("ft.com")) {
    await context.addCookies([
      {
        name: "FTConsent",
        value: "true",
        domain: ".ft.com",
        path: "/",
      },
    ]);
  }

  return context;
}

/**
 * @description Create a page with anti-bot detection scripts.
 * Patches multiple JavaScript properties that sites use to detect
 * Playwright/Puppeteer automation: webdriver flag, plugins array,
 * languages, chrome.runtime, permissions, and WebGL renderer.
 *
 * @param {import('playwright').BrowserContext} context - The browser context
 * @returns {Promise<import('playwright').Page>} The configured page
 */
export async function createStealthPage(context) {
  const page = await context.newPage();

  await page.addInitScript(() => {
    // 1. Remove webdriver flag
    Object.defineProperty(navigator, "webdriver", { get: () => false });

    // 2. Fake plugins array — real Chrome always has at least these
    Object.defineProperty(navigator, "plugins", {
      get: () => {
        const plugins = [
          { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer", description: "Portable Document Format" },
          { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai", description: "" },
          { name: "Native Client", filename: "internal-nacl-plugin", description: "" },
        ];
        plugins.length = 3;
        return plugins;
      },
    });

    // 3. Fake languages — must be consistent with Accept-Language header
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-GB", "en"],
    });

    // 4. Fake chrome.runtime — real Chrome always has this object
    if (!window.chrome) {
      window.chrome = {};
    }
    if (!window.chrome.runtime) {
      window.chrome.runtime = {
        connect: function () {},
        sendMessage: function () {},
      };
    }

    // 5. Fake permissions query — Playwright returns "denied" for notifications
    // by default, real Chrome returns "prompt" for fresh profiles
    const originalQuery = window.Notification && Notification.permission;
    if (originalQuery === "denied") {
      Object.defineProperty(Notification, "permission", { get: () => "default" });
    }

    // 6. Patch WebGL renderer — Playwright's headless Chromium exposes
    // "Google SwiftShader" which is a known headless indicator.
    // Override to report a common integrated GPU instead.
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (param) {
      // UNMASKED_VENDOR_WEBGL
      if (param === 0x9245) return "Google Inc. (Intel)";
      // UNMASKED_RENDERER_WEBGL
      if (param === 0x9246) return "ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.5)";
      return getParameter.call(this, param);
    };

    // Same for WebGL2
    if (typeof WebGL2RenderingContext !== "undefined") {
      const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function (param) {
        if (param === 0x9245) return "Google Inc. (Intel)";
        if (param === 0x9246) return "ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.5)";
        return getParameter2.call(this, param);
      };
    }
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

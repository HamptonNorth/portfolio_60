import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * @description Tests for the central config loader (src/server/config.js).
 * Uses temporary config files to test various scenarios without
 * modifying the real config.json.
 */

const TEMP_DIR = resolve("data/portfolio_60_test");
const TEMP_CONFIG_PATH = resolve(TEMP_DIR, "test-config.json");

/** @type {Function} */
let loadConfig;
/** @type {Function} */
let getSchedulingConfig;
/** @type {Function} */
let getRetryConfig;
/** @type {Function} */
let getScrapeDelayProfile;
/** @type {Function} */
let getAllowedProviders;
/** @type {Function} */
let reloadConfig;
/** @type {Function} */
let setConfigPath;
/** @type {Function} */
let loadSiteConfigs;
/** @type {Function} */
let clearSiteCache;
/** @type {Function} */
let findSiteConfig;
/** @type {Function} */
let getSelector;
/** @type {Function} */
let getAllSiteConfigs;
/** @type {Function} */
let isKnownSite;

beforeAll(async function () {
  // Ensure temp directory exists
  if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true });
  }

  // Import the config module
  const configModule = await import("../../src/server/config.js");
  loadConfig = configModule.loadConfig;
  getSchedulingConfig = configModule.getSchedulingConfig;
  getRetryConfig = configModule.getRetryConfig;
  getScrapeDelayProfile = configModule.getScrapeDelayProfile;
  getAllowedProviders = configModule.getAllowedProviders;
  reloadConfig = configModule.reloadConfig;
  setConfigPath = configModule.setConfigPath;
  loadSiteConfigs = configModule.loadSiteConfigs;
  clearSiteCache = configModule.clearSiteCache;
  findSiteConfig = configModule.findSiteConfig;
  getSelector = configModule.getSelector;
  getAllSiteConfigs = configModule.getAllSiteConfigs;
  isKnownSite = configModule.isKnownSite;
});

afterAll(function () {
  // Clean up temp files
  if (existsSync(TEMP_CONFIG_PATH)) {
    unlinkSync(TEMP_CONFIG_PATH);
  }
  // Reset config path to default
  setConfigPath(null);
});

beforeEach(function () {
  // Reset config cache and path before each test
  setConfigPath(null);
  reloadConfig();
});

/**
 * @description Write a temporary config file with the given content.
 * @param {Object} content - Config object to write as JSON
 */
function writeTestConfig(content) {
  writeFileSync(TEMP_CONFIG_PATH, JSON.stringify(content, null, 2));
  setConfigPath(TEMP_CONFIG_PATH);
}

describe("loadConfig — complete valid config", function () {
  test("returns all keys when config is fully populated", function () {
    writeTestConfig({
      allowed_providers: [{ code: "ii", name: "Interactive Investor" }],
      scheduling: {
        enabled: true,
        cron: "0 9 * * 1",
        runOnStartupIfMissed: false,
        startupDelayMinutes: 5,
      },
      retry: {
        delayMinutes: 10,
        maxAttempts: 3,
      },
      scrapeDelayProfile: "interactive",
    });

    const config = loadConfig();

    expect(config.allowed_providers).toHaveLength(1);
    expect(config.allowed_providers[0].code).toBe("ii");
    expect(config.scheduling.enabled).toBe(true);
    expect(config.scheduling.cron).toBe("0 9 * * 1");
    expect(config.scheduling.runOnStartupIfMissed).toBe(false);
    expect(config.scheduling.startupDelayMinutes).toBe(5);
    expect(config.retry.delayMinutes).toBe(10);
    expect(config.retry.maxAttempts).toBe(3);
    expect(config.scrapeDelayProfile).toBe("interactive");
  });
});

describe("loadConfig — defaults for missing keys", function () {
  test("applies defaults when config is empty object", function () {
    writeTestConfig({});

    const config = loadConfig();

    expect(Array.isArray(config.allowed_providers)).toBe(true);
    expect(config.allowed_providers).toHaveLength(0);
    expect(config.scheduling.enabled).toBe(false);
    expect(config.scheduling.cron).toBe("0 8 * * 6");
    expect(config.scheduling.runOnStartupIfMissed).toBe(true);
    expect(config.scheduling.startupDelayMinutes).toBe(10);
    expect(config.retry.delayMinutes).toBe(5);
    expect(config.retry.maxAttempts).toBe(5);
    expect(config.scrapeDelayProfile).toBe("cron");
  });

  test("applies defaults for missing scheduling sub-keys", function () {
    writeTestConfig({
      scheduling: { enabled: true },
    });

    const config = loadConfig();

    expect(config.scheduling.enabled).toBe(true);
    expect(config.scheduling.cron).toBe("0 8 * * 6");
    expect(config.scheduling.runOnStartupIfMissed).toBe(true);
    expect(config.scheduling.startupDelayMinutes).toBe(10);
  });

  test("applies defaults for missing retry sub-keys", function () {
    writeTestConfig({
      retry: {},
    });

    const config = loadConfig();

    expect(config.retry.delayMinutes).toBe(5);
    expect(config.retry.maxAttempts).toBe(5);
  });
});

describe("loadConfig — invalid values replaced with defaults", function () {
  test("replaces non-boolean scheduling.enabled with default", function () {
    writeTestConfig({
      scheduling: { enabled: "yes" },
    });

    const config = loadConfig();
    expect(config.scheduling.enabled).toBe(false);
  });

  test("replaces empty string cron with default", function () {
    writeTestConfig({
      scheduling: { cron: "  " },
    });

    const config = loadConfig();
    expect(config.scheduling.cron).toBe("0 8 * * 6");
  });

  test("replaces negative startupDelayMinutes with default", function () {
    writeTestConfig({
      scheduling: { startupDelayMinutes: -5 },
    });

    const config = loadConfig();
    expect(config.scheduling.startupDelayMinutes).toBe(10);
  });

  test("replaces zero delayMinutes with default", function () {
    writeTestConfig({
      retry: { delayMinutes: 0 },
    });

    const config = loadConfig();
    expect(config.retry.delayMinutes).toBe(5);
  });

  test("replaces negative delayMinutes with default", function () {
    writeTestConfig({
      retry: { delayMinutes: -3 },
    });

    const config = loadConfig();
    expect(config.retry.delayMinutes).toBe(5);
  });

  test("replaces maxAttempts below 1 with default", function () {
    writeTestConfig({
      retry: { maxAttempts: 0 },
    });

    const config = loadConfig();
    expect(config.retry.maxAttempts).toBe(5);
  });

  test("replaces maxAttempts above 10 with default", function () {
    writeTestConfig({
      retry: { maxAttempts: 15 },
    });

    const config = loadConfig();
    expect(config.retry.maxAttempts).toBe(5);
  });

  test("replaces non-integer maxAttempts with default", function () {
    writeTestConfig({
      retry: { maxAttempts: 3.5 },
    });

    const config = loadConfig();
    expect(config.retry.maxAttempts).toBe(5);
  });

  test("replaces invalid scrapeDelayProfile with default", function () {
    writeTestConfig({
      scrapeDelayProfile: "fast",
    });

    const config = loadConfig();
    expect(config.scrapeDelayProfile).toBe("cron");
  });

  test("replaces non-array allowed_providers with default", function () {
    writeTestConfig({
      allowed_providers: "not an array",
    });

    const config = loadConfig();
    expect(Array.isArray(config.allowed_providers)).toBe(true);
    expect(config.allowed_providers).toHaveLength(0);
  });
});

describe("loadConfig — missing config file", function () {
  test("uses all defaults when config file does not exist", function () {
    setConfigPath(resolve(TEMP_DIR, "nonexistent-config.json"));

    const config = loadConfig();

    expect(config.scheduling.enabled).toBe(false);
    expect(config.scheduling.cron).toBe("0 8 * * 6");
    expect(config.retry.delayMinutes).toBe(5);
    expect(config.retry.maxAttempts).toBe(5);
    expect(config.scrapeDelayProfile).toBe("cron");
  });
});

describe("loadConfig — caching", function () {
  test("returns cached result on second call", function () {
    writeTestConfig({
      scheduling: { enabled: true },
    });

    const config1 = loadConfig();
    expect(config1.scheduling.enabled).toBe(true);

    // Overwrite the file with different content
    writeFileSync(TEMP_CONFIG_PATH, JSON.stringify({ scheduling: { enabled: false } }));

    // Should still return cached value
    const config2 = loadConfig();
    expect(config2.scheduling.enabled).toBe(true);
  });
});

describe("reloadConfig", function () {
  test("clears cache so next loadConfig reads fresh data", function () {
    writeTestConfig({
      scheduling: { enabled: true },
    });

    const config1 = loadConfig();
    expect(config1.scheduling.enabled).toBe(true);

    // Overwrite and reload
    writeFileSync(TEMP_CONFIG_PATH, JSON.stringify({ scheduling: { enabled: false } }));
    reloadConfig();

    const config2 = loadConfig();
    expect(config2.scheduling.enabled).toBe(false);
  });
});

describe("getSchedulingConfig", function () {
  test("returns validated scheduling object", function () {
    writeTestConfig({
      scheduling: {
        enabled: true,
        cron: "30 7 * * 1-5",
        runOnStartupIfMissed: false,
        startupDelayMinutes: 2,
      },
    });

    const scheduling = getSchedulingConfig();

    expect(scheduling.enabled).toBe(true);
    expect(scheduling.cron).toBe("30 7 * * 1-5");
    expect(scheduling.runOnStartupIfMissed).toBe(false);
    expect(scheduling.startupDelayMinutes).toBe(2);
  });
});

describe("getRetryConfig", function () {
  test("returns validated retry object", function () {
    writeTestConfig({
      retry: { delayMinutes: 8, maxAttempts: 4 },
    });

    const retry = getRetryConfig();

    expect(retry.delayMinutes).toBe(8);
    expect(retry.maxAttempts).toBe(4);
  });
});

describe("getScrapeDelayProfile", function () {
  test("returns 'interactive' when set", function () {
    writeTestConfig({
      scrapeDelayProfile: "interactive",
    });

    expect(getScrapeDelayProfile()).toBe("interactive");
  });

  test("returns 'cron' when set", function () {
    writeTestConfig({
      scrapeDelayProfile: "cron",
    });

    expect(getScrapeDelayProfile()).toBe("cron");
  });
});

describe("getAllowedProviders", function () {
  test("returns provider array from config", function () {
    writeTestConfig({
      allowed_providers: [
        { code: "hl", name: "Hargreaves Lansdown" },
        { code: "aj", name: "AJ Bell" },
      ],
    });

    const providers = getAllowedProviders();

    expect(providers).toHaveLength(2);
    expect(providers[0].code).toBe("hl");
    expect(providers[1].code).toBe("aj");
  });
});

describe("loadConfig — startupDelayMinutes zero is valid", function () {
  test("accepts zero as a valid startupDelayMinutes", function () {
    writeTestConfig({
      scheduling: { startupDelayMinutes: 0 },
    });

    const config = loadConfig();
    expect(config.scheduling.startupDelayMinutes).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Scraper site configuration tests
// ---------------------------------------------------------------------------

/** @description Sample site data used across scraper-sites tests. */
const TEST_SITES = [
  {
    pattern: "google.com/finance",
    name: "Google Finance",
    selector: ".fxKbKc",
    waitStrategy: "domcontentloaded",
    notes: "Test site",
  },
  {
    pattern: "morningstar.co.uk",
    name: "Morningstar UK",
    selector: "div.last-price",
    waitStrategy: "networkidle",
  },
];

/**
 * @description Write a test config with scraperSites data.
 * @param {Object[]} sites - Array of site config objects
 */
function writeTestConfigWithSites(sites) {
  writeTestConfig({
    scraperSites: {
      _readme: "Test readme",
      _format: { pattern: "test format" },
      sites: sites,
    },
  });
}

describe("loadConfig — scraperSites defaults", function () {
  test("defaults to empty sites array when scraperSites is missing", function () {
    writeTestConfig({});

    const config = loadConfig();

    expect(config.scraperSites).toBeDefined();
    expect(Array.isArray(config.scraperSites.sites)).toBe(true);
    expect(config.scraperSites.sites).toHaveLength(0);
  });

  test("defaults to empty sites array when scraperSites.sites is not an array", function () {
    writeTestConfig({
      scraperSites: { sites: "not an array" },
    });

    const config = loadConfig();

    expect(Array.isArray(config.scraperSites.sites)).toBe(true);
    expect(config.scraperSites.sites).toHaveLength(0);
  });

  test("preserves _readme and _format metadata", function () {
    writeTestConfig({
      scraperSites: {
        _readme: "My custom readme",
        _format: { pattern: "some format" },
        sites: [],
      },
    });

    const config = loadConfig();

    expect(config.scraperSites._readme).toBe("My custom readme");
    expect(config.scraperSites._format.pattern).toBe("some format");
  });
});

describe("loadSiteConfigs", function () {
  test("returns sites array from config", function () {
    writeTestConfigWithSites(TEST_SITES);

    const sites = loadSiteConfigs();

    expect(sites).toHaveLength(2);
    expect(sites[0].name).toBe("Google Finance");
    expect(sites[1].name).toBe("Morningstar UK");
  });

  test("returns empty array when no sites configured", function () {
    writeTestConfig({});

    const sites = loadSiteConfigs();

    expect(Array.isArray(sites)).toBe(true);
    expect(sites).toHaveLength(0);
  });
});

describe("findSiteConfig", function () {
  test("returns matching site for a known URL", function () {
    writeTestConfigWithSites(TEST_SITES);

    const result = findSiteConfig("https://www.google.com/finance/quote/AAPL:NASDAQ");

    expect(result).not.toBeNull();
    expect(result.name).toBe("Google Finance");
    expect(result.selector).toBe(".fxKbKc");
  });

  test("returns null for an unknown URL", function () {
    writeTestConfigWithSites(TEST_SITES);

    const result = findSiteConfig("https://example.com/prices");

    expect(result).toBeNull();
  });

  test("returns null for empty URL", function () {
    writeTestConfigWithSites(TEST_SITES);

    expect(findSiteConfig("")).toBeNull();
    expect(findSiteConfig(null)).toBeNull();
    expect(findSiteConfig(undefined)).toBeNull();
  });

  test("matches case-insensitively", function () {
    writeTestConfigWithSites(TEST_SITES);

    const result = findSiteConfig("https://GOOGLE.COM/FINANCE/quote/TSLA");

    expect(result).not.toBeNull();
    expect(result.name).toBe("Google Finance");
  });

  test("strips www prefix before matching", function () {
    writeTestConfigWithSites(TEST_SITES);

    const result = findSiteConfig("https://www.morningstar.co.uk/funds/abc");

    expect(result).not.toBeNull();
    expect(result.name).toBe("Morningstar UK");
  });

  test("strips protocol before matching", function () {
    writeTestConfigWithSites(TEST_SITES);

    const result = findSiteConfig("http://google.com/finance/quote/AAPL");

    expect(result).not.toBeNull();
    expect(result.name).toBe("Google Finance");
  });
});

describe("getSelector", function () {
  test("returns config selector when URL matches known site", function () {
    writeTestConfigWithSites(TEST_SITES);

    const result = getSelector("https://google.com/finance/quote/AAPL", null);

    expect(result.selector).toBe(".fxKbKc");
    expect(result.source).toBe("config");
    expect(result.siteName).toBe("Google Finance");
    expect(result.waitStrategy).toBe("domcontentloaded");
  });

  test("returns custom selector when provided, even if URL matches", function () {
    writeTestConfigWithSites(TEST_SITES);

    const result = getSelector("https://google.com/finance/quote/AAPL", ".my-custom-selector");

    expect(result.selector).toBe(".my-custom-selector");
    expect(result.source).toBe("custom");
    expect(result.siteName).toBe("Google Finance");
  });

  test("returns none when URL does not match and no custom selector", function () {
    writeTestConfigWithSites(TEST_SITES);

    const result = getSelector("https://example.com/prices", null);

    expect(result.selector).toBeNull();
    expect(result.source).toBe("none");
    expect(result.siteName).toBeNull();
  });

  test("includes waitStrategy from matched site", function () {
    writeTestConfigWithSites(TEST_SITES);

    const result = getSelector("https://morningstar.co.uk/funds/abc", null);

    expect(result.waitStrategy).toBe("networkidle");
  });

  test("defaults waitStrategy to domcontentloaded when not specified", function () {
    writeTestConfig({
      scraperSites: {
        sites: [{ pattern: "example.com", name: "Example", selector: ".price" }],
      },
    });

    const result = getSelector("https://example.com/page", null);

    expect(result.waitStrategy).toBe("domcontentloaded");
  });
});

describe("getAllSiteConfigs", function () {
  test("returns same result as loadSiteConfigs", function () {
    writeTestConfigWithSites(TEST_SITES);

    const all = getAllSiteConfigs();
    const loaded = loadSiteConfigs();

    expect(all).toEqual(loaded);
    expect(all).toHaveLength(2);
  });
});

describe("isKnownSite", function () {
  test("returns true for matching URL", function () {
    writeTestConfigWithSites(TEST_SITES);

    expect(isKnownSite("https://google.com/finance/quote/AAPL")).toBe(true);
  });

  test("returns false for non-matching URL", function () {
    writeTestConfigWithSites(TEST_SITES);

    expect(isKnownSite("https://example.com/prices")).toBe(false);
  });
});

describe("clearSiteCache", function () {
  test("forces reload on next access", function () {
    writeTestConfigWithSites(TEST_SITES);

    const before = loadSiteConfigs();
    expect(before).toHaveLength(2);

    // Overwrite with different sites
    writeFileSync(
      TEMP_CONFIG_PATH,
      JSON.stringify({
        scraperSites: {
          sites: [{ pattern: "newsite.com", name: "New Site", selector: ".new" }],
        },
      }),
    );

    // Should still return cached (2 sites)
    expect(loadSiteConfigs()).toHaveLength(2);

    // After clearing, should pick up new data
    clearSiteCache();
    expect(loadSiteConfigs()).toHaveLength(1);
    expect(loadSiteConfigs()[0].name).toBe("New Site");
  });
});

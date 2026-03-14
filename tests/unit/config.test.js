import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * @description Tests for the central config loader (src/server/config.js).
 * Uses temporary config files to test various scenarios without
 * modifying the real user-settings.json.
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
let getFetchDelayProfile;
/** @type {Function} */
let getAllowedProviders;
/** @type {Function} */
let reloadConfig;
/** @type {Function} */
let setConfigPath;

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
  getFetchDelayProfile = configModule.getFetchDelayProfile;
  getAllowedProviders = configModule.getAllowedProviders;
  reloadConfig = configModule.reloadConfig;
  setConfigPath = configModule.setConfigPath;
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
      fetchDelayProfile: "interactive",
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
    expect(config.fetchDelayProfile).toBe("interactive");
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
    expect(config.fetchDelayProfile).toBe("cron");
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

  test("replaces invalid fetchDelayProfile with default", function () {
    writeTestConfig({
      fetchDelayProfile: "fast",
    });

    const config = loadConfig();
    expect(config.fetchDelayProfile).toBe("cron");
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
    expect(config.fetchDelayProfile).toBe("cron");
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

describe("getFetchDelayProfile", function () {
  test("returns 'interactive' when set", function () {
    writeTestConfig({
      fetchDelayProfile: "interactive",
    });

    expect(getFetchDelayProfile()).toBe("interactive");
  });

  test("returns 'cron' when set", function () {
    writeTestConfig({
      fetchDelayProfile: "cron",
    });

    expect(getFetchDelayProfile()).toBe("cron");
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


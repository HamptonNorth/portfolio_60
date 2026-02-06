import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { existsSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * @description Tests for the scheduled scraper service
 * (src/server/services/scheduled-scraper.js).
 *
 * Tests the scheduler initialisation, status reporting, missed-scrape
 * detection, and shutdown behaviour. Uses a test database and a temporary
 * config file to control scheduling settings.
 *
 * Note: We cannot easily mock Croner or the scraping service in ES module
 * imports, so these tests focus on the public API behaviour with real
 * Croner instances (using paused/disabled config to avoid triggering
 * actual scrapes during tests).
 */

const testDbPath = resolve("data/portfolio_60_test/test-scheduled-scraper.db");
const TEMP_DIR = resolve("data/portfolio_60_test");
const TEMP_CONFIG_PATH = resolve(TEMP_DIR, "test-scheduled-scraper-config.json");

// Set DB_PATH before importing database modules
process.env.DB_PATH = testDbPath;

import { createDatabase, closeDatabase } from "../../src/server/db/connection.js";
import { setConfigPath, reloadConfig } from "../../src/server/config.js";
import {
  initScheduledScraper,
  stopScheduledScraper,
  getSchedulerStatus,
} from "../../src/server/services/scheduled-scraper.js";

/**
 * @description Remove the test database files.
 */
function cleanupDatabase() {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    const filePath = testDbPath + suffix;
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }
}

/**
 * @description Write a temporary config file.
 * @param {Object} config - Config object to write
 */
function writeTestConfig(config) {
  writeFileSync(TEMP_CONFIG_PATH, JSON.stringify(config, null, 2));
  setConfigPath(TEMP_CONFIG_PATH);
  reloadConfig();
}

beforeAll(function () {
  if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true });
  }
  cleanupDatabase();
  createDatabase();
});

afterAll(function () {
  stopScheduledScraper();
  if (existsSync(TEMP_CONFIG_PATH)) {
    unlinkSync(TEMP_CONFIG_PATH);
  }
  setConfigPath(null);
  reloadConfig();
  cleanupDatabase();
  delete process.env.DB_PATH;
});

afterEach(function () {
  // Always stop the scheduler between tests to clean up cron jobs
  stopScheduledScraper();
});

describe("initScheduledScraper — scheduling disabled", function () {
  test("returns no-op control object when enabled is false", function () {
    writeTestConfig({
      scheduling: { enabled: false },
    });

    const control = initScheduledScraper();

    expect(control).toBeDefined();
    expect(typeof control.stop).toBe("function");
    expect(typeof control.getNextRun).toBe("function");
    expect(typeof control.isRunning).toBe("function");
    expect(control.getNextRun()).toBeNull();
    expect(control.isRunning()).toBe(false);
  });
});

describe("initScheduledScraper — scheduling enabled", function () {
  test("creates a cron job and returns control object with nextRun", function () {
    writeTestConfig({
      scheduling: {
        enabled: true,
        cron: "0 8 * * 6",
        runOnStartupIfMissed: false,
        startupDelayMinutes: 10,
      },
    });

    const control = initScheduledScraper();

    expect(control).toBeDefined();
    const nextRun = control.getNextRun();
    expect(nextRun).not.toBeNull();
    // nextRun should be a Date object
    expect(nextRun instanceof Date).toBe(true);
    // Should be in the future
    expect(nextRun.getTime()).toBeGreaterThan(Date.now());
    expect(control.isRunning()).toBe(false);
  });

  test("nextRun is a Saturday at 08:00 for cron '0 8 * * 6'", function () {
    writeTestConfig({
      scheduling: {
        enabled: true,
        cron: "0 8 * * 6",
        runOnStartupIfMissed: false,
      },
    });

    const control = initScheduledScraper();
    const nextRun = control.getNextRun();

    // Day 6 = Saturday
    expect(nextRun.getUTCDay()).toBe(6);
    expect(nextRun.getUTCHours()).toBe(8);
    expect(nextRun.getUTCMinutes()).toBe(0);
  });
});

describe("getSchedulerStatus — disabled", function () {
  test("returns enabled: false when scheduling is disabled", function () {
    writeTestConfig({
      scheduling: { enabled: false },
    });

    initScheduledScraper();
    const status = getSchedulerStatus();

    expect(status.enabled).toBe(false);
    expect(status.nextRun).toBeNull();
    expect(status.isCurrentlyRunning).toBe(false);
  });
});

describe("getSchedulerStatus — enabled", function () {
  test("returns correct status when scheduling is enabled", function () {
    writeTestConfig({
      scheduling: {
        enabled: true,
        cron: "0 8 * * 6",
        runOnStartupIfMissed: false,
      },
    });

    initScheduledScraper();
    const status = getSchedulerStatus();

    expect(status.enabled).toBe(true);
    expect(status.cronExpression).toBe("0 8 * * 6");
    expect(status.nextRun).not.toBeNull();
    // nextRun should be an ISO string
    expect(typeof status.nextRun).toBe("string");
    expect(status.nextRun).toContain("T");
    expect(status.isCurrentlyRunning).toBe(false);
    // No run has completed yet
    expect(status.lastRunResult).toBeNull();
  });
});

describe("stopScheduledScraper", function () {
  test("stops the cron job and cleans up", function () {
    writeTestConfig({
      scheduling: {
        enabled: true,
        cron: "0 8 * * 6",
        runOnStartupIfMissed: false,
      },
    });

    const control = initScheduledScraper();
    expect(control.getNextRun()).not.toBeNull();

    stopScheduledScraper();

    // After stopping, getNextRun from the control should return null
    // (the cronJob reference is cleared)
    expect(control.getNextRun()).toBeNull();
  });

  test("is safe to call multiple times", function () {
    writeTestConfig({
      scheduling: { enabled: false },
    });

    initScheduledScraper();

    // Calling stop multiple times should not throw
    stopScheduledScraper();
    stopScheduledScraper();
    stopScheduledScraper();
  });
});

describe("initScheduledScraper — different cron expressions", function () {
  test("accepts weekday morning schedule", function () {
    writeTestConfig({
      scheduling: {
        enabled: true,
        cron: "30 7 * * 1-5",
        runOnStartupIfMissed: false,
      },
    });

    const control = initScheduledScraper();
    const nextRun = control.getNextRun();

    expect(nextRun).not.toBeNull();
    // Should be on a weekday (1-5)
    const day = nextRun.getUTCDay();
    expect(day).toBeGreaterThanOrEqual(1);
    expect(day).toBeLessThanOrEqual(5);
    expect(nextRun.getUTCHours()).toBe(7);
    expect(nextRun.getUTCMinutes()).toBe(30);
  });
});

describe("getSchedulerStatus — cronExpression from config", function () {
  test("reflects the configured cron expression", function () {
    writeTestConfig({
      scheduling: {
        enabled: true,
        cron: "0 6 * * 0",
        runOnStartupIfMissed: false,
      },
    });

    initScheduledScraper();
    const status = getSchedulerStatus();

    expect(status.cronExpression).toBe("0 6 * * 0");
  });
});

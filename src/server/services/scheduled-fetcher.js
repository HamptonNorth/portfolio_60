import { Cron } from "croner";
import { getSchedulingConfig, getRetryConfig, getFetchDelayProfile, getCronUpdateTestDatabase } from "../config.js";
import { getLastSuccessfulFetchByType } from "../db/fetch-history-db.js";
import { closeDatabase, databaseExists, resetDatabasePath } from "../db/connection.js";
import { testReferenceExists } from "../test-mode.js";
import { runFullPriceUpdate, retryFailedItems } from "./fetch-service.js";
import { writeSchedulerLog, pruneSchedulerLog } from "../db/scheduler-log-db.js";

/**
 * @description The active Croner job instance, or null if scheduling is disabled.
 * @type {Cron|null}
 */
let cronJob = null;

/**
 * @description Whether a fetch run is currently in progress.
 * Prevents overlapping runs if a fetch takes longer than the cron interval.
 * @type {boolean}
 */
let isRunning = false;

/**
 * @description Set to true when stopScheduledFetcher() is called, signalling
 * any in-progress retry loop to exit early.
 * @type {boolean}
 */
let stopRequested = false;

/**
 * @description Array of pending setTimeout IDs for retry delays and startup
 * missed-fetch delays. Cleared on stop for graceful shutdown.
 * @type {number[]}
 */
let pendingTimers = [];

/**
 * @description Summary of the most recent scheduled fetch run, or null
 * if no run has completed yet.
 * @type {Object|null}
 */
let lastRunResult = null;

/**
 * @description Sleep for a given number of milliseconds. Returns a timer ID
 * that is tracked in pendingTimers for cleanup on shutdown.
 * Resolves early with false if stopRequested becomes true.
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<boolean>} true if the sleep completed, false if interrupted
 */
function trackedSleep(ms) {
  return new Promise(function (resolve) {
    const timerId = setTimeout(function () {
      // Remove this timer from the tracked list
      pendingTimers = pendingTimers.filter(function (id) {
        return id !== timerId;
      });
      resolve(true);
    }, ms);
    pendingTimers.push(timerId);
  });
}

/**
 * @description Execute a full fetch run with retry logic for failed items.
 * Called by both the cron job and the missed-fetch handler.
 * @param {number} startedBy - 0 = manual, 1 = scheduled/cron
 */
async function executeFetchRun(startedBy) {
  if (isRunning) {
    writeSchedulerLog("Fetch already in progress, skipping");
    return;
  }

  isRunning = true;
  stopRequested = false;

  const retryConfig = getRetryConfig();
  const delayProfile = getFetchDelayProfile();

  writeSchedulerLog("Starting fetch run (startedBy=" + startedBy + ")");

  try {
    // Run the initial full fetch
    const summary = await runFullPriceUpdate({
      startedBy: startedBy,
      delayProfile: delayProfile,
    });

    writeSchedulerLog(
      "Initial fetch complete — prices: " +
        summary.priceSuccessCount + "/" + (summary.priceSuccessCount + summary.priceFailCount) +
        ", benchmarks: " + summary.benchmarkSuccessCount + "/" + (summary.benchmarkSuccessCount + summary.benchmarkFailCount) +
        ", currency: " + (summary.currencySuccess ? "OK" : "FAILED"),
    );

    // Determine what needs retrying
    let failedInvestmentIds = summary.failedInvestmentIds;
    let failedBenchmarkIds = summary.failedBenchmarkIds;
    let retryCurrency = !summary.currencySuccess;

    // Retry loop: attempt 2 through maxAttempts
    let attempt = 2;
    while (
      attempt <= retryConfig.maxAttempts &&
      !stopRequested &&
      (failedInvestmentIds.length > 0 || failedBenchmarkIds.length > 0 || retryCurrency)
    ) {
      const totalFailed = failedInvestmentIds.length + failedBenchmarkIds.length + (retryCurrency ? 1 : 0);
      writeSchedulerLog(
        "Retry attempt " + attempt + "/" + retryConfig.maxAttempts +
          " — " + totalFailed + " item(s) to retry in " + retryConfig.delayMinutes + " minute(s)",
      );

      // Wait before retrying
      const sleptOk = await trackedSleep(retryConfig.delayMinutes * 60 * 1000);
      if (!sleptOk || stopRequested) {
        writeSchedulerLog("Retry interrupted by shutdown", "warn");
        break;
      }

      const retryResult = await retryFailedItems(
        {
          investmentIds: failedInvestmentIds,
          benchmarkIds: failedBenchmarkIds,
          retryCurrency: retryCurrency,
        },
        {
          attemptNumber: attempt,
          startedBy: startedBy,
          delayProfile: delayProfile,
        },
      );

      // Update failed lists with remaining failures
      failedInvestmentIds = retryResult.failedInvestmentIds;
      failedBenchmarkIds = retryResult.failedBenchmarkIds;
      retryCurrency = !retryResult.currencySuccess && retryCurrency;

      const remainingFailed = failedInvestmentIds.length + failedBenchmarkIds.length + (retryCurrency ? 1 : 0);
      writeSchedulerLog(
        "After retry " + attempt + ": " + remainingFailed + " item(s) still failing",
      );

      attempt++;
    }

    // Build final result
    lastRunResult = {
      completedAt: new Date().toISOString(),
      startedBy: startedBy,
      initialSummary: summary,
      finalFailedInvestmentIds: failedInvestmentIds,
      finalFailedBenchmarkIds: failedBenchmarkIds,
      finalCurrencySuccess: !retryCurrency,
      totalRetryAttempts: attempt - 2,
    };

    const totalRemaining = failedInvestmentIds.length + failedBenchmarkIds.length;
    if (totalRemaining === 0 && !retryCurrency) {
      writeSchedulerLog("Fetch run completed — all items successful");
    } else {
      writeSchedulerLog(
        "Fetch run completed — " + totalRemaining + " item(s) still failing after " +
          (attempt - 2) + " retry attempt(s)",
        "warn",
      );
    }
    // After live fetch completes, optionally update the test database
    if (getCronUpdateTestDatabase() && testReferenceExists()) {
      await updateTestDatabase(startedBy, delayProfile);
    }
  } catch (err) {
    writeSchedulerLog("Fetch run failed with error: " + err.message, "error");
    lastRunResult = {
      completedAt: new Date().toISOString(),
      startedBy: startedBy,
      error: err.message,
    };
  } finally {
    isRunning = false;
  }
}

/**
 * @description Switch to the test database, run a full price update, then
 * switch back to the live database. Called after the live cron fetch completes
 * when cronUpdateTestDatabase is enabled and a test database exists.
 * No retry loop is run for the test database — only the initial fetch.
 * @param {number} startedBy - 0 = manual, 1 = scheduled/cron
 * @param {string} delayProfile - The fetch delay profile to use
 */
async function updateTestDatabase(startedBy, delayProfile) {
  const { resolve, join } = await import("node:path");
  const { DATA_DIR } = await import("../../shared/server-constants.js");

  const testDbPath = resolve(join(DATA_DIR, "data", "test_reference", "portfolio60.db"));

  writeSchedulerLog("Switching to test database for cron update");

  // Save current DB_PATH so we can restore it
  const savedDbPath = process.env.DB_PATH;

  try {
    // Close live database and switch to test
    closeDatabase();
    process.env.DB_PATH = testDbPath;
    resetDatabasePath();

    const testSummary = await runFullPriceUpdate({
      startedBy: startedBy,
      delayProfile: delayProfile,
    });

    writeSchedulerLog(
      "Test database fetch complete — prices: " +
        testSummary.priceSuccessCount + "/" + (testSummary.priceSuccessCount + testSummary.priceFailCount) +
        ", benchmarks: " + testSummary.benchmarkSuccessCount + "/" + (testSummary.benchmarkSuccessCount + testSummary.benchmarkFailCount) +
        ", currency: " + (testSummary.currencySuccess ? "OK" : "FAILED"),
    );
  } catch (err) {
    writeSchedulerLog("Test database fetch failed: " + err.message, "error");
  } finally {
    // Always switch back to the live database
    closeDatabase();
    if (savedDbPath) {
      process.env.DB_PATH = savedDbPath;
    } else {
      delete process.env.DB_PATH;
    }
    resetDatabasePath();
    writeSchedulerLog("Switched back to live database");
  }
}

/**
 * @description Initialise the scheduled fetcher. Sets up the cron job
 * based on configuration and optionally runs a missed fetch after the
 * configured startup delay.
 *
 * Should be called once from index.js after the server is listening.
 * If scheduling is disabled in config, logs a message and returns a
 * no-op control object.
 *
 * @returns {{ stop: Function, getNextRun: Function, isRunning: Function }}
 */
export function initScheduledFetcher() {
  const schedulingConfig = getSchedulingConfig();

  // Prune log entries older than 30 days on every startup
  if (databaseExists()) {
    try {
      const pruned = pruneSchedulerLog(30);
      if (pruned > 0) {
        writeSchedulerLog("Pruned " + pruned + " log entries older than 30 days");
      }
    } catch (err) {
      console.warn("[Scheduler] Failed to prune scheduler log: " + err.message);
    }
  }

  if (!schedulingConfig.enabled) {
    writeSchedulerLog("Scheduled fetching is disabled");
    return {
      stop: function () {},
      getNextRun: function () { return null; },
      isRunning: function () { return false; },
    };
  }

  // Create the cron job (paused initially so we can log before it runs)
  cronJob = new Cron(schedulingConfig.cron, { protect: true }, function () {
    executeFetchRun(1);
  });

  const nextRun = cronJob.nextRun();
  writeSchedulerLog("Scheduled fetching enabled — cron: " + schedulingConfig.cron);
  writeSchedulerLog("Next scheduled fetch: " + (nextRun ? nextRun.toISOString() : "unknown"));

  // Check for missed fetch if configured
  if (schedulingConfig.runOnStartupIfMissed) {
    checkForMissedFetch(schedulingConfig);
  }

  return {
    stop: stopScheduledFetcher,
    getNextRun: function () { return cronJob ? cronJob.nextRun() : null; },
    isRunning: function () { return isRunning; },
  };
}

/**
 * @description Check whether a scheduled fetch was missed while the app
 * was not running. If so, schedule a delayed fetch after the configured
 * startup delay.
 * @param {Object} schedulingConfig - The scheduling configuration
 */
function checkForMissedFetch(schedulingConfig) {
  // Guard: if the database doesn't exist yet, skip the check
  if (!databaseExists()) {
    writeSchedulerLog("Database not yet created, skipping missed-fetch check");
    return;
  }

  // Use Croner's previousRuns to find the most recent past scheduled time
  const previousScheduledTimes = cronJob.previousRuns(1);
  if (!previousScheduledTimes || previousScheduledTimes.length === 0) {
    // No previous scheduled time (cron has never been due)
    return;
  }

  const lastScheduledTime = previousScheduledTimes[0];

  // Get the last successful investment fetch from the database
  const lastSuccessful = getLastSuccessfulFetchByType("investment");

  if (!lastSuccessful) {
    // No successful fetch ever recorded — treat as missed
    writeSchedulerLog("No previous successful fetch found — scheduling startup fetch");
    scheduleMissedFetch(schedulingConfig.startupDelayMinutes);
    return;
  }

  // Compare: if the last successful fetch is older than the last scheduled time,
  // a fetch was missed
  const lastSuccessfulDate = new Date(lastSuccessful);
  if (lastSuccessfulDate < lastScheduledTime) {
    writeSchedulerLog(
      "Missed fetch detected — last success: " + lastSuccessful +
        ", last scheduled: " + lastScheduledTime.toISOString(),
    );
    scheduleMissedFetch(schedulingConfig.startupDelayMinutes);
  } else {
    writeSchedulerLog("No missed fetch — last success is up to date");
  }
}

/**
 * @description Schedule a delayed fetch to run after the startup delay.
 * @param {number} delayMinutes - Minutes to wait before running the fetch
 */
function scheduleMissedFetch(delayMinutes) {
  const delayMs = delayMinutes * 60 * 1000;
  writeSchedulerLog("Startup fetch will run in " + delayMinutes + " minute(s)");

  const timerId = setTimeout(function () {
    pendingTimers = pendingTimers.filter(function (id) {
      return id !== timerId;
    });
    writeSchedulerLog("Startup fetch timer fired — beginning fetch run");
    executeFetchRun(1);
  }, delayMs);

  pendingTimers.push(timerId);
}

/**
 * @description Stop the scheduled fetcher. Cancels the cron job and any
 * pending retry or startup-delay timers. Signals any in-progress retry
 * loop to exit early.
 */
export function stopScheduledFetcher() {
  stopRequested = true;

  // Cancel the cron job
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    writeSchedulerLog("Cron job stopped");
  }

  // Cancel all pending timers
  for (const timerId of pendingTimers) {
    clearTimeout(timerId);
  }
  pendingTimers = [];
}

/**
 * @description Get the current status of the scheduled fetcher.
 * Useful for API endpoints and the future Settings UI.
 * @returns {{ enabled: boolean, cronExpression: string, nextRun: string|null,
 *             isCurrentlyRunning: boolean, lastRunResult: Object|null }}
 */
export function getSchedulerStatus() {
  const schedulingConfig = getSchedulingConfig();
  const nextRun = cronJob ? cronJob.nextRun() : null;

  return {
    enabled: schedulingConfig.enabled,
    cronExpression: schedulingConfig.cron,
    nextRun: nextRun ? nextRun.toISOString() : null,
    isCurrentlyRunning: isRunning,
    lastRunResult: lastRunResult,
  };
}

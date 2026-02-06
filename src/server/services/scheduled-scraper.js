import { Cron } from "croner";
import { getSchedulingConfig, getRetryConfig, getScrapeDelayProfile } from "../config.js";
import { getLastSuccessfulScrapeByType } from "../db/scraping-history-db.js";
import { databaseExists } from "../db/connection.js";
import { runFullScrape, retryFailedItems } from "./scraping-service.js";

/**
 * @description The active Croner job instance, or null if scheduling is disabled.
 * @type {Cron|null}
 */
let cronJob = null;

/**
 * @description Whether a scrape run is currently in progress.
 * Prevents overlapping runs if a scrape takes longer than the cron interval.
 * @type {boolean}
 */
let isRunning = false;

/**
 * @description Set to true when stopScheduledScraper() is called, signalling
 * any in-progress retry loop to exit early.
 * @type {boolean}
 */
let stopRequested = false;

/**
 * @description Array of pending setTimeout IDs for retry delays and startup
 * missed-scrape delays. Cleared on stop for graceful shutdown.
 * @type {number[]}
 */
let pendingTimers = [];

/**
 * @description Summary of the most recent scheduled scrape run, or null
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
 * @description Execute a full scrape run with retry logic for failed items.
 * Called by both the cron job and the missed-scrape handler.
 * @param {number} startedBy - 0 = manual, 1 = scheduled/cron
 */
async function executeScrapeRun(startedBy) {
  if (isRunning) {
    console.log("[Scheduler] Scrape already in progress, skipping");
    return;
  }

  isRunning = true;
  stopRequested = false;

  const retryConfig = getRetryConfig();
  const delayProfile = getScrapeDelayProfile();

  console.log("[Scheduler] Starting scrape run (startedBy=" + startedBy + ")");

  try {
    // Run the initial full scrape
    const summary = await runFullScrape({
      startedBy: startedBy,
      delayProfile: delayProfile,
    });

    console.log(
      "[Scheduler] Initial scrape complete — prices: " +
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
      console.log(
        "[Scheduler] Retry attempt " + attempt + "/" + retryConfig.maxAttempts +
          " — " + totalFailed + " item(s) to retry in " + retryConfig.delayMinutes + " minute(s)",
      );

      // Wait before retrying
      const sleptOk = await trackedSleep(retryConfig.delayMinutes * 60 * 1000);
      if (!sleptOk || stopRequested) {
        console.log("[Scheduler] Retry interrupted by shutdown");
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
      console.log(
        "[Scheduler] After retry " + attempt + ": " + remainingFailed + " item(s) still failing",
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
      console.log("[Scheduler] Scrape run completed — all items successful");
    } else {
      console.log(
        "[Scheduler] Scrape run completed — " + totalRemaining + " item(s) still failing after " +
          (attempt - 2) + " retry attempt(s)",
      );
    }
  } catch (err) {
    console.error("[Scheduler] Scrape run failed with error:", err.message);
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
 * @description Initialise the scheduled scraper. Sets up the cron job
 * based on configuration and optionally runs a missed scrape after the
 * configured startup delay.
 *
 * Should be called once from index.js after the server is listening.
 * If scheduling is disabled in config, logs a message and returns a
 * no-op control object.
 *
 * @returns {{ stop: Function, getNextRun: Function, isRunning: Function }}
 */
export function initScheduledScraper() {
  const schedulingConfig = getSchedulingConfig();

  if (!schedulingConfig.enabled) {
    console.log("[Scheduler] Scheduled scraping is disabled");
    return {
      stop: function () {},
      getNextRun: function () { return null; },
      isRunning: function () { return false; },
    };
  }

  // Create the cron job (paused initially so we can log before it runs)
  cronJob = new Cron(schedulingConfig.cron, { protect: true }, function () {
    executeScrapeRun(1);
  });

  const nextRun = cronJob.nextRun();
  console.log("[Scheduler] Scheduled scraping enabled — cron: " + schedulingConfig.cron);
  console.log("[Scheduler] Next scheduled scrape: " + (nextRun ? nextRun.toISOString() : "unknown"));

  // Check for missed scrape if configured
  if (schedulingConfig.runOnStartupIfMissed) {
    checkForMissedScrape(schedulingConfig);
  }

  return {
    stop: stopScheduledScraper,
    getNextRun: function () { return cronJob ? cronJob.nextRun() : null; },
    isRunning: function () { return isRunning; },
  };
}

/**
 * @description Check whether a scheduled scrape was missed while the app
 * was not running. If so, schedule a delayed scrape after the configured
 * startup delay.
 * @param {Object} schedulingConfig - The scheduling configuration
 */
function checkForMissedScrape(schedulingConfig) {
  // Guard: if the database doesn't exist yet, skip the check
  if (!databaseExists()) {
    console.log("[Scheduler] Database not yet created, skipping missed-scrape check");
    return;
  }

  // Use Croner's previousRuns to find the most recent past scheduled time
  const previousScheduledTimes = cronJob.previousRuns(1);
  if (!previousScheduledTimes || previousScheduledTimes.length === 0) {
    // No previous scheduled time (cron has never been due)
    return;
  }

  const lastScheduledTime = previousScheduledTimes[0];

  // Get the last successful investment scrape from the database
  const lastSuccessful = getLastSuccessfulScrapeByType("investment");

  if (!lastSuccessful) {
    // No successful scrape ever recorded — treat as missed
    console.log("[Scheduler] No previous successful scrape found — scheduling startup scrape");
    scheduleMissedScrape(schedulingConfig.startupDelayMinutes);
    return;
  }

  // Compare: if the last successful scrape is older than the last scheduled time,
  // a scrape was missed
  const lastSuccessfulDate = new Date(lastSuccessful);
  if (lastSuccessfulDate < lastScheduledTime) {
    console.log(
      "[Scheduler] Missed scrape detected — last success: " + lastSuccessful +
        ", last scheduled: " + lastScheduledTime.toISOString(),
    );
    scheduleMissedScrape(schedulingConfig.startupDelayMinutes);
  } else {
    console.log("[Scheduler] No missed scrape — last success is up to date");
  }
}

/**
 * @description Schedule a delayed scrape to run after the startup delay.
 * @param {number} delayMinutes - Minutes to wait before running the scrape
 */
function scheduleMissedScrape(delayMinutes) {
  const delayMs = delayMinutes * 60 * 1000;
  console.log("[Scheduler] Startup scrape will run in " + delayMinutes + " minute(s)");

  const timerId = setTimeout(function () {
    pendingTimers = pendingTimers.filter(function (id) {
      return id !== timerId;
    });
    executeScrapeRun(1);
  }, delayMs);

  pendingTimers.push(timerId);
}

/**
 * @description Stop the scheduled scraper. Cancels the cron job and any
 * pending retry or startup-delay timers. Signals any in-progress retry
 * loop to exit early.
 */
export function stopScheduledScraper() {
  stopRequested = true;

  // Cancel the cron job
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log("[Scheduler] Cron job stopped");
  }

  // Cancel all pending timers
  for (const timerId of pendingTimers) {
    clearTimeout(timerId);
  }
  pendingTimers = [];
}

/**
 * @description Get the current status of the scheduled scraper.
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

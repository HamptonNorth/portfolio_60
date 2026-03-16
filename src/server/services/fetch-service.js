import { fetchCurrencyRates } from "../fetchers/currency-fetcher.js";
import { fetchLatestMorningstarPrice, getMorningstarFetchableInvestments } from "../fetchers/morningstar-price-fetcher.js";
import { fetchLatestYahooBenchmarkValue, getYahooFetchableBenchmarks } from "../fetchers/yahoo-benchmark-fetcher.js";
import { getTotalPriceCount, getPriceCount, getLatestPrice } from "../db/prices-db.js";
import { getTotalRateCount, getRateCount, getLatestRate } from "../db/currency-rates-db.js";
import { getTotalBenchmarkDataCount, getBenchmarkDataCount, getLatestBenchmarkData } from "../db/benchmark-data-db.js";
import { backfillInvestmentPrices, backfillBenchmarkValues, backfillCurrencyRates, backfillSingleInvestment, backfillSingleBenchmark, backfillSingleCurrency, backfillCurrencyRatesForRange, fetchMorningstarHistory, fetchYahooBenchmarkHistory } from "./historic-backfill.js";
import { getDatabase } from "../db/connection.js";
import { checkpointDatabase } from "../db/connection.js";
import { recordFetchAttempt } from "../db/fetch-history-db.js";
import { upsertPrice } from "../db/prices-db.js";
import { upsertBenchmarkData } from "../db/benchmark-data-db.js";

/** @description Trigger gap-fill if last data is older than this many days */
const GAP_THRESHOLD_DAYS = 10;

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
 * @description Calculate the number of days between two ISO-8601 date strings.
 * @param {string} dateStr - ISO-8601 date string (YYYY-MM-DD)
 * @param {Date} now - Current date
 * @returns {number} Number of days between the date and now
 */
function daysSince(dateStr, now) {
  const then = new Date(dateStr + "T00:00:00");
  const diffMs = now.getTime() - then.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * @description Add one day to an ISO-8601 date string.
 * @param {string} dateStr - ISO-8601 date string (YYYY-MM-DD)
 * @returns {string} The next day as ISO-8601 string
 */
function nextDay(dateStr) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split("T")[0];
}

/**
 * @description Run a complete fetch cycle: currency rates first, then
 * investment prices, then benchmark values. Calls optional callback hooks
 * as each item completes, allowing callers to report progress.
 *
 * This function does NOT include retry logic for failed items. Retries
 * are handled by the caller (the scheduled fetcher uses slow retries
 * via retryFailedItems; the SSE routes use their own fast inline retries).
 *
 * @param {Object} [options={}] - Fetch options
 * @param {number} [options.startedBy=0] - 0 = manual/interactive, 1 = scheduled/cron
 * @param {string} [options.delayProfile] - "interactive" or "cron" (reserved for future use)
 * @param {Function} [options.onCurrencyRates] - Called with the currency rates result object
 * @param {Function} [options.onPriceResult] - Called with each price fetch result
 * @param {Function} [options.onBenchmarkResult] - Called with each benchmark fetch result
 * @param {Function} [options.onComplete] - Called with the final summary object
 * @param {Function} [options.onError] - Called if a fatal error occurs
 * @returns {Promise<Object>} Summary with failedCurrencyIds, failedInvestmentIds,
 *   failedBenchmarkIds, priceSuccessCount, priceFailCount, benchmarkSuccessCount,
 *   benchmarkFailCount, currencySuccess
 */
export async function runFullPriceUpdate(options = {}) {
  const startedBy = options.startedBy || 0;
  const onCurrencyRates = options.onCurrencyRates || null;
  const onPriceResult = options.onPriceResult || null;
  const onBenchmarkResult = options.onBenchmarkResult || null;
  const onComplete = options.onComplete || null;
  const onError = options.onError || null;

  // Capture a shared timestamp so all values from this run are contemporaneous
  const fetchTime = new Date().toTimeString().slice(0, 8);

  const summary = {
    currencySuccess: false,
    failedCurrencyIds: [],
    failedInvestmentIds: [],
    failedBenchmarkIds: [],
    priceSuccessCount: 0,
    priceFailCount: 0,
    benchmarkSuccessCount: 0,
    benchmarkFailCount: 0,
  };

  try {
    // Step 1: Fetch currency rates (always first for contemporaneous data)
    const currencyResult = await fetchCurrencyRates({
      startedBy: startedBy,
      fetchTime: fetchTime,
    });

    summary.currencySuccess = currencyResult.success;
    if (onCurrencyRates) {
      onCurrencyRates(currencyResult);
    }

    // Auto-backfill empty tables (first run only)
    if (getTotalRateCount() === 0) {
      try {
        await backfillCurrencyRates(function () {});
        checkpointDatabase();
      } catch (err) {
        console.warn("[FetchService] Currency rate backfill failed: " + err.message);
      }
    } else {
      // Per-currency backfill: check for newly added currencies with no history
      const db = getDatabase();
      const currencies = db.query("SELECT id, code FROM currencies WHERE code != 'GBP' ORDER BY code").all();
      for (const c of currencies) {
        if (getRateCount(c.id) === 0) {
          console.log("[FetchService] No rate history for " + c.code + " — backfilling...");
          try {
            await backfillSingleCurrency(c, function (progress) {
              console.log("[FetchService/Backfill] " + progress.message);
            });
            checkpointDatabase();
          } catch (err) {
            console.warn("[FetchService] Currency rate backfill for " + c.code + " failed: " + err.message);
          }
        }
      }
    }

    // Gap-fill for currency rates: if any currency has a gap > threshold,
    // fetch missing data from BoE (one request covers all currencies)
    {
      const db = getDatabase();
      const now = new Date();
      const todayStr = now.toISOString().split("T")[0];
      const allCurrencies = db.query("SELECT id, code FROM currencies WHERE code != 'GBP' ORDER BY code").all();
      let currencyGapDetected = false;
      let oldestGapStart = todayStr;

      for (const c of allCurrencies) {
        if (getRateCount(c.id) === 0) continue; // handled by backfill above
        const latest = getLatestRate(c.id);
        if (latest) {
          const gap = daysSince(latest.rate_date, now);
          if (gap > GAP_THRESHOLD_DAYS) {
            console.log("[FetchService] Gap detected for currency " + c.code + ": last rate " + latest.rate_date + ", " + gap + " days ago — will gap-fill");
            currencyGapDetected = true;
            const gapStart = nextDay(latest.rate_date);
            if (gapStart < oldestGapStart) {
              oldestGapStart = gapStart;
            }
          }
        }
      }

      if (currencyGapDetected) {
        console.log("[FetchService] Gap-filling currency rates from " + oldestGapStart + " to " + todayStr + "...");
        try {
          const gapResult = await backfillCurrencyRatesForRange(oldestGapStart, todayStr);
          checkpointDatabase();
          console.log("[FetchService] Currency gap-fill complete: " + gapResult.totalRates + " rates for " + gapResult.currenciesUpdated.join(", "));
          if (onCurrencyRates) {
            onCurrencyRates({
              success: true,
              gapFill: true,
              message: "Gap-filled " + gapResult.totalRates + " currency rates (" + oldestGapStart + " to " + todayStr + ")",
            });
          }
        } catch (err) {
          console.warn("[FetchService] Currency gap-fill failed: " + err.message);
        }
      }
    }

    if (getTotalPriceCount() === 0) {
      try {
        await backfillInvestmentPrices(function () {});
        checkpointDatabase();
      } catch (err) {
        console.warn("[FetchService] Price backfill failed: " + err.message);
      }
    }

    if (getTotalBenchmarkDataCount() === 0) {
      try {
        await backfillBenchmarkValues(function () {});
        checkpointDatabase();
      } catch (err) {
        console.warn("[FetchService] Benchmark backfill failed: " + err.message);
      }
    }

    // Step 2: Fetch latest investment prices via Morningstar API
    const investments = getMorningstarFetchableInvestments();
    let isFirstPrice = true;

    for (const investment of investments) {
      // Random delay of 5-30 seconds between API calls
      if (!isFirstPrice) {
        const delayMs = Math.floor(Math.random() * 25001) + 5000;
        await sleep(delayMs);
      }
      isFirstPrice = false;

      // Skip manually priced investments
      if (!investment.morningstarResolvable) {
        summary.priceFailCount++;
        summary.failedInvestmentIds.push(investment.id);
        if (onPriceResult) {
          onPriceResult({
            success: false,
            investmentId: investment.id,
            description: investment.description,
            error: "No Morningstar ID — manually priced",
            errorCode: "MANUALLY_PRICED",
          });
        }
        continue;
      }

      // Per-item backfill: if this investment has no price history, backfill first
      if (getPriceCount(investment.id) === 0) {
        console.log("[FetchService] No price history for investment " + investment.id + " (" + investment.description + ") — backfilling...");
        try {
          await backfillSingleInvestment(investment, function (progress) {
            console.log("[FetchService/Backfill] " + progress.message);
          });
          checkpointDatabase();
        } catch (err) {
          console.warn("[FetchService] Price backfill for " + investment.description + " failed: " + err.message);
        }
      } else {
        // Gap-fill: if the latest price is older than the threshold, fetch the missing range
        const latestPrice = getLatestPrice(investment.id);
        if (latestPrice) {
          const now = new Date();
          const gap = daysSince(latestPrice.price_date, now);
          if (gap > GAP_THRESHOLD_DAYS) {
            const gapStartDate = nextDay(latestPrice.price_date);
            const todayStr = now.toISOString().split("T")[0];
            console.log("[FetchService] Gap detected for " + investment.description + ": last price " + latestPrice.price_date + ", fetching " + gap + " days of missing data...");
            try {
              // Parse the cached morningstar_id to get secId and universe
              const parts = (investment.morningstar_id || "").split("|");
              const secId = parts[0];
              const universe = parts[1] || "FOGBR$$ALL";
              if (secId) {
                const gapPrices = await fetchMorningstarHistory(secId, universe, investment.currency_code, gapStartDate, todayStr, "weekly");
                for (const entry of gapPrices) {
                  const priceInMinorUnits = entry.price * 100;
                  upsertPrice(investment.id, entry.date, "00:00:00", priceInMinorUnits);
                }
                checkpointDatabase();
                console.log("[FetchService] Gap-fill for " + investment.description + ": " + gapPrices.length + " prices inserted");
                if (onPriceResult) {
                  onPriceResult({
                    success: true,
                    gapFill: true,
                    investmentId: investment.id,
                    description: investment.description,
                    message: "Gap-filled " + gapPrices.length + " prices (" + gapStartDate + " to " + todayStr + ")",
                  });
                }
              }
            } catch (err) {
              console.warn("[FetchService] Price gap-fill for " + investment.description + " failed: " + err.message);
            }
          }
        }
      }

      try {
        const priceResult = await fetchLatestMorningstarPrice(investment);
        if (priceResult.success) {
          summary.priceSuccessCount++;
          try {
            recordFetchAttempt({
              fetchType: "investment",
              referenceId: investment.id,
              startedBy: startedBy,
              attemptNumber: 1,
              maxAttempts: 1,
              success: true,
            });
          } catch (historyErr) {
            console.warn("[FetchService] Failed to record history for investment " + investment.id + ": " + historyErr.message);
          }
        } else {
          summary.priceFailCount++;
          summary.failedInvestmentIds.push(investment.id);
          // Only record non-manually-priced failures in history
          if (priceResult.errorCode !== "MANUALLY_PRICED") {
            try {
              recordFetchAttempt({
                fetchType: "investment",
                referenceId: investment.id,
                startedBy: startedBy,
                attemptNumber: 1,
                maxAttempts: 1,
                success: false,
                errorCode: priceResult.errorCode,
                errorMessage: priceResult.error,
              });
            } catch (historyErr) {
              console.warn("[FetchService] Failed to record history for investment " + investment.id + ": " + historyErr.message);
            }
          }
        }
        if (onPriceResult) {
          onPriceResult(priceResult);
        }
      } catch (err) {
        summary.priceFailCount++;
        summary.failedInvestmentIds.push(investment.id);
        try {
          recordFetchAttempt({
            fetchType: "investment",
            referenceId: investment.id,
            startedBy: startedBy,
            attemptNumber: 1,
            maxAttempts: 1,
            success: false,
            errorCode: "API_ERROR",
            errorMessage: err.message,
          });
        } catch (historyErr) {
          console.warn("[FetchService] Failed to record history for investment " + investment.id + ": " + historyErr.message);
        }
        if (onPriceResult) {
          onPriceResult({
            success: false,
            investmentId: investment.id,
            description: investment.description,
            error: "Unexpected error: " + err.message,
            errorCode: "API_ERROR",
          });
        }
      }
    }

    // Step 3: Fetch latest benchmark values via Yahoo Finance API
    const benchmarks = getYahooFetchableBenchmarks();
    let isFirstBenchmark = true;

    for (const benchmark of benchmarks) {
      // Random delay of 5-30 seconds between API calls
      if (!isFirstBenchmark) {
        const delayMs = Math.floor(Math.random() * 25001) + 5000;
        await sleep(delayMs);
      }
      isFirstBenchmark = false;

      // Skip benchmarks without Yahoo ticker
      if (!benchmark.yahooResolvable) {
        summary.benchmarkFailCount++;
        summary.failedBenchmarkIds.push(benchmark.id);
        if (onBenchmarkResult) {
          onBenchmarkResult({
            success: false,
            benchmarkId: benchmark.id,
            description: benchmark.description,
            error: "No Yahoo Finance ticker",
            errorCode: "NO_YAHOO_TICKER",
          });
        }
        continue;
      }

      // Per-item backfill: if this benchmark has no value history, backfill first
      if (getBenchmarkDataCount(benchmark.id) === 0) {
        console.log("[FetchService] No value history for benchmark " + benchmark.id + " (" + benchmark.description + ") — backfilling...");
        try {
          await backfillSingleBenchmark(benchmark, function (progress) {
            console.log("[FetchService/Backfill] " + progress.message);
          });
          checkpointDatabase();
        } catch (err) {
          console.warn("[FetchService] Benchmark backfill for " + benchmark.description + " failed: " + err.message);
        }
      } else {
        // Gap-fill: if the latest benchmark value is older than the threshold, fetch the missing range
        const latestBm = getLatestBenchmarkData(benchmark.id);
        if (latestBm) {
          const now = new Date();
          const gap = daysSince(latestBm.benchmark_date, now);
          if (gap > GAP_THRESHOLD_DAYS) {
            const gapStartDate = nextDay(latestBm.benchmark_date);
            const todayStr = now.toISOString().split("T")[0];
            console.log("[FetchService] Gap detected for " + benchmark.description + ": last value " + latestBm.benchmark_date + ", fetching " + gap + " days of missing data...");
            try {
              const yahooTicker = benchmark.yahoo_ticker;
              if (yahooTicker) {
                const gapValues = await fetchYahooBenchmarkHistory(yahooTicker, gapStartDate, todayStr, "1wk");
                for (const entry of gapValues) {
                  upsertBenchmarkData(benchmark.id, entry.date, "00:00:00", entry.value);
                }
                checkpointDatabase();
                console.log("[FetchService] Gap-fill for " + benchmark.description + ": " + gapValues.length + " values inserted");
                if (onBenchmarkResult) {
                  onBenchmarkResult({
                    success: true,
                    gapFill: true,
                    benchmarkId: benchmark.id,
                    description: benchmark.description,
                    message: "Gap-filled " + gapValues.length + " values (" + gapStartDate + " to " + todayStr + ")",
                  });
                }
              }
            } catch (err) {
              console.warn("[FetchService] Benchmark gap-fill for " + benchmark.description + " failed: " + err.message);
            }
          }
        }
      }

      try {
        const benchmarkResult = await fetchLatestYahooBenchmarkValue(benchmark);
        if (benchmarkResult.success) {
          summary.benchmarkSuccessCount++;
          try {
            recordFetchAttempt({
              fetchType: "benchmark",
              referenceId: benchmark.id,
              startedBy: startedBy,
              attemptNumber: 1,
              maxAttempts: 1,
              success: true,
            });
          } catch (historyErr) {
            console.warn("[FetchService] Failed to record history for benchmark " + benchmark.id + ": " + historyErr.message);
          }
        } else {
          summary.benchmarkFailCount++;
          summary.failedBenchmarkIds.push(benchmark.id);
          // Only record non-ticker-missing failures in history
          if (benchmarkResult.errorCode !== "NO_YAHOO_TICKER") {
            try {
              recordFetchAttempt({
                fetchType: "benchmark",
                referenceId: benchmark.id,
                startedBy: startedBy,
                attemptNumber: 1,
                maxAttempts: 1,
                success: false,
                errorCode: benchmarkResult.errorCode,
                errorMessage: benchmarkResult.error,
              });
            } catch (historyErr) {
              console.warn("[FetchService] Failed to record history for benchmark " + benchmark.id + ": " + historyErr.message);
            }
          }
        }
        if (onBenchmarkResult) {
          onBenchmarkResult(benchmarkResult);
        }
      } catch (err) {
        summary.benchmarkFailCount++;
        summary.failedBenchmarkIds.push(benchmark.id);
        try {
          recordFetchAttempt({
            fetchType: "benchmark",
            referenceId: benchmark.id,
            startedBy: startedBy,
            attemptNumber: 1,
            maxAttempts: 1,
            success: false,
            errorCode: "API_ERROR",
            errorMessage: err.message,
          });
        } catch (historyErr) {
          console.warn("[FetchService] Failed to record history for benchmark " + benchmark.id + ": " + historyErr.message);
        }
        if (onBenchmarkResult) {
          onBenchmarkResult({
            success: false,
            benchmarkId: benchmark.id,
            description: benchmark.description,
            error: "Unexpected error: " + err.message,
            errorCode: "API_ERROR",
          });
        }
      }
    }

    checkpointDatabase();

    if (onComplete) {
      onComplete(summary);
    }
  } catch (err) {
    if (onError) {
      onError(err);
    } else {
      throw err;
    }
  }

  return summary;
}

/**
 * @description Retry specific failed items from a previous fetch run.
 * Currency rates are re-fetched as a whole (the API call is cheap since
 * it fetches all currencies in one request).
 *
 * @param {Object} failedItems - IDs of items to retry
 * @param {number[]} failedItems.investmentIds - Investment IDs to retry
 * @param {number[]} failedItems.benchmarkIds - Benchmark IDs to retry
 * @param {boolean} failedItems.retryCurrency - Whether to retry currency rates
 * @param {Object} [options={}] - Retry options
 * @param {number} [options.attemptNumber=2] - Current retry attempt number (2, 3, 4, 5)
 * @param {number} [options.startedBy=0] - 0 = manual, 1 = cron
 * @param {string} [options.delayProfile] - "interactive" or "cron" (reserved for future use)
 * @param {Function} [options.onRetryResult] - Called with (type, id, result) for each retry
 * @returns {Promise<Object>} Updated failure lists: { failedInvestmentIds, failedBenchmarkIds, currencySuccess }
 */
export async function retryFailedItems(failedItems, options = {}) {
  const attemptNumber = options.attemptNumber || 2;
  const startedBy = options.startedBy || 0;
  const onRetryResult = options.onRetryResult || null;

  const fetchTime = new Date().toTimeString().slice(0, 8);
  const result = {
    currencySuccess: true,
    failedInvestmentIds: [],
    failedBenchmarkIds: [],
  };

  try {
    // Retry currency rates if requested
    if (failedItems.retryCurrency) {
      const currencyResult = await fetchCurrencyRates({
        startedBy: startedBy,
        attemptNumber: attemptNumber,
        fetchTime: fetchTime,
      });
      result.currencySuccess = currencyResult.success;
      if (onRetryResult) {
        onRetryResult("currency", null, currencyResult);
      }
    }

    // Retry failed investments via Morningstar API
    const investmentIds = failedItems.investmentIds || [];
    if (investmentIds.length > 0) {
      const allInvestments = getMorningstarFetchableInvestments();
      const investmentsToRetry = allInvestments.filter(function (inv) {
        return investmentIds.includes(inv.id);
      });

      let isFirst = true;
      for (const investment of investmentsToRetry) {
        // Random delay of 5-30 seconds between API calls
        if (!isFirst) {
          const delayMs = Math.floor(Math.random() * 25001) + 5000;
          await sleep(delayMs);
        }
        isFirst = false;

        try {
          const priceResult = await fetchLatestMorningstarPrice(investment);
          if (priceResult.success) {
            try {
              recordFetchAttempt({
                fetchType: "investment",
                referenceId: investment.id,
                startedBy: startedBy,
                attemptNumber: attemptNumber,
                maxAttempts: options.maxAttempts || attemptNumber,
                success: true,
              });
            } catch (historyErr) {
              console.warn("[FetchService] Failed to record retry history for investment " + investment.id + ": " + historyErr.message);
            }
          } else {
            result.failedInvestmentIds.push(investment.id);
            if (priceResult.errorCode !== "MANUALLY_PRICED") {
              try {
                recordFetchAttempt({
                  fetchType: "investment",
                  referenceId: investment.id,
                  startedBy: startedBy,
                  attemptNumber: attemptNumber,
                  maxAttempts: options.maxAttempts || attemptNumber,
                  success: false,
                  errorCode: priceResult.errorCode,
                  errorMessage: priceResult.error,
                });
              } catch (historyErr) {
                console.warn("[FetchService] Failed to record retry history for investment " + investment.id + ": " + historyErr.message);
              }
            }
          }
          if (onRetryResult) {
            onRetryResult("investment", investment.id, priceResult);
          }
        } catch (err) {
          result.failedInvestmentIds.push(investment.id);
          try {
            recordFetchAttempt({
              fetchType: "investment",
              referenceId: investment.id,
              startedBy: startedBy,
              attemptNumber: attemptNumber,
              maxAttempts: options.maxAttempts || attemptNumber,
              success: false,
              errorCode: "API_ERROR",
              errorMessage: err.message,
            });
          } catch (historyErr) {
            console.warn("[FetchService] Failed to record retry history for investment " + investment.id + ": " + historyErr.message);
          }
          if (onRetryResult) {
            onRetryResult("investment", investment.id, {
              success: false,
              investmentId: investment.id,
              description: investment.description,
              error: "Unexpected error: " + err.message,
              errorCode: "API_ERROR",
            });
          }
        }
      }
    }

    // Retry failed benchmarks via Yahoo Finance API
    const benchmarkIds = failedItems.benchmarkIds || [];
    if (benchmarkIds.length > 0) {
      const allBenchmarks = getYahooFetchableBenchmarks();
      const benchmarksToRetry = allBenchmarks.filter(function (bm) {
        return benchmarkIds.includes(bm.id);
      });

      let isFirst = true;
      for (const benchmark of benchmarksToRetry) {
        // Random delay of 5-30 seconds between API calls
        if (!isFirst) {
          const delayMs = Math.floor(Math.random() * 25001) + 5000;
          await sleep(delayMs);
        }
        isFirst = false;

        try {
          const benchmarkResult = await fetchLatestYahooBenchmarkValue(benchmark);
          if (benchmarkResult.success) {
            try {
              recordFetchAttempt({
                fetchType: "benchmark",
                referenceId: benchmark.id,
                startedBy: startedBy,
                attemptNumber: attemptNumber,
                maxAttempts: options.maxAttempts || attemptNumber,
                success: true,
              });
            } catch (historyErr) {
              console.warn("[FetchService] Failed to record retry history for benchmark " + benchmark.id + ": " + historyErr.message);
            }
          } else {
            result.failedBenchmarkIds.push(benchmark.id);
            if (benchmarkResult.errorCode !== "NO_YAHOO_TICKER") {
              try {
                recordFetchAttempt({
                  fetchType: "benchmark",
                  referenceId: benchmark.id,
                  startedBy: startedBy,
                  attemptNumber: attemptNumber,
                  maxAttempts: options.maxAttempts || attemptNumber,
                  success: false,
                  errorCode: benchmarkResult.errorCode,
                  errorMessage: benchmarkResult.error,
                });
              } catch (historyErr) {
                console.warn("[FetchService] Failed to record retry history for benchmark " + benchmark.id + ": " + historyErr.message);
              }
            }
          }
          if (onRetryResult) {
            onRetryResult("benchmark", benchmark.id, benchmarkResult);
          }
        } catch (err) {
          result.failedBenchmarkIds.push(benchmark.id);
          try {
            recordFetchAttempt({
              fetchType: "benchmark",
              referenceId: benchmark.id,
              startedBy: startedBy,
              attemptNumber: attemptNumber,
              maxAttempts: options.maxAttempts || attemptNumber,
              success: false,
              errorCode: "API_ERROR",
              errorMessage: err.message,
            });
          } catch (historyErr) {
            console.warn("[FetchService] Failed to record retry history for benchmark " + benchmark.id + ": " + historyErr.message);
          }
          if (onRetryResult) {
            onRetryResult("benchmark", benchmark.id, {
              success: false,
              benchmarkId: benchmark.id,
              description: benchmark.description,
              error: "Unexpected error: " + err.message,
              errorCode: "API_ERROR",
            });
          }
        }
      }
    }
  } finally {
    // No browser cleanup needed — API-only
  }

  return result;
}

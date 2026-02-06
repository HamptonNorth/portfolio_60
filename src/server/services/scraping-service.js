import { fetchCurrencyRates } from "../scrapers/currency-scraper.js";
import {
  getScrapeableInvestments,
  scrapeSingleInvestmentPrice,
  extractDomain as extractPriceDomain,
  calculateDelay as calculatePriceDelay,
} from "../scrapers/price-scraper.js";
import {
  getScrapeableBenchmarks,
  scrapeSingleBenchmarkValue,
  extractDomain as extractBenchmarkDomain,
  calculateDelay as calculateBenchmarkDelay,
} from "../scrapers/benchmark-scraper.js";
import { launchBrowser } from "../scrapers/browser-utils.js";

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
 * @description Run a complete scraping cycle: currency rates first, then
 * investment prices, then benchmark values. Calls optional callback hooks
 * as each item completes, allowing callers to report progress.
 *
 * This function does NOT include retry logic for failed items. Retries
 * are handled by the caller (the scheduled scraper uses slow retries
 * via retryFailedItems; the SSE routes use their own fast inline retries).
 *
 * @param {Object} [options={}] - Scraping options
 * @param {number} [options.startedBy=0] - 0 = manual/interactive, 1 = scheduled/cron
 * @param {string} [options.delayProfile] - "interactive" or "cron". Sets the
 *   SCRAPE_DELAY_PROFILE env var so that calculateDelay() in the scrapers
 *   picks up the correct timing profile.
 * @param {Function} [options.onCurrencyRates] - Called with the currency rates result object
 * @param {Function} [options.onPriceResult] - Called with each price scrape result
 * @param {Function} [options.onBenchmarkResult] - Called with each benchmark scrape result
 * @param {Function} [options.onComplete] - Called with the final summary object
 * @param {Function} [options.onError] - Called if a fatal error occurs
 * @returns {Promise<Object>} Summary with failedCurrencyIds, failedInvestmentIds,
 *   failedBenchmarkIds, priceSuccessCount, priceFailCount, benchmarkSuccessCount,
 *   benchmarkFailCount, currencySuccess
 */
export async function runFullScrape(options = {}) {
  const startedBy = options.startedBy || 0;
  const delayProfile = options.delayProfile || null;
  const onCurrencyRates = options.onCurrencyRates || null;
  const onPriceResult = options.onPriceResult || null;
  const onBenchmarkResult = options.onBenchmarkResult || null;
  const onComplete = options.onComplete || null;
  const onError = options.onError || null;

  // Set the delay profile env var so the scrapers' calculateDelay() uses it
  const previousProfile = process.env.SCRAPE_DELAY_PROFILE;
  if (delayProfile) {
    process.env.SCRAPE_DELAY_PROFILE = delayProfile;
  }

  // Capture a shared timestamp so all values from this run are contemporaneous
  const scrapeTime = new Date().toTimeString().slice(0, 8);

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

  let browser = null;

  try {
    // Step 1: Fetch currency rates (always first for contemporaneous data)
    const currencyResult = await fetchCurrencyRates({
      startedBy: startedBy,
      scrapeTime: scrapeTime,
    });

    summary.currencySuccess = currencyResult.success;
    if (onCurrencyRates) {
      onCurrencyRates(currencyResult);
    }

    // Step 2: Scrape investment prices
    const investments = getScrapeableInvestments();

    if (investments.length > 0) {
      browser = await launchBrowser();
      let previousDomain = "";

      for (const investment of investments) {
        // Domain-aware delay between requests
        const currentDomain = extractPriceDomain(investment.investment_url);
        const delayMs = calculatePriceDelay(previousDomain, currentDomain);
        if (delayMs > 0) {
          await sleep(delayMs);
        }

        const priceResult = await scrapeSingleInvestmentPrice(investment, browser, {
          scrapeTime: scrapeTime,
          startedBy: startedBy,
          attemptNumber: 1,
        });

        if (priceResult.success) {
          summary.priceSuccessCount++;
        } else {
          summary.priceFailCount++;
          summary.failedInvestmentIds.push(investment.id);
        }

        if (onPriceResult) {
          onPriceResult(priceResult);
        }

        previousDomain = currentDomain;
      }
    }

    // Step 3: Scrape benchmark values
    const benchmarks = getScrapeableBenchmarks();

    if (benchmarks.length > 0) {
      // Reuse browser if already launched, otherwise launch now
      if (!browser) {
        browser = await launchBrowser();
      }
      let previousDomain = "";

      for (const benchmark of benchmarks) {
        // Domain-aware delay between requests
        const currentDomain = extractBenchmarkDomain(benchmark.benchmark_url);
        const delayMs = calculateBenchmarkDelay(previousDomain, currentDomain);
        if (delayMs > 0) {
          await sleep(delayMs);
        }

        const benchmarkResult = await scrapeSingleBenchmarkValue(benchmark, browser, {
          scrapeTime: scrapeTime,
          startedBy: startedBy,
          attemptNumber: 1,
        });

        if (benchmarkResult.success) {
          summary.benchmarkSuccessCount++;
        } else {
          summary.benchmarkFailCount++;
          summary.failedBenchmarkIds.push(benchmark.id);
        }

        if (onBenchmarkResult) {
          onBenchmarkResult(benchmarkResult);
        }

        previousDomain = currentDomain;
      }
    }

    if (onComplete) {
      onComplete(summary);
    }
  } catch (err) {
    if (onError) {
      onError(err);
    } else {
      throw err;
    }
  } finally {
    // Close browser
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Ignore close errors
      }
    }

    // Restore the previous delay profile env var
    if (delayProfile) {
      if (previousProfile !== undefined) {
        process.env.SCRAPE_DELAY_PROFILE = previousProfile;
      } else {
        delete process.env.SCRAPE_DELAY_PROFILE;
      }
    }
  }

  return summary;
}

/**
 * @description Retry specific failed items from a previous scrape run.
 * Launches a browser and retries each failed investment and benchmark
 * individually. Currency rates are re-fetched as a whole (the API call
 * is cheap since it fetches all currencies in one request).
 *
 * @param {Object} failedItems - IDs of items to retry
 * @param {number[]} failedItems.investmentIds - Investment IDs to retry
 * @param {number[]} failedItems.benchmarkIds - Benchmark IDs to retry
 * @param {boolean} failedItems.retryCurrency - Whether to retry currency rates
 * @param {Object} [options={}] - Retry options
 * @param {number} [options.attemptNumber=2] - Current retry attempt number (2, 3, 4, 5)
 * @param {number} [options.startedBy=0] - 0 = manual, 1 = cron
 * @param {string} [options.delayProfile] - "interactive" or "cron"
 * @param {Function} [options.onRetryResult] - Called with (type, id, result) for each retry
 * @returns {Promise<Object>} Updated failure lists: { failedInvestmentIds, failedBenchmarkIds, currencySuccess }
 */
export async function retryFailedItems(failedItems, options = {}) {
  const attemptNumber = options.attemptNumber || 2;
  const startedBy = options.startedBy || 0;
  const delayProfile = options.delayProfile || null;
  const onRetryResult = options.onRetryResult || null;

  // Set the delay profile env var
  const previousProfile = process.env.SCRAPE_DELAY_PROFILE;
  if (delayProfile) {
    process.env.SCRAPE_DELAY_PROFILE = delayProfile;
  }

  const scrapeTime = new Date().toTimeString().slice(0, 8);
  const result = {
    currencySuccess: true,
    failedInvestmentIds: [],
    failedBenchmarkIds: [],
  };

  let browser = null;

  try {
    // Retry currency rates if requested
    if (failedItems.retryCurrency) {
      const currencyResult = await fetchCurrencyRates({
        startedBy: startedBy,
        attemptNumber: attemptNumber,
        scrapeTime: scrapeTime,
      });
      result.currencySuccess = currencyResult.success;
      if (onRetryResult) {
        onRetryResult("currency", null, currencyResult);
      }
    }

    // Retry failed investments
    const investmentIds = failedItems.investmentIds || [];
    if (investmentIds.length > 0) {
      // Get the full investment objects for the failed IDs
      const allInvestments = getScrapeableInvestments();
      const investmentsToRetry = allInvestments.filter(function (inv) {
        return investmentIds.includes(inv.id);
      });

      browser = await launchBrowser();
      let previousDomain = "";

      for (const investment of investmentsToRetry) {
        const currentDomain = extractPriceDomain(investment.investment_url);
        const delayMs = calculatePriceDelay(previousDomain, currentDomain);
        if (delayMs > 0) {
          await sleep(delayMs);
        }

        const priceResult = await scrapeSingleInvestmentPrice(investment, browser, {
          scrapeTime: scrapeTime,
          startedBy: startedBy,
          attemptNumber: attemptNumber,
        });

        if (!priceResult.success) {
          result.failedInvestmentIds.push(investment.id);
        }

        if (onRetryResult) {
          onRetryResult("investment", investment.id, priceResult);
        }

        previousDomain = currentDomain;
      }
    }

    // Retry failed benchmarks
    const benchmarkIds = failedItems.benchmarkIds || [];
    if (benchmarkIds.length > 0) {
      const allBenchmarks = getScrapeableBenchmarks();
      const benchmarksToRetry = allBenchmarks.filter(function (bm) {
        return benchmarkIds.includes(bm.id);
      });

      // Reuse browser if already launched
      if (!browser) {
        browser = await launchBrowser();
      }
      let previousDomain = "";

      for (const benchmark of benchmarksToRetry) {
        const currentDomain = extractBenchmarkDomain(benchmark.benchmark_url);
        const delayMs = calculateBenchmarkDelay(previousDomain, currentDomain);
        if (delayMs > 0) {
          await sleep(delayMs);
        }

        const benchmarkResult = await scrapeSingleBenchmarkValue(benchmark, browser, {
          scrapeTime: scrapeTime,
          startedBy: startedBy,
          attemptNumber: attemptNumber,
        });

        if (!benchmarkResult.success) {
          result.failedBenchmarkIds.push(benchmark.id);
        }

        if (onRetryResult) {
          onRetryResult("benchmark", benchmark.id, benchmarkResult);
        }

        previousDomain = currentDomain;
      }
    }
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Ignore close errors
      }
    }

    // Restore the previous delay profile env var
    if (delayProfile) {
      if (previousProfile !== undefined) {
        process.env.SCRAPE_DELAY_PROFILE = previousProfile;
      } else {
        delete process.env.SCRAPE_DELAY_PROFILE;
      }
    }
  }

  return result;
}

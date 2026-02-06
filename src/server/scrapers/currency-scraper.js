import { getAllCurrencies } from "../db/currencies-db.js";
import { upsertRate, scaleRate } from "../db/currency-rates-db.js";
import { recordScrapingAttempt } from "../db/scraping-history-db.js";

/**
 * @description The Frankfurter API base URL for fetching exchange rates.
 * Uses ECB (European Central Bank) data. Free, no API key required.
 * @type {string}
 */
const FRANKFURTER_API_URL = "https://api.frankfurter.dev/v1/latest";

/**
 * @description Fetch current exchange rates for all non-GBP currencies from the
 * Frankfurter API and store them in the database. Rates are relative to GBP
 * (i.e. how many units of the foreign currency per 1 GBP).
 *
 * The API returns rates with GBP as the base currency. Each rate is scaled
 * by CURRENCY_SCALE_FACTOR (10000) and stored as an integer using INSERT OR REPLACE,
 * so re-fetching on the same day overwrites the previous values.
 *
 * @param {Object} [options={}] - Additional options
 * @param {number} [options.startedBy=0] - 0 = manual/interactive, 1 = scheduled/cron
 * @param {number} [options.attemptNumber=1] - Retry attempt counter (1-5)
 * @param {boolean} [options.testMode=false] - If true, skip database writes (for testing)
 * @param {string} [options.scrapeTime=null] - Time to store (HH:MM:SS). If not provided, uses current time.
 * @returns {Promise<{success: boolean, rates: Object[], message: string, error?: string}>}
 *   - success: whether the fetch and store completed without error
 *   - rates: array of {code, description, rate, scaledRate, rateDate, rateTime} for each currency processed
 *   - message: human-readable summary
 *   - error: error message if success is false
 */
export async function fetchCurrencyRates(options = {}) {
  const startedBy = options.startedBy || 0;
  const attemptNumber = options.attemptNumber || 1;
  const testMode = options.testMode || false;
  const scrapeTime = options.scrapeTime || new Date().toTimeString().slice(0, 8);
  // Get all non-GBP currencies from the database
  const allCurrencies = getAllCurrencies();
  const nonGbpCurrencies = allCurrencies.filter(function (c) {
    return c.code !== "GBP";
  });

  if (nonGbpCurrencies.length === 0) {
    return {
      success: true,
      rates: [],
      message: "No non-GBP currencies to fetch rates for",
    };
  }

  // Build the symbols parameter (comma-separated currency codes)
  const symbols = nonGbpCurrencies
    .map(function (c) {
      return c.code;
    })
    .join(",");

  const url = FRANKFURTER_API_URL + "?base=GBP&symbols=" + symbols;

  let apiResponse;
  try {
    apiResponse = await fetch(url);
  } catch (networkError) {
    return {
      success: false,
      rates: [],
      message: "Failed to connect to the Frankfurter API",
      error: networkError.message,
    };
  }

  if (!apiResponse.ok) {
    let errorText;
    try {
      errorText = await apiResponse.text();
    } catch {
      errorText = "Unknown error";
    }
    return {
      success: false,
      rates: [],
      message: "Frankfurter API returned an error (HTTP " + apiResponse.status + ")",
      error: errorText,
    };
  }

  let data;
  try {
    data = await apiResponse.json();
  } catch (parseError) {
    return {
      success: false,
      rates: [],
      message: "Failed to parse Frankfurter API response",
      error: parseError.message,
    };
  }

  // The API returns: { base: "GBP", date: "2026-02-05", rates: { "USD": 1.2543, "EUR": 1.1832, ... } }
  const rateDate = data.date;
  const apiRates = data.rates || {};

  const storedRates = [];
  const skippedCodes = [];

  for (const currency of nonGbpCurrencies) {
    const decimalRate = apiRates[currency.code];

    if (decimalRate === undefined || decimalRate === null) {
      // The API did not return a rate for this currency code
      skippedCodes.push(currency.code);
      // Record failed attempt in history (skip in test mode)
      if (!testMode) {
        recordScrapingAttempt({
          scrapeType: "currency",
          referenceId: currency.id,
          startedBy: startedBy,
          attemptNumber: attemptNumber,
          success: false,
          errorCode: "NO_RATE",
          errorMessage: "API did not return a rate for " + currency.code,
        });
      }
      continue;
    }

    const scaledRate = scaleRate(decimalRate);

    // Store in the database (skip in test mode)
    if (!testMode) {
      // INSERT OR REPLACE for same currency+date
      upsertRate(currency.id, rateDate, scrapeTime, scaledRate);

      // Record successful attempt in history
      recordScrapingAttempt({
        scrapeType: "currency",
        referenceId: currency.id,
        startedBy: startedBy,
        attemptNumber: attemptNumber,
        success: true,
        errorCode: null,
        errorMessage: null,
      });
    }

    storedRates.push({
      code: currency.code,
      description: currency.description,
      rate: decimalRate,
      scaledRate: scaledRate,
      rateDate: rateDate,
      rateTime: scrapeTime,
    });
  }

  let message = "Fetched " + storedRates.length + " exchange rate" + (storedRates.length === 1 ? "" : "s") + " for " + rateDate;
  if (skippedCodes.length > 0) {
    message += ". No rate available for: " + skippedCodes.join(", ");
  }

  return {
    success: true,
    rates: storedRates,
    message: message,
  };
}

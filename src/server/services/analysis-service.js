/**
 * @description Analysis service for Portfolio 60.
 * Computes investment returns, volatility, league tables, risk/return scatter
 * data, and top/bottom performer series for the analysis page.
 */

import { getInvestmentsWithPrices, getInvestmentsWithPricesByIds } from "../db/investments-db.js";
import { getAllInvestmentPricesInRange } from "../db/prices-db.js";
import { getRatesInRange } from "../db/currency-rates-db.js";
import { getBenchmarkById } from "../db/benchmarks-db.js";
import { getBenchmarkDataInRange } from "../db/benchmark-data-db.js";
import { getCurrentHoldingInvestmentIds, getHistoricHoldingInvestmentIds } from "../db/holdings-db.js";
import { convertPricesToGBP, sampleWeekly, rebaseToZero, generateWeeklyDates, formatISODate } from "./price-utils.js";

/**
 * @description Period code to number of weeks mapping.
 * @type {Object<string, number>}
 */
const PERIOD_WEEKS = {
  "1w": 1,
  "1m": 4,
  "3m": 13,
  "6m": 26,
  "1y": 52,
  "2y": 104,
  "3y": 156,
};

/**
 * @description Human-readable period labels for PDF subtitles.
 * @type {Object<string, string>}
 */
const PERIOD_LABELS = {
  "1w": "1 Week",
  "1m": "1 Month",
  "3m": "3 Months",
  "6m": "6 Months",
  "1y": "1 Year",
  "2y": "2 Years",
  "3y": "3 Years",
};

/**
 * @description Resolve the set of investment IDs to include based on the
 * holdings filter and selected user IDs. Returns null when no filtering
 * is needed (i.e. "all investments").
 * @param {string} holdingsFilter - "current", "historic", or "all"
 * @param {Array<number>} userIds - Array of user IDs to filter by
 * @returns {Array<number>|null} Array of investment IDs, or null for no filtering
 */
export function resolveInvestmentIds(holdingsFilter, userIds, accountTypes) {
  if (holdingsFilter === "current") {
    return getCurrentHoldingInvestmentIds(userIds, accountTypes);
  }
  if (holdingsFilter === "historic") {
    return getHistoricHoldingInvestmentIds(userIds, accountTypes);
  }
  // "all" — no filtering
  return null;
}

/**
 * @description Get the investments list, optionally filtered by investment IDs.
 * When investmentIds is null, returns all investments with prices.
 * When investmentIds is an array, returns only those investments (that also have prices).
 * @param {Array<number>|null} investmentIds - Array of IDs to filter by, or null for all
 * @returns {Array<Object>} Array of investment objects
 */
function getFilteredInvestments(investmentIds) {
  if (investmentIds === null) {
    return getInvestmentsWithPrices();
  }
  return getInvestmentsWithPricesByIds(investmentIds);
}

/**
 * @description Calculate the start and end dates for a given period code.
 * @param {string} periodCode - One of "1w", "1m", "3m", "6m", "1y", "3y"
 * @returns {Object} Object with startDate (Date), endDate (Date), fromStr and toStr (ISO strings)
 */
function getDateRange(periodCode) {
  const weeks = PERIOD_WEEKS[periodCode] || 52;
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - weeks * 7);

  return {
    startDate: startDate,
    endDate: endDate,
    fromStr: formatISODate(startDate),
    toStr: formatISODate(endDate),
  };
}

/**
 * @description Get GBP-converted prices for an investment within a date range.
 * If the investment is priced in a non-GBP currency, prices are converted
 * using contemporaneous currency rates.
 * @param {Object} investment - Investment object with id, currencies_id, currency_code
 * @param {Map<number, Array<Object>>} allPricesMap - Bulk prices map from getAllInvestmentPricesInRange
 * @param {string} fromStr - ISO-8601 start date
 * @param {string} toStr - ISO-8601 end date
 * @returns {Array<Object>|null} GBP-converted price records or null if no data
 */
function getGBPPrices(investment, allPricesMap, fromStr, toStr) {
  let prices = allPricesMap.get(investment.id);
  if (!prices || prices.length === 0) return null;

  if (investment.currency_code && investment.currency_code !== "GBP") {
    const rates = getRatesInRange(investment.currencies_id, fromStr, toStr);
    prices = convertPricesToGBP(prices, rates);
  }

  return prices;
}

/**
 * @description Calculate the percentage return between the first and last price
 * in an array of price records.
 * @param {Array<Object>} prices - Price records with price_date and price
 * @returns {Object} Object with returnPct, startPrice, endPrice, startDate, endDate
 */
function calculateReturn(prices) {
  if (!prices || prices.length < 2) {
    return { returnPct: null, startPrice: null, endPrice: null, startDate: null, endDate: null };
  }

  const startPrice = prices[0].price;
  const endPrice = prices[prices.length - 1].price;
  const returnPct = startPrice > 0 ? ((endPrice - startPrice) / startPrice) * 100 : null;

  return {
    returnPct: returnPct,
    startPrice: startPrice,
    endPrice: endPrice,
    startDate: prices[0].price_date,
    endDate: prices[prices.length - 1].price_date,
  };
}

/**
 * @description Calculate the annualised volatility of weekly returns.
 * Volatility is the annualised standard deviation of weekly percentage changes.
 * @param {Array<Object>} prices - Price records with price_date and price, sorted ascending
 * @returns {Object} Object with volatility (annualised %) and weeklyReturnCount
 */
function calculateVolatility(prices) {
  if (!prices || prices.length < 3) {
    return { volatility: null, weeklyReturnCount: 0 };
  }

  // Sample to weekly intervals to avoid double-counting daily data
  const startDate = new Date(prices[0].price_date);
  const endDate = new Date(prices[prices.length - 1].price_date);
  const sampleDates = generateWeeklyDates(startDate, endDate);
  const weeklyValues = sampleWeekly(sampleDates, prices, "price_date", "price");

  // Calculate weekly returns
  const weeklyReturns = [];
  for (let i = 1; i < weeklyValues.length; i++) {
    if (weeklyValues[i] !== null && weeklyValues[i - 1] !== null && weeklyValues[i - 1] > 0) {
      weeklyReturns.push((weeklyValues[i] - weeklyValues[i - 1]) / weeklyValues[i - 1]);
    }
  }

  if (weeklyReturns.length < 2) {
    return { volatility: null, weeklyReturnCount: 0 };
  }

  // Calculate mean
  let sum = 0;
  for (let j = 0; j < weeklyReturns.length; j++) {
    sum += weeklyReturns[j];
  }
  const mean = sum / weeklyReturns.length;

  // Calculate variance
  let sumSquaredDiffs = 0;
  for (let k = 0; k < weeklyReturns.length; k++) {
    const diff = weeklyReturns[k] - mean;
    sumSquaredDiffs += diff * diff;
  }
  const variance = sumSquaredDiffs / (weeklyReturns.length - 1); // Sample variance

  // Annualise: stdDev * sqrt(52) and convert to percentage
  const annualisedVolatility = Math.sqrt(variance) * Math.sqrt(52) * 100;

  return {
    volatility: annualisedVolatility,
    weeklyReturnCount: weeklyReturns.length,
  };
}

/**
 * @description Build sparkline data for an investment — an array of normalised
 * values sampled weekly, rebased to 100 at the start.
 * @param {Array<Object>} prices - GBP-converted price records
 * @param {Array<string>} sampleDates - Weekly sample dates
 * @returns {Array<number|null>} Sparkline values rebased to 100
 */
function buildSparkline(prices, sampleDates) {
  if (!prices || prices.length === 0) return [];

  const weeklyValues = sampleWeekly(sampleDates, prices, "price_date", "price");

  // Rebase to 100 at the first non-null value
  let base = null;
  for (let i = 0; i < weeklyValues.length; i++) {
    if (weeklyValues[i] !== null) {
      base = weeklyValues[i];
      break;
    }
  }

  if (base === null || base === 0) return weeklyValues;

  const rebased = [];
  for (let j = 0; j < weeklyValues.length; j++) {
    if (weeklyValues[j] === null) {
      rebased.push(null);
    } else {
      rebased.push((weeklyValues[j] / base) * 100);
    }
  }
  return rebased;
}

/**
 * @description Build the league table data for all investments with price data.
 * Returns investments ranked by return for the given period.
 * @param {string} periodCode - One of "1w", "1m", "3m", "6m", "1y", "3y"
 * @param {Array<number>|null} investmentIds - Optional array of investment IDs to filter by
 * @returns {Object} League table data with period info and ranked investments
 */
export function buildLeagueTable(periodCode, investmentIds) {
  const range = getDateRange(periodCode);
  const investments = getFilteredInvestments(investmentIds);
  const allPricesMap = getAllInvestmentPricesInRange(range.fromStr, range.toStr);
  const sampleDates = generateWeeklyDates(range.startDate, range.endDate);

  const rows = [];

  for (let i = 0; i < investments.length; i++) {
    const inv = investments[i];
    const prices = getGBPPrices(inv, allPricesMap, range.fromStr, range.toStr);
    if (!prices || prices.length < 2) continue;

    const returnData = calculateReturn(prices);
    if (returnData.returnPct === null) continue;

    const sparkline = buildSparkline(prices, sampleDates);

    rows.push({
      id: inv.id,
      description: inv.description,
      publicId: inv.public_id || null,
      morningstarId: inv.morningstar_id || null,
      currencyCode: inv.currency_code,
      typeShort: inv.type_short,
      returnPct: Math.round(returnData.returnPct * 100) / 100,
      startDate: returnData.startDate,
      endDate: returnData.endDate,
      sparkline: sparkline,
    });
  }

  // Sort by return descending (best first)
  rows.sort(function (a, b) {
    return b.returnPct - a.returnPct;
  });

  return {
    period: periodCode,
    periodLabel: PERIOD_LABELS[periodCode] || periodCode,
    asOf: range.toStr,
    investments: rows,
  };
}

/**
 * @description Build risk vs return scatter data for all investments.
 * Each investment gets a return percentage and annualised volatility.
 * @param {string} periodCode - One of "1w", "1m", "3m", "6m", "1y", "3y"
 * @param {Array<number>|null} investmentIds - Optional array of investment IDs to filter by
 * @returns {Object} Scatter data with period info and investment data points
 */
export function buildRiskReturnData(periodCode, investmentIds) {
  const range = getDateRange(periodCode);
  const investments = getFilteredInvestments(investmentIds);
  const allPricesMap = getAllInvestmentPricesInRange(range.fromStr, range.toStr);

  const points = [];

  for (let i = 0; i < investments.length; i++) {
    const inv = investments[i];
    const prices = getGBPPrices(inv, allPricesMap, range.fromStr, range.toStr);
    if (!prices || prices.length < 3) continue;

    const returnData = calculateReturn(prices);
    if (returnData.returnPct === null) continue;

    const volData = calculateVolatility(prices);
    if (volData.volatility === null) continue;

    points.push({
      id: inv.id,
      description: inv.description,
      publicId: inv.public_id || null,
      morningstarId: inv.morningstar_id || null,
      typeShort: inv.type_short,
      returnPct: Math.round(returnData.returnPct * 100) / 100,
      volatility: Math.round(volData.volatility * 100) / 100,
    });
  }

  return {
    period: periodCode,
    periodLabel: PERIOD_LABELS[periodCode] || periodCode,
    asOf: range.toStr,
    investments: points,
  };
}

/**
 * @description Build rebased time series for the top N and bottom N performers.
 * Series are rebased to 0% at the start of the period (same as performance charts).
 * @param {string} periodCode - One of "1w", "1m", "3m", "6m", "1y", "3y"
 * @param {number} count - Number of top and bottom performers to include (default 5)
 * @param {Array<number>|null} investmentIds - Optional array of investment IDs to filter by
 * @returns {Object} Top/bottom data with series arrays and sample dates
 */
export function buildTopBottomPerformers(periodCode, count, investmentIds) {
  count = count || 5;
  const range = getDateRange(periodCode);
  const investments = getFilteredInvestments(investmentIds);
  const allPricesMap = getAllInvestmentPricesInRange(range.fromStr, range.toStr);
  const sampleDates = generateWeeklyDates(range.startDate, range.endDate);

  // Calculate returns for all investments to rank them
  const ranked = [];
  for (let i = 0; i < investments.length; i++) {
    const inv = investments[i];
    const prices = getGBPPrices(inv, allPricesMap, range.fromStr, range.toStr);
    if (!prices || prices.length < 2) continue;

    const returnData = calculateReturn(prices);
    if (returnData.returnPct === null) continue;

    // Build rebased series (percentage change from 0)
    const weeklyValues = sampleWeekly(sampleDates, prices, "price_date", "price");
    const rebased = rebaseToZero(weeklyValues);

    ranked.push({
      id: inv.id,
      description: inv.description,
      publicId: inv.public_id || null,
      morningstarId: inv.morningstar_id || null,
      currencyCode: inv.currency_code,
      returnPct: returnData.returnPct,
      values: rebased,
    });
  }

  // Sort by return descending
  ranked.sort(function (a, b) {
    return b.returnPct - a.returnPct;
  });

  // Take top N and bottom N (avoiding overlap if fewer than 2*count investments)
  const topN = ranked.slice(0, count);
  const bottomN = ranked.slice(-count);

  // Remove any overlap (if total investments <= 2 * count)
  const topIds = {};
  for (let t = 0; t < topN.length; t++) {
    topIds[topN[t].id] = true;
  }
  const filteredBottom = [];
  for (let b = 0; b < bottomN.length; b++) {
    if (!topIds[bottomN[b].id]) {
      filteredBottom.push(bottomN[b]);
    }
  }

  // Build series objects for the chart
  const buildSeries = function (items) {
    return items.map(function (item) {
      return {
        label: item.description,
        publicId: item.publicId,
        morningstarId: item.morningstarId,
        currencyCode: item.currencyCode,
        returnPct: Math.round(item.returnPct * 100) / 100,
        values: item.values,
      };
    });
  };

  return {
    period: periodCode,
    periodLabel: PERIOD_LABELS[periodCode] || periodCode,
    asOf: range.toStr,
    sampleDates: sampleDates,
    topSeries: buildSeries(topN),
    bottomSeries: buildSeries(filteredBottom),
  };
}

/**
 * @description Map benchmark data records to the price_date/price field names
 * used by calculateReturn() and calculateVolatility().
 * @param {Array<Object>} bmValues - Benchmark data records with benchmark_date and value
 * @returns {Array<Object>} Records with price_date and price fields
 */
function mapBenchmarkToPrice(bmValues) {
  const mapped = [];
  for (let i = 0; i < bmValues.length; i++) {
    mapped.push({ price_date: bmValues[i].benchmark_date, price: bmValues[i].value });
  }
  return mapped;
}

/**
 * @description Build return and volatility data for a set of benchmarks.
 * Used by the scatter plot and comparison views.
 * @param {Array<number>} benchmarkIds - Array of benchmark IDs to include
 * @param {string} periodCode - Period code (e.g. "1y")
 * @returns {Array<Object>} Array of benchmark data points with returnPct and volatility
 */
export function buildBenchmarkReturnData(benchmarkIds, periodCode) {
  if (!benchmarkIds || benchmarkIds.length === 0) return [];

  const range = getDateRange(periodCode);
  const results = [];

  for (let i = 0; i < benchmarkIds.length; i++) {
    const bm = getBenchmarkById(benchmarkIds[i]);
    if (!bm) continue;

    const bmValues = getBenchmarkDataInRange(bm.id, range.fromStr, range.toStr);
    if (!bmValues || bmValues.length < 3) continue;

    const mapped = mapBenchmarkToPrice(bmValues);
    const returnData = calculateReturn(mapped);
    if (returnData.returnPct === null) continue;

    const volData = calculateVolatility(mapped);

    results.push({
      id: bm.id,
      description: bm.description,
      returnPct: Math.round(returnData.returnPct * 100) / 100,
      volatility: volData.volatility !== null ? Math.round(volData.volatility * 100) / 100 : null,
    });
  }

  return results;
}

/**
 * @description Build rebased time series for a set of benchmarks.
 * Used by the top/bottom performers charts as reference lines.
 * @param {Array<number>} benchmarkIds - Array of benchmark IDs to include
 * @param {string} periodCode - Period code (e.g. "1y")
 * @returns {Object} Object with benchmarkSeries array and sampleDates
 */
export function buildBenchmarkRebasedSeries(benchmarkIds, periodCode) {
  if (!benchmarkIds || benchmarkIds.length === 0) return { benchmarkSeries: [], sampleDates: [] };

  const range = getDateRange(periodCode);
  const sampleDates = generateWeeklyDates(range.startDate, range.endDate);
  const series = [];

  for (let i = 0; i < benchmarkIds.length; i++) {
    const bm = getBenchmarkById(benchmarkIds[i]);
    if (!bm) continue;

    const bmValues = getBenchmarkDataInRange(bm.id, range.fromStr, range.toStr);
    if (!bmValues || bmValues.length < 2) continue;

    const weeklyValues = sampleWeekly(sampleDates, bmValues, "benchmark_date", "value");
    const rebased = rebaseToZero(weeklyValues);

    const mapped = mapBenchmarkToPrice(bmValues);
    const returnData = calculateReturn(mapped);

    series.push({
      label: bm.description,
      returnPct: returnData.returnPct !== null ? Math.round(returnData.returnPct * 100) / 100 : null,
      values: rebased,
    });
  }

  return { benchmarkSeries: series, sampleDates: sampleDates };
}

/**
 * @description Build comparison table data showing returns for multiple periods.
 * Returns all investments with return % for each of the requested periods,
 * plus optional benchmark rows.
 * @param {Array<string>} periodCodes - Array of period codes (e.g. ["3m", "6m", "1y", "3y"])
 * @param {Array<number>} benchmarkIds - Optional array of benchmark IDs
 * @param {Array<number>|null} investmentIds - Optional array of investment IDs to filter by
 * @returns {Object} Comparison data with periods, investments, and benchmarks
 */
export function buildComparisonTable(periodCodes, benchmarkIds, investmentIds) {
  periodCodes = periodCodes || ["3m", "6m", "1y", "3y"];
  benchmarkIds = benchmarkIds || [];

  // Sort periods by duration (shortest first) for display
  periodCodes.sort(function (a, b) {
    return (PERIOD_WEEKS[a] || 0) - (PERIOD_WEEKS[b] || 0);
  });

  const periods = [];
  for (let p = 0; p < periodCodes.length; p++) {
    periods.push({ code: periodCodes[p], label: PERIOD_LABELS[periodCodes[p]] || periodCodes[p] });
  }

  // Use the widest period for the bulk price query
  const widestCode = periodCodes[periodCodes.length - 1];
  const widestRange = getDateRange(widestCode);
  const investments = getFilteredInvestments(investmentIds);
  const allPricesMap = getAllInvestmentPricesInRange(widestRange.fromStr, widestRange.toStr);

  // Pre-compute date ranges for each period
  const ranges = {};
  for (let r = 0; r < periodCodes.length; r++) {
    ranges[periodCodes[r]] = getDateRange(periodCodes[r]);
  }

  // Build investment rows
  const investmentRows = [];
  for (let i = 0; i < investments.length; i++) {
    const inv = investments[i];
    const widestPrices = getGBPPrices(inv, allPricesMap, widestRange.fromStr, widestRange.toStr);
    if (!widestPrices || widestPrices.length < 2) continue;

    const returns = {};
    let hasAnyReturn = false;

    for (let pc = 0; pc < periodCodes.length; pc++) {
      const code = periodCodes[pc];
      const periodRange = ranges[code];

      // Filter the already-fetched prices to this period's start date
      const filtered = [];
      for (let f = 0; f < widestPrices.length; f++) {
        if (widestPrices[f].price_date >= periodRange.fromStr) {
          filtered.push(widestPrices[f]);
        }
      }

      if (filtered.length >= 2) {
        const returnData = calculateReturn(filtered);
        if (returnData.returnPct !== null) {
          returns[code] = Math.round(returnData.returnPct * 100) / 100;
          hasAnyReturn = true;
        } else {
          returns[code] = null;
        }
      } else {
        returns[code] = null;
      }
    }

    if (!hasAnyReturn) continue;

    investmentRows.push({
      id: inv.id,
      description: inv.description,
      publicId: inv.public_id || null,
      morningstarId: inv.morningstar_id || null,
      currencyCode: inv.currency_code,
      typeShort: inv.type_short,
      returns: returns,
    });
  }

  // Build benchmark rows
  const benchmarkRows = [];
  for (let b = 0; b < benchmarkIds.length; b++) {
    const bm = getBenchmarkById(benchmarkIds[b]);
    if (!bm) continue;

    const bmReturns = {};
    for (let bpc = 0; bpc < periodCodes.length; bpc++) {
      const bmCode = periodCodes[bpc];
      const bmRange = ranges[bmCode];
      const bmValues = getBenchmarkDataInRange(bm.id, bmRange.fromStr, bmRange.toStr);

      if (bmValues && bmValues.length >= 2) {
        const bmMapped = mapBenchmarkToPrice(bmValues);
        const bmReturnData = calculateReturn(bmMapped);
        bmReturns[bmCode] = bmReturnData.returnPct !== null
          ? Math.round(bmReturnData.returnPct * 100) / 100
          : null;
      } else {
        bmReturns[bmCode] = null;
      }
    }

    benchmarkRows.push({
      id: bm.id,
      description: bm.description,
      returns: bmReturns,
    });
  }

  return {
    periods: periods,
    asOf: widestRange.toStr,
    investments: investmentRows,
    benchmarks: benchmarkRows,
  };
}

export { PERIOD_WEEKS, PERIOD_LABELS, getDateRange, calculateReturn, calculateVolatility };

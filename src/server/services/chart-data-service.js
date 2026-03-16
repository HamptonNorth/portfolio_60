import { getInvestmentByPublicId } from "../db/investments-db.js";
import { getBenchmarkByDescription } from "../db/benchmarks-db.js";
import { getPricesInRange } from "../db/prices-db.js";
import { getBenchmarkDataInRange } from "../db/benchmark-data-db.js";
import { getGlobalEventsInRange } from "../db/global-events-db.js";
import { getRatesInRange } from "../db/currency-rates-db.js";
import { convertPricesToGBP, sampleWeekly, rebaseToZero, generateWeeklyDates, formatISODate } from "./price-utils.js";

/**
 * @description Build chart data for a performance comparison chart.
 * Fetches weekly data points for investments and benchmarks over a date range,
 * then rebases all series to 0% at the first data point.
 *
 * @param {Object} chartDef - Chart definition from user-reports.json
 * @param {string} chartDef.title - Chart title
 * @param {string} [chartDef.subTitle] - Chart subtitle
 * @param {number} [chartDef.fromMonthsAgo=0] - Offset from today for the end date
 * @param {number} [chartDef.monthsToShow=12] - Number of months of data to display
 * @param {Array<string>} chartDef.params - Array of "inv:PUBLIC_ID" or "bm:DESCRIPTION"
 * @returns {Object} Chart data with series array and metadata
 */
export function getChartData(chartDef) {
  var fromMonthsAgo = parseInt(chartDef.fromMonthsAgo) || 0;
  var monthsToShow = parseInt(chartDef.monthsToShow) || 12;

  // Calculate date range
  var endDate = new Date();
  if (fromMonthsAgo > 0) {
    endDate.setMonth(endDate.getMonth() - fromMonthsAgo);
  }
  var startDate = new Date(endDate);
  startDate.setMonth(startDate.getMonth() - monthsToShow);

  var fromStr = formatISODate(startDate);
  var toStr = formatISODate(endDate);

  // Generate weekly sample dates (every 7 days from start to end)
  var sampleDates = generateWeeklyDates(startDate, endDate);

  // Parse params to identify series
  var params = chartDef.params || [];
  var series = [];

  for (var i = 0; i < params.length; i++) {
    var param = params[i];
    var colonIdx = param.indexOf(":");
    if (colonIdx === -1) continue;

    var prefix = param.substring(0, colonIdx).trim();
    var identifier = param.substring(colonIdx + 1).trim();

    if (prefix === "inv") {
      var invSeries = buildInvestmentSeries(identifier, fromStr, toStr, sampleDates);
      if (invSeries) series.push(invSeries);
    } else if (prefix === "bm") {
      var bmSeries = buildBenchmarkSeries(identifier, fromStr, toStr, sampleDates);
      if (bmSeries) series.push(bmSeries);
    }
  }

  // Fetch global events within the date range if requested
  var events = [];
  if (chartDef.showGlobalEvents) {
    var rawEvents = getGlobalEventsInRange(fromStr, toStr);
    for (var e = 0; e < rawEvents.length; e++) {
      events.push({
        date: rawEvents[e].event_date,
        description: rawEvents[e].description.substring(0, 15),
      });
    }
  }

  return {
    title: chartDef.title || "Performance Chart",
    subTitle: chartDef.subTitle || "",
    monthsToShow: monthsToShow,
    sampleDates: sampleDates,
    series: series,
    events: events,
  };
}

/**
 * @description Build a rebased data series for an investment identified by public_id.
 * If the investment is priced in a non-GBP currency, each price is converted to GBP
 * using the currency rate from the same date (nearest on or before).
 * @param {string} publicId - The investment public_id (ISIN or Exchange:Ticker)
 * @param {string} fromStr - ISO-8601 start date
 * @param {string} toStr - ISO-8601 end date
 * @param {Array<string>} sampleDates - Weekly sample dates
 * @returns {Object|null} Series object or null if investment not found
 */
function buildInvestmentSeries(publicId, fromStr, toStr, sampleDates) {
  var inv = getInvestmentByPublicId(publicId);
  if (!inv) return null;

  var allPrices = getPricesInRange(inv.id, fromStr, toStr);
  if (allPrices.length === 0) return null;

  // Convert non-GBP prices to GBP using contemporaneous currency rates
  var needsConversion = inv.currency_code && inv.currency_code !== "GBP";
  if (needsConversion) {
    var allRates = getRatesInRange(inv.currencies_id, fromStr, toStr);
    allPrices = convertPricesToGBP(allPrices, allRates);
  }

  // Sample weekly: for each sample date, find the nearest price on or before
  var weeklyValues = sampleWeekly(sampleDates, allPrices, "price_date", "price");
  var rebased = rebaseToZero(weeklyValues);

  return {
    label: inv.description,
    type: "investment",
    publicId: inv.public_id || null,
    morningstarId: inv.morningstar_id || null,
    currencyCode: inv.currency_code || null,
    values: rebased,
  };
}

/**
 * @description Build a rebased data series for a benchmark identified by description.
 * @param {string} description - The benchmark description (e.g. "FTSE 100")
 * @param {string} fromStr - ISO-8601 start date
 * @param {string} toStr - ISO-8601 end date
 * @param {Array<string>} sampleDates - Weekly sample dates
 * @returns {Object|null} Series object or null if benchmark not found
 */
function buildBenchmarkSeries(description, fromStr, toStr, sampleDates) {
  var bm = getBenchmarkByDescription(description);
  if (!bm) return null;

  var allValues = getBenchmarkDataInRange(bm.id, fromStr, toStr);
  if (allValues.length === 0) return null;

  // Sample weekly: for each sample date, find the nearest value on or before
  var weeklyValues = sampleWeekly(sampleDates, allValues, "benchmark_date", "value");
  var rebased = rebaseToZero(weeklyValues);

  return {
    label: bm.description,
    type: "benchmark",
    values: rebased,
  };
}

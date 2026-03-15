import { getInvestmentByPublicId } from "../db/investments-db.js";
import { getBenchmarkByDescription } from "../db/benchmarks-db.js";
import { getPricesInRange } from "../db/prices-db.js";
import { getBenchmarkDataInRange } from "../db/benchmark-data-db.js";
import { getGlobalEventsInRange } from "../db/global-events-db.js";
import { getRatesInRange } from "../db/currency-rates-db.js";

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
 * @description Convert an array of price records from foreign currency to GBP.
 * For each price, finds the nearest currency rate on or before the price date
 * and divides the price by the rate (rate is foreign currency per 1 GBP).
 * @param {Array<Object>} prices - Sorted ascending price records with price_date and price
 * @param {Array<Object>} rates - Sorted ascending rate records with rate_date and rate
 * @returns {Array<Object>} New array with prices converted to GBP
 */
function convertPricesToGBP(prices, rates) {
  if (rates.length === 0) return prices;

  var converted = [];
  var rateIdx = 0;
  var lastRate = null;

  for (var i = 0; i < prices.length; i++) {
    var priceDate = prices[i].price_date;

    // Advance rate index to the last rate on or before this price date
    while (rateIdx < rates.length - 1 && rates[rateIdx + 1].rate_date <= priceDate) {
      rateIdx++;
    }

    // Use rate if it is on or before the price date
    if (rates[rateIdx].rate_date <= priceDate) {
      lastRate = rates[rateIdx].rate;
    }

    if (lastRate !== null && lastRate > 0) {
      converted.push({
        price_date: priceDate,
        price: prices[i].price / lastRate,
      });
    } else {
      // No rate available yet — keep original (better than dropping the point)
      converted.push({
        price_date: priceDate,
        price: prices[i].price,
      });
    }
  }

  return converted;
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

/**
 * @description Sample data at weekly intervals. For each sample date, finds the
 * nearest data point on or before that date from the sorted (ascending) raw data.
 * @param {Array<string>} sampleDates - ISO-8601 dates to sample at
 * @param {Array<Object>} rawData - Sorted ascending array of data records
 * @param {string} dateKey - Property name for the date field
 * @param {string} valueKey - Property name for the value field
 * @returns {Array<number|null>} Sampled values (null where no data available)
 */
function sampleWeekly(sampleDates, rawData, dateKey, valueKey) {
  var values = [];
  var dataIdx = 0;
  var lastValue = null;

  for (var i = 0; i < sampleDates.length; i++) {
    var targetDate = sampleDates[i];

    // Advance data index to the last record on or before targetDate
    while (dataIdx < rawData.length - 1 && rawData[dataIdx + 1][dateKey] <= targetDate) {
      dataIdx++;
    }

    // Check if current data point is on or before target date
    if (rawData[dataIdx][dateKey] <= targetDate) {
      lastValue = rawData[dataIdx][valueKey];
    }

    values.push(lastValue);
  }

  return values;
}

/**
 * @description Rebase a series of values to percentage change from the first
 * non-null value. Returns array of percentage changes where the first point is 0.
 * @param {Array<number|null>} values - Raw sampled values
 * @returns {Array<number|null>} Percentage change values (0 = start, 10 = +10%)
 */
function rebaseToZero(values) {
  // Find the first non-null value as the base
  var base = null;
  for (var i = 0; i < values.length; i++) {
    if (values[i] !== null) {
      base = values[i];
      break;
    }
  }

  if (base === null || base === 0) return values;

  var rebased = [];
  for (var j = 0; j < values.length; j++) {
    if (values[j] === null) {
      rebased.push(null);
    } else {
      rebased.push(((values[j] - base) / base) * 100);
    }
  }
  return rebased;
}

/**
 * @description Generate an array of ISO-8601 date strings at 7-day intervals
 * from startDate to endDate inclusive.
 * @param {Date} startDate - The start date
 * @param {Date} endDate - The end date
 * @returns {Array<string>} Array of ISO-8601 date strings
 */
function generateWeeklyDates(startDate, endDate) {
  var dates = [];
  var current = new Date(startDate);

  while (current <= endDate) {
    dates.push(formatISODate(current));
    current.setDate(current.getDate() + 7);
  }

  // Ensure the end date is included if not already
  var lastDate = dates[dates.length - 1];
  var endStr = formatISODate(endDate);
  if (lastDate !== endStr) {
    dates.push(endStr);
  }

  return dates;
}

/**
 * @description Format a Date object as ISO-8601 date string (YYYY-MM-DD).
 * @param {Date} date - The date to format
 * @returns {string} ISO-8601 date string
 */
function formatISODate(date) {
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1).padStart(2, "0");
  var d = String(date.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

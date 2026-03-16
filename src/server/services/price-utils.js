/**
 * @description Shared utility functions for price data processing.
 * Used by chart-data-service.js, analysis-service.js, and other modules
 * that work with investment price series.
 */

/**
 * @description Convert an array of price records from foreign currency to GBP.
 * For each price, finds the nearest currency rate on or before the price date
 * and divides the price by the rate (rate is foreign currency per 1 GBP).
 * @param {Array<Object>} prices - Sorted ascending price records with price_date and price
 * @param {Array<Object>} rates - Sorted ascending rate records with rate_date and rate
 * @returns {Array<Object>} New array with prices converted to GBP
 */
export function convertPricesToGBP(prices, rates) {
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
 * @description Sample data at weekly intervals. For each sample date, finds the
 * nearest data point on or before that date from the sorted (ascending) raw data.
 * @param {Array<string>} sampleDates - ISO-8601 dates to sample at
 * @param {Array<Object>} rawData - Sorted ascending array of data records
 * @param {string} dateKey - Property name for the date field
 * @param {string} valueKey - Property name for the value field
 * @returns {Array<number|null>} Sampled values (null where no data available)
 */
export function sampleWeekly(sampleDates, rawData, dateKey, valueKey) {
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
export function rebaseToZero(values) {
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
export function generateWeeklyDates(startDate, endDate) {
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
export function formatISODate(date) {
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1).padStart(2, "0");
  var d = String(date.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

import { getAllUsers } from "../db/users-db.js";
import { getAccountsByUserId } from "../db/accounts-db.js";
import { getHoldingsByAccountId } from "../db/holdings-db.js";
import { getLatestPrice, getPriceOnOrBefore } from "../db/prices-db.js";
import { getLatestRates, unscaleRate } from "../db/currency-rates-db.js";

/**
 * @description Currency symbol lookup. Returns the symbol for display
 * on non-GBP holdings (GBP values are shown without a symbol prefix
 * since the report context is always GBP).
 * @type {Object<string, string>}
 */
const CURRENCY_SYMBOLS = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CHF: "CHF ",
  AUD: "A$",
  CAD: "C$",
  NZD: "NZ$",
  SEK: "SEK ",
  NOK: "NOK ",
  DKK: "DKK ",
  HKD: "HK$",
  SGD: "S$",
  ZAR: "R",
};

/**
 * @description Supported period codes and how many months to subtract.
 * @type {Object<string, number>}
 */
const PERIOD_MONTHS = {
  "1m": 1,
  "3m": 3,
  "6m": 6,
  "1y": 12,
  "2y": 24,
  "3y": 36,
  "5y": 60,
  "10y": 120,
  "20y": 240,
};

/**
 * @description Display labels for each period code.
 * @type {Object<string, string>}
 */
const PERIOD_LABELS = {
  "1m": "1 month",
  "3m": "3 months",
  "6m": "6 months",
  "1y": "1 year",
  "2y": "2 years",
  "3y": "3 years",
  "5y": "5 years",
  "10y": "10 years",
  "20y": "20 years",
};

/**
 * @description Calculate the ISO-8601 date string for N months ago from today.
 * If the target day does not exist in the target month (e.g. 31 Jan → Feb),
 * it clamps to the last day of that month.
 * @param {number} monthsAgo - Number of months to go back
 * @returns {string} ISO-8601 date string (YYYY-MM-DD)
 */
function dateMonthsAgo(monthsAgo) {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  return d.toISOString().slice(0, 10);
}

/**
 * @description Round a value to 2 decimal places (pence precision).
 * @param {number} value - The value to round
 * @returns {number} Value rounded to 2 decimal places
 */
function roundToPence(value) {
  return Math.round(value * 100) / 100;
}

/**
 * @description Build a lookup map of latest currency rates keyed by currency code.
 * Rates are unscaled to decimal values (e.g. 1.2543).
 * @returns {Object} Map of currency code to { rate, rate_date }
 */
function buildRatesMap() {
  const latestRates = getLatestRates();
  const map = {};
  for (const r of latestRates) {
    map[r.currency_code] = {
      rate: unscaleRate(r.rate),
      rate_date: r.rate_date,
    };
  }
  return map;
}

/**
 * @description Find a user by initials (case-insensitive).
 * @param {string} initials - The initials to search for (e.g. "BW")
 * @returns {Object|null} The user object, or null if not found
 */
function findUserByInitials(initials) {
  const users = getAllUsers();
  const target = initials.toUpperCase();
  return users.find(function (u) {
    return u.initials && u.initials.toUpperCase() === target;
  }) || null;
}

/**
 * @description Find a specific account for a user by account type (case-insensitive).
 * @param {number} userId - The user ID
 * @param {string} accountType - The account type (isa, sipp, trading)
 * @returns {Object|null} The account object, or null if not found
 */
function findAccountByType(userId, accountType) {
  const accounts = getAccountsByUserId(userId);
  const target = accountType.toLowerCase();
  return accounts.find(function (a) {
    return a.account_type === target;
  }) || null;
}

/**
 * @description Get the portfolio detail for a specific user account, including
 * each holding's current valuation and optional percentage changes from
 * historic prices at specified periods.
 *
 * @param {string} userInitials - User initials (e.g. "BW")
 * @param {string} accountType - Account type (e.g. "isa", "sipp", "trading")
 * @param {string[]} periods - Array of period codes (e.g. ["1m", "3m", "1y", "3y"])
 * @returns {Object|null} Detail object or null if user/account not found
 */
export function getPortfolioDetail(userInitials, accountType, periods) {
  const user = findUserByInitials(userInitials);
  if (!user) return null;

  const account = findAccountByType(user.id, accountType);
  if (!account) return null;

  const ratesMap = buildRatesMap();
  const holdings = getHoldingsByAccountId(account.id);
  const today = new Date().toISOString().slice(0, 10);

  // Resolve which periods are valid and compute target dates
  const resolvedPeriods = [];
  for (const code of periods) {
    const months = PERIOD_MONTHS[code.toLowerCase()];
    if (months) {
      resolvedPeriods.push({
        code: code.toLowerCase(),
        label: PERIOD_LABELS[code.toLowerCase()],
        target_date: dateMonthsAgo(months),
      });
    }
  }

  let totalValueGBP = 0;
  const holdingDetails = [];

  // Per-period totals for value-weighted average calculation
  // We accumulate: sum of (value_gbp × change%) and sum of value_gbp for each period
  const periodWeightedSums = {};
  const periodWeightedBases = {};
  for (const p of resolvedPeriods) {
    periodWeightedSums[p.code] = 0;
    periodWeightedBases[p.code] = 0;
  }

  for (const holding of holdings) {
    const latestPrice = getLatestPrice(holding.investment_id);
    // Price from DB is in minor units (pence/cents) — convert to major units (pounds/dollars)
    const priceMinor = latestPrice ? latestPrice.price : 0;
    const price = priceMinor / 100;
    const priceDate = latestPrice ? latestPrice.price_date : null;

    const currencyCode = holding.currency_code;
    const isGBP = currencyCode === "GBP";
    const currencySymbol = isGBP ? "" : (CURRENCY_SYMBOLS[currencyCode] || currencyCode + " ");

    // Exchange rate for non-GBP currencies
    let rate = null;
    let rateDate = null;
    if (!isGBP) {
      const rateInfo = ratesMap[currencyCode];
      if (rateInfo) {
        rate = rateInfo.rate;
        rateDate = rateInfo.rate_date;
      }
    }

    // Calculate values
    const valueLocal = roundToPence(price * holding.quantity);
    let valueGBP;
    if (isGBP) {
      valueGBP = valueLocal;
    } else if (rate) {
      valueGBP = roundToPence(valueLocal / rate);
    } else {
      valueGBP = valueLocal;
    }

    totalValueGBP += valueGBP;

    // Calculate percentage changes for each requested period
    const changes = [];
    for (const p of resolvedPeriods) {
      const historicPriceRecord = getPriceOnOrBefore(holding.investment_id, p.target_date);
      if (historicPriceRecord) {
        const historicPrice = historicPriceRecord.price / 100;
        if (historicPrice > 0) {
          const changePercent = ((price - historicPrice) / historicPrice) * 100;
          const rounded = Math.round(changePercent * 10) / 10;
          changes.push({
            code: p.code,
            change_percent: rounded,
            historic_price: historicPrice,
            historic_date: historicPriceRecord.price_date,
          });
          // Accumulate for value-weighted average
          periodWeightedSums[p.code] += valueGBP * rounded;
          periodWeightedBases[p.code] += valueGBP;
          continue;
        }
      }
      // No historic price available for this period — omit from changes
      changes.push({ code: p.code, change_percent: null });
    }

    holdingDetails.push({
      investment_id: holding.investment_id,
      description: holding.investment_description,
      currency_code: currencyCode,
      currency_symbol: currencySymbol,
      quantity: holding.quantity,
      average_cost: holding.average_cost,
      price: price,
      price_date: priceDate,
      rate: rate,
      rate_date: rateDate,
      value_local: valueLocal,
      value_gbp: valueGBP,
      changes: changes,
    });
  }

  // Calculate value-weighted average changes for totals row
  const totalChanges = [];
  for (const p of resolvedPeriods) {
    const base = periodWeightedBases[p.code];
    if (base > 0) {
      const weighted = Math.round((periodWeightedSums[p.code] / base) * 10) / 10;
      totalChanges.push({ code: p.code, change_percent: weighted });
    } else {
      totalChanges.push({ code: p.code, change_percent: null });
    }
  }

  return {
    user: {
      id: user.id,
      initials: user.initials,
      first_name: user.first_name,
      last_name: user.last_name,
    },
    account: {
      id: account.id,
      account_type: account.account_type,
      account_ref: account.account_ref,
    },
    valuation_date: today,
    periods: resolvedPeriods.map(function (p) {
      return { code: p.code, label: p.label };
    }),
    holdings: holdingDetails,
    totals: {
      value_gbp: roundToPence(totalValueGBP),
      changes: totalChanges,
    },
  };
}

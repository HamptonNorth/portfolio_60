import { getUserById } from "../db/users-db.js";
import { getAccountsByUserId } from "../db/accounts-db.js";
import { getHoldingsByAccountId } from "../db/holdings-db.js";
import { getLatestPrice } from "../db/prices-db.js";
import { getLatestRates, unscaleRate } from "../db/currency-rates-db.js";
import { CURRENCY_SCALE_FACTOR } from "../../shared/constants.js";

/**
 * @description Build a portfolio summary for a single user, including all accounts,
 * holdings with latest prices, currency conversions to GBP, and totals.
 * @param {number} userId - The user ID
 * @returns {Object|null} The portfolio summary object, or null if user not found
 */
export function getPortfolioSummary(userId) {
  const user = getUserById(userId);
  if (!user) return null;

  // Load latest currency rates into a lookup map keyed by currency code
  const ratesMap = buildRatesMap();

  const accounts = getAccountsByUserId(userId);
  const today = new Date().toISOString().slice(0, 10);

  let totalInvestments = 0;
  let totalCash = 0;

  const accountSummaries = [];

  for (const account of accounts) {
    const holdings = getHoldingsByAccountId(account.id);
    let accountInvestmentsTotal = 0;

    const holdingSummaries = [];

    for (const holding of holdings) {
      const latestPrice = getLatestPrice(holding.investment_id);
      // getLatestPrice returns price in minor units (pence/cents) — convert to major units (pounds/dollars)
      const priceMinor = latestPrice ? latestPrice.price : 0;
      const price = priceMinor / 100;
      const priceDate = latestPrice ? latestPrice.price_date : null;

      const currencyCode = holding.currency_code;
      const isGBP = currencyCode === "GBP";

      // Get exchange rate for non-GBP currencies
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
        // No rate available — cannot convert, show local value as fallback
        valueGBP = valueLocal;
      }

      accountInvestmentsTotal += valueGBP;

      holdingSummaries.push({
        holding_id: holding.id,
        investment_id: holding.investment_id,
        public_id: holding.investment_public_id,
        description: holding.investment_description,
        currency_code: currencyCode,
        quantity: holding.quantity,
        price: price,
        price_date: priceDate,
        rate: rate,
        rate_date: rateDate,
        value_local: valueLocal,
        value_gbp: valueGBP,
        average_cost: holding.average_cost,
      });
    }

    accountInvestmentsTotal = roundToPence(accountInvestmentsTotal);
    const cashBalance = account.cash_balance;
    const warnCash = account.warn_cash;
    const cashWarning = warnCash > 0 && cashBalance < warnCash;
    const accountTotal = roundToPence(accountInvestmentsTotal + cashBalance);

    totalInvestments += accountInvestmentsTotal;
    totalCash += cashBalance;

    accountSummaries.push({
      id: account.id,
      account_type: account.account_type,
      account_ref: account.account_ref,
      cash_balance: cashBalance,
      warn_cash: warnCash,
      cash_warning: cashWarning,
      investments_total: accountInvestmentsTotal,
      account_total: accountTotal,
      holdings: holdingSummaries,
    });
  }

  return {
    user: {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
    },
    valuation_date: today,
    accounts: accountSummaries,
    totals: {
      investments: roundToPence(totalInvestments),
      cash: roundToPence(totalCash),
      grand_total: roundToPence(totalInvestments + totalCash),
    },
  };
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
 * @description Round a value to 2 decimal places (pence precision).
 * @param {number} value - The value to round
 * @returns {number} Value rounded to 2 decimal places
 */
function roundToPence(value) {
  return Math.round(value * 100) / 100;
}

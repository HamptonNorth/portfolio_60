import { getDatabase } from "./connection.js";

/**
 * @description Get all currencies, ordered by code.
 * @returns {Object[]} Array of currency objects
 */
export function getAllCurrencies() {
  const db = getDatabase();
  return db.query("SELECT * FROM currencies ORDER BY code").all();
}

/**
 * @description Get a single currency by ID.
 * @param {number} id - The currency ID
 * @returns {Object|null} The currency object, or null if not found
 */
export function getCurrencyById(id) {
  const db = getDatabase();
  return db.query("SELECT * FROM currencies WHERE id = ?").get(id);
}

/**
 * @description Create a new currency.
 * @param {Object} data - The currency data
 * @param {string} data.code - 3-character currency code (will be stored as-is; uppercase in route layer)
 * @param {string} data.description - Currency description (max 30 chars)
 * @returns {Object} The created currency with its new ID
 */
export function createCurrency(data) {
  const db = getDatabase();
  const result = db.run("INSERT INTO currencies (code, description) VALUES (?, ?)", [data.code, data.description]);

  return getCurrencyById(result.lastInsertRowid);
}

/**
 * @description Update an existing currency.
 * GBP code cannot be changed — the route layer should prevent this,
 * but the DB layer does not enforce it separately.
 * @param {number} id - The currency ID to update
 * @param {Object} data - The updated currency data
 * @param {string} data.code - 3-character currency code
 * @param {string} data.description - Currency description (max 30 chars)
 * @returns {Object|null} The updated currency, or null if not found
 */
export function updateCurrency(id, data) {
  const db = getDatabase();
  const result = db.run("UPDATE currencies SET code = ?, description = ? WHERE id = ?", [data.code, data.description, id]);

  if (result.changes === 0) {
    return null;
  }

  return getCurrencyById(id);
}

/**
 * @description Delete a currency by ID.
 * Returns an object with success/failure and a reason if blocked.
 * Deletion is blocked if the currency is GBP (base currency) or if
 * any investments reference it.
 * @param {number} id - The currency ID to delete
 * @returns {{deleted: boolean, reason?: string}} Result with optional reason
 */
export function deleteCurrency(id) {
  const db = getDatabase();

  // Check if this is GBP
  const currency = getCurrencyById(id);
  if (!currency) {
    return { deleted: false, reason: "Currency not found" };
  }
  if (currency.code === "GBP") {
    return { deleted: false, reason: "GBP is the base currency and cannot be deleted" };
  }

  // Check if any investments reference this currency
  const usage = db.query("SELECT COUNT(*) as count FROM investments WHERE currencies_id = ?").get(id);
  if (usage.count > 0) {
    return {
      deleted: false,
      reason: "This currency is used by " + usage.count + " investment" + (usage.count === 1 ? "" : "s") + " and cannot be deleted",
    };
  }

  // Check if any currency rates reference this currency
  const rateUsage = db.query("SELECT COUNT(*) as count FROM currency_rates WHERE currencies_id = ?").get(id);
  if (rateUsage.count > 0) {
    return {
      deleted: false,
      reason: "This currency has " + rateUsage.count + " exchange rate record" + (rateUsage.count === 1 ? "" : "s") + " and cannot be deleted",
    };
  }

  db.run("DELETE FROM currencies WHERE id = ?", [id]);
  return { deleted: true };
}

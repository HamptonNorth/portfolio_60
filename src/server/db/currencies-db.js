import { getDatabase } from "./connection.js";

/**
 * @description Get all currencies, ordered by code.
 * @returns {Object[]} Array of currency objects
 */
export function getAllCurrencies() {
  const db = getDatabase();
  return db.query("SELECT * FROM currencies ORDER BY code").all();
}

import { getDatabase } from "./connection.js";

/**
 * @description Get all report params as a key-value object.
 * Used by the reports route to substitute tokens in user-reports.json.
 * @returns {Object<string, string>} Token map, e.g. { "USER1": "BW", "USER2": "AW" }
 */
export function getReportParams() {
  const db = getDatabase();
  const rows = db.query("SELECT param_key, param_value FROM report_params ORDER BY id").all();
  const result = {};
  for (let i = 0; i < rows.length; i++) {
    result[rows[i].param_key] = rows[i].param_value;
  }
  return result;
}

/**
 * @description Get all report params as an array of row objects.
 * Used by the API for listing/managing params.
 * @returns {Array<{id: number, param_key: string, param_value: string}>}
 */
export function getAllReportParams() {
  const db = getDatabase();
  return db.query("SELECT id, param_key, param_value FROM report_params ORDER BY id").all();
}

/**
 * @description Create a new report param. Fails if the key already exists.
 * @param {string} paramKey - The token name (e.g. "USER1")
 * @param {string} paramValue - The substitution value (e.g. "BW")
 * @returns {{id: number, param_key: string, param_value: string}} The created row
 */
export function createReportParam(paramKey, paramValue) {
  const db = getDatabase();
  const result = db.query(
    "INSERT INTO report_params (param_key, param_value) VALUES (?, ?)"
  ).run(paramKey, paramValue);
  return { id: Number(result.lastInsertRowid), param_key: paramKey, param_value: paramValue };
}

/**
 * @description Update an existing report param by ID.
 * @param {number} id - The row ID
 * @param {string} paramKey - The token name
 * @param {string} paramValue - The substitution value
 * @returns {{id: number, param_key: string, param_value: string}|null} Updated row, or null if not found
 */
export function updateReportParam(id, paramKey, paramValue) {
  const db = getDatabase();
  const result = db.query(
    "UPDATE report_params SET param_key = ?, param_value = ? WHERE id = ?"
  ).run(paramKey, paramValue, id);
  if (result.changes === 0) return null;
  return { id, param_key: paramKey, param_value: paramValue };
}

/**
 * @description Delete a report param by ID.
 * @param {number} id - The row ID
 * @returns {boolean} True if a row was deleted
 */
export function deleteReportParam(id) {
  const db = getDatabase();
  const result = db.query("DELETE FROM report_params WHERE id = ?").run(id);
  return result.changes > 0;
}

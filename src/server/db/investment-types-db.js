import { getDatabase } from "./connection.js";

/**
 * @description Get all investment types, ordered by description.
 * Investment types are seeded data (no create/update/delete).
 * @returns {Object[]} Array of investment type objects
 */
export function getAllInvestmentTypes() {
  const db = getDatabase();
  return db.query("SELECT * FROM investment_types ORDER BY description").all();
}

/**
 * @description Get a single investment type by ID.
 * @param {number} id - The investment type ID
 * @returns {Object|null} The investment type object, or null if not found
 */
export function getInvestmentTypeById(id) {
  const db = getDatabase();
  return db.query("SELECT * FROM investment_types WHERE id = ?").get(id);
}

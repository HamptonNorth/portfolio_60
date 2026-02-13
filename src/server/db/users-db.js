import { getDatabase } from "./connection.js";

/**
 * @description Get all users, ordered by last name then first name.
 * @returns {Object[]} Array of user objects
 */
export function getAllUsers() {
  const db = getDatabase();
  return db.query("SELECT * FROM users ORDER BY last_name, first_name").all();
}

/**
 * @description Get a single user by ID.
 * @param {number} id - The user ID
 * @returns {Object|null} The user object, or null if not found
 */
export function getUserById(id) {
  const db = getDatabase();
  return db.query("SELECT * FROM users WHERE id = ?").get(id);
}

/**
 * @description Create a new user.
 * @param {Object} data - The user data
 * @param {string} data.initials - User initials (max 5 chars)
 * @param {string} data.first_name - First name (max 30 chars)
 * @param {string} data.last_name - Last name (max 30 chars)
 * @param {string|null} data.ni_number - National Insurance number (max 9 chars)
 * @param {string|null} data.utr - Unique Taxpayer Reference (max 15 chars)
 * @param {string} data.provider - Provider abbreviation (max 5 chars)
 * @param {string|null} data.trading_ref - Trading account reference (max 15 chars)
 * @param {string|null} data.isa_ref - ISA account reference (max 15 chars)
 * @param {string|null} data.sipp_ref - SIPP account reference (max 15 chars)
 * @returns {Object} The created user with its new ID
 */
export function createUser(data) {
  const db = getDatabase();
  const result = db.run(
    `INSERT INTO users (initials, first_name, last_name, ni_number, utr, provider, trading_ref, isa_ref, sipp_ref)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.initials, data.first_name, data.last_name, data.ni_number || null, data.utr || null, data.provider, data.trading_ref || null, data.isa_ref || null, data.sipp_ref || null],
  );

  return getUserById(result.lastInsertRowid);
}

/**
 * @description Update an existing user.
 * @param {number} id - The user ID to update
 * @param {Object} data - The updated user data (same fields as createUser)
 * @returns {Object|null} The updated user, or null if the ID was not found
 */
export function updateUser(id, data) {
  const db = getDatabase();
  const result = db.run(
    `UPDATE users SET
       initials = ?, first_name = ?, last_name = ?,
       ni_number = ?, utr = ?, provider = ?,
       trading_ref = ?, isa_ref = ?, sipp_ref = ?
     WHERE id = ?`,
    [data.initials, data.first_name, data.last_name, data.ni_number || null, data.utr || null, data.provider, data.trading_ref || null, data.isa_ref || null, data.sipp_ref || null, id],
  );

  if (result.changes === 0) {
    return null;
  }

  return getUserById(id);
}

/**
 * @description Delete a user by ID. Also deletes all associated child records
 * (holding movements, holdings, cash transactions, drawdown schedules, accounts).
 * @param {number} id - The user ID to delete
 * @returns {boolean} True if the user was deleted, false if not found
 */
export function deleteUser(id) {
  const db = getDatabase();
  // Delete in dependency order (no ON DELETE CASCADE in schema)
  db.run("DELETE FROM holding_movements WHERE holding_id IN (SELECT h.id FROM holdings h JOIN accounts a ON h.account_id = a.id WHERE a.user_id = ?)", [id]);
  db.run("DELETE FROM holdings WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ?)", [id]);
  db.run("DELETE FROM cash_transactions WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ?)", [id]);
  db.run("DELETE FROM drawdown_schedules WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ?)", [id]);
  db.run("DELETE FROM accounts WHERE user_id = ?", [id]);
  const result = db.run("DELETE FROM users WHERE id = ?", [id]);
  return result.changes > 0;
}

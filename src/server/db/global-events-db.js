import { getDatabase } from "./connection.js";

/**
 * @description Get all global events, ordered by date descending (newest first).
 * @returns {Object[]} Array of global event objects
 */
export function getAllGlobalEvents() {
  const db = getDatabase();
  return db.query("SELECT * FROM global_events ORDER BY event_date DESC").all();
}

/**
 * @description Get a single global event by ID.
 * @param {number} id - The global event ID
 * @returns {Object|null} The global event object, or null if not found
 */
export function getGlobalEventById(id) {
  const db = getDatabase();
  return db.query("SELECT * FROM global_events WHERE id = ?").get(id);
}

/**
 * @description Create a new global event.
 * @param {Object} data - The event data
 * @param {string} data.event_date - ISO-8601 date (YYYY-MM-DD)
 * @param {string} data.description - Event description (max 255 chars)
 * @returns {Object} The created event with its new ID
 */
export function createGlobalEvent(data) {
  const db = getDatabase();
  const result = db.run(
    "INSERT INTO global_events (event_date, description) VALUES (?, ?)",
    [data.event_date, data.description]
  );

  return getGlobalEventById(result.lastInsertRowid);
}

/**
 * @description Update an existing global event.
 * @param {number} id - The event ID to update
 * @param {Object} data - The updated event data
 * @param {string} data.event_date - ISO-8601 date (YYYY-MM-DD)
 * @param {string} data.description - Event description (max 255 chars)
 * @returns {Object|null} The updated event, or null if not found
 */
export function updateGlobalEvent(id, data) {
  const db = getDatabase();
  const result = db.run(
    "UPDATE global_events SET event_date = ?, description = ? WHERE id = ?",
    [data.event_date, data.description, id]
  );

  if (result.changes === 0) {
    return null;
  }

  return getGlobalEventById(id);
}

/**
 * @description Delete a global event by ID.
 * @param {number} id - The event ID to delete
 * @returns {boolean} True if the event was deleted, false if not found
 */
export function deleteGlobalEvent(id) {
  const db = getDatabase();
  const result = db.run("DELETE FROM global_events WHERE id = ?", [id]);
  return result.changes > 0;
}

import { getDatabase } from "./connection.js";
import { CURRENCY_SCALE_FACTOR } from "../../shared/constants.js";

/**
 * @description Scale a monetary value for storage (multiply by CURRENCY_SCALE_FACTOR).
 * @param {number} value - The decimal value (e.g. 1200.00)
 * @returns {number} Scaled integer value
 */
export function scaleAmount(value) {
  return Math.round(value * CURRENCY_SCALE_FACTOR);
}

/**
 * @description Unscale a stored monetary value (divide by CURRENCY_SCALE_FACTOR).
 * @param {number} scaledValue - The scaled integer value from the database
 * @returns {number} The decimal value
 */
export function unscaleAmount(scaledValue) {
  return scaledValue / CURRENCY_SCALE_FACTOR;
}

/**
 * @description Create a new drawdown schedule.
 * @param {Object} data - The schedule data
 * @param {number} data.account_id - FK to accounts table (must be a SIPP account)
 * @param {string} data.frequency - One of 'monthly', 'quarterly', 'annually'
 * @param {number} data.trigger_day - Day of month to trigger (1–28)
 * @param {string} data.from_date - Start date as YYYY-MM-DD (day component ignored, stored as YYYY-MM-01)
 * @param {string} data.to_date - End date as YYYY-MM-DD (day component ignored, stored as YYYY-MM-01)
 * @param {number} data.amount - Drawdown amount as a decimal (e.g. 1200.00)
 * @param {string} [data.notes] - Optional notes (max 255 chars)
 * @returns {Object} The created schedule with its new ID and unscaled amount
 */
export function createDrawdownSchedule(data) {
  const db = getDatabase();
  const scaledAmount = scaleAmount(data.amount);

  // Normalise dates to first of month for consistency
  const fromDate = normaliseToFirstOfMonth(data.from_date);
  const toDate = normaliseToFirstOfMonth(data.to_date);

  const result = db.run(
    `INSERT INTO drawdown_schedules (account_id, frequency, trigger_day, from_date, to_date, amount, notes, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    [data.account_id, data.frequency, data.trigger_day, fromDate, toDate, scaledAmount, data.notes || null],
  );

  return getDrawdownScheduleById(result.lastInsertRowid);
}

/**
 * @description Update an existing drawdown schedule.
 * @param {number} id - The schedule ID to update
 * @param {Object} data - The updated schedule data
 * @param {string} data.frequency - One of 'monthly', 'quarterly', 'annually'
 * @param {number} data.trigger_day - Day of month to trigger (1–28)
 * @param {string} data.from_date - Start date as YYYY-MM-DD
 * @param {string} data.to_date - End date as YYYY-MM-DD
 * @param {number} data.amount - Drawdown amount as a decimal
 * @param {string} [data.notes] - Optional notes (max 255 chars)
 * @param {number} [data.active] - 1 for active, 0 for paused
 * @returns {Object|null} The updated schedule, or null if not found
 */
export function updateDrawdownSchedule(id, data) {
  const db = getDatabase();
  const scaledAmount = scaleAmount(data.amount);
  const fromDate = normaliseToFirstOfMonth(data.from_date);
  const toDate = normaliseToFirstOfMonth(data.to_date);
  const active = data.active !== undefined ? data.active : 1;

  const result = db.run(
    `UPDATE drawdown_schedules
     SET frequency = ?, trigger_day = ?, from_date = ?, to_date = ?, amount = ?, notes = ?, active = ?
     WHERE id = ?`,
    [data.frequency, data.trigger_day, fromDate, toDate, scaledAmount, data.notes || null, active, id],
  );

  if (result.changes === 0) {
    return null;
  }

  return getDrawdownScheduleById(id);
}

/**
 * @description Delete a drawdown schedule by ID.
 * @param {number} id - The schedule ID to delete
 * @returns {boolean} True if the schedule was deleted, false if not found
 */
export function deleteDrawdownSchedule(id) {
  const db = getDatabase();
  const result = db.run("DELETE FROM drawdown_schedules WHERE id = ?", [id]);
  return result.changes > 0;
}

/**
 * @description Get a single drawdown schedule by ID with unscaled amount.
 * @param {number} id - The schedule ID
 * @returns {Object|null} The schedule object, or null if not found
 */
export function getDrawdownScheduleById(id) {
  const db = getDatabase();
  const row = db
    .query(
      `SELECT id, account_id, frequency, trigger_day, from_date, to_date, amount, notes, active
       FROM drawdown_schedules
       WHERE id = ?`,
    )
    .get(id);

  if (!row) return null;
  return unscaleScheduleRow(row);
}

/**
 * @description Get all drawdown schedules for an account, ordered by from_date.
 * @param {number} accountId - The account ID
 * @returns {Object[]} Array of schedule objects with unscaled amounts
 */
export function getDrawdownSchedulesByAccountId(accountId) {
  const db = getDatabase();
  const rows = db
    .query(
      `SELECT id, account_id, frequency, trigger_day, from_date, to_date, amount, notes, active
       FROM drawdown_schedules
       WHERE account_id = ?
       ORDER BY from_date`,
    )
    .all(accountId);

  return rows.map(unscaleScheduleRow);
}

/**
 * @description Get all active drawdown schedules across all accounts.
 * Used by the drawdown processor on app startup.
 * @returns {Object[]} Array of active schedule objects with unscaled amounts
 */
export function getActiveDrawdownSchedules() {
  const db = getDatabase();
  const rows = db
    .query(
      `SELECT id, account_id, frequency, trigger_day, from_date, to_date, amount, notes, active
       FROM drawdown_schedules
       WHERE active = 1
       ORDER BY from_date`,
    )
    .all();

  return rows.map(unscaleScheduleRow);
}

/**
 * @description Calculate all trigger dates for a drawdown schedule up to a
 * given date. Skips dates in the future (after upToDate).
 *
 * - Monthly: trigger on trigger_day of every month from from_date to to_date.
 * - Quarterly: trigger every 3 months from from_date month.
 * - Annually: trigger once per year from from_date month.
 *
 * @param {Object} schedule - The drawdown schedule (with from_date, to_date, frequency, trigger_day)
 * @param {string} upToDate - The latest date to include (YYYY-MM-DD), typically today
 * @returns {string[]} Array of trigger dates in YYYY-MM-DD format
 */
export function getDueDrawdownDates(schedule, upToDate) {
  const dates = [];

  // Parse from_date and to_date to extract year and month
  const fromParts = schedule.from_date.split("-");
  const fromYear = parseInt(fromParts[0], 10);
  const fromMonth = parseInt(fromParts[1], 10);

  const toParts = schedule.to_date.split("-");
  const toYear = parseInt(toParts[0], 10);
  const toMonth = parseInt(toParts[1], 10);

  // Determine the month step based on frequency
  let monthStep;
  if (schedule.frequency === "monthly") {
    monthStep = 1;
  } else if (schedule.frequency === "quarterly") {
    monthStep = 3;
  } else {
    // annually
    monthStep = 12;
  }

  // Iterate through months from from_date to to_date
  let currentYear = fromYear;
  let currentMonth = fromMonth;

  while (currentYear < toYear || (currentYear === toYear && currentMonth <= toMonth)) {
    // Build the trigger date string
    const dayStr = String(schedule.trigger_day).padStart(2, "0");
    const monthStr = String(currentMonth).padStart(2, "0");
    const dateStr = `${currentYear}-${monthStr}-${dayStr}`;

    // Only include dates up to and including upToDate
    if (dateStr <= upToDate) {
      dates.push(dateStr);
    }

    // Advance to next trigger month
    currentMonth += monthStep;
    while (currentMonth > 12) {
      currentMonth -= 12;
      currentYear += 1;
    }
  }

  return dates;
}

/**
 * @description Normalise a date string to the first day of its month.
 * E.g. "2026-04-15" becomes "2026-04-01".
 * @param {string} dateStr - ISO-8601 date string (YYYY-MM-DD)
 * @returns {string} Normalised date as YYYY-MM-01
 */
function normaliseToFirstOfMonth(dateStr) {
  const parts = dateStr.split("-");
  return `${parts[0]}-${parts[1]}-01`;
}

/**
 * @description Convert a raw database row to an object with unscaled amount.
 * @param {Object} row - The raw database row
 * @returns {Object} Row with amount as a decimal
 */
function unscaleScheduleRow(row) {
  return {
    id: row.id,
    account_id: row.account_id,
    frequency: row.frequency,
    trigger_day: row.trigger_day,
    from_date: row.from_date,
    to_date: row.to_date,
    amount: unscaleAmount(row.amount),
    amount_scaled: row.amount,
    notes: row.notes,
    active: row.active,
  };
}

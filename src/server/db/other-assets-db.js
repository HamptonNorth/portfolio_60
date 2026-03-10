import { getDatabase } from "./connection.js";

/**
 * @description Multipliers to annualise recurring income by frequency.
 * @type {Object<string, number>}
 */
const ANNUAL_MULTIPLIERS = {
  weekly: 52,
  fortnightly: 26,
  "4_weeks": 13,
  monthly: 12,
  quarterly: 4,
  "6_monthly": 2,
  annually: 1,
};

/**
 * @description Get today's date in ISO-8601 format (YYYY-MM-DD).
 * @returns {string} Today's date string
 */
function getTodayDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

/**
 * @description Base SQL for selecting other_assets joined with user info.
 * Returns user initials and first_name so the UI can display "Joint" for
 * the Joint user row and initials for everyone else.
 * @type {string}
 */
const BASE_SELECT = `
  SELECT oa.*,
         u.initials AS user_initials,
         u.first_name AS user_first_name
  FROM other_assets oa
  JOIN users u ON u.id = oa.user_id
`;

/**
 * @description Get all other assets, ordered by category then description.
 * Includes user initials and first_name for display.
 * @returns {Object[]} Array of other asset objects with user info
 */
export function getAllOtherAssets() {
  const db = getDatabase();
  return db.query(
    BASE_SELECT + " ORDER BY oa.category, oa.description"
  ).all();
}

/**
 * @description Get a single other asset by ID, with user info.
 * @param {number} id - The other asset ID
 * @returns {Object|null} The other asset object, or null if not found
 */
export function getOtherAssetById(id) {
  const db = getDatabase();
  return db.query(
    BASE_SELECT + " WHERE oa.id = ?"
  ).get(id);
}

/**
 * @description Get all other assets for a given category, with user info.
 * @param {string} category - One of: pension, property, savings, alternative
 * @returns {Object[]} Array of other asset objects
 */
export function getOtherAssetsByCategory(category) {
  const db = getDatabase();
  return db.query(
    BASE_SELECT + " WHERE oa.category = ? ORDER BY oa.description"
  ).all(category);
}

/**
 * @description Create a new other asset record.
 * @param {Object} data - The asset data
 * @param {number} data.user_id - FK to users.id (including Joint user)
 * @param {string} data.description - Asset description (max 40 chars)
 * @param {string} data.category - One of: pension, property, savings, alternative
 * @param {string} data.value_type - One of: recurring, value
 * @param {string|null} data.frequency - Payment frequency (required for recurring, null for value)
 * @param {number} data.value - Amount in GBP × 10000
 * @param {string|null} data.notes - Optional notes (max 60 chars)
 * @param {string|null} data.executor_reference - Optional executor ref (max 80 chars)
 * @returns {Object} The created asset with its new ID and user info
 */
export function createOtherAsset(data) {
  const db = getDatabase();
  const result = db.run(
    `INSERT INTO other_assets (user_id, description, category, value_type, frequency, value, notes, executor_reference, last_updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.user_id,
      data.description,
      data.category,
      data.value_type,
      data.frequency || null,
      data.value,
      data.notes || null,
      data.executor_reference || null,
      getTodayDate(),
    ]
  );

  return getOtherAssetById(result.lastInsertRowid);
}

/**
 * @description Update an existing other asset. If value, notes, or
 * executor_reference changed, the old values are written to
 * other_assets_history before the update.
 * @param {number} id - The asset ID to update
 * @param {Object} data - The updated asset data
 * @returns {Object|null} The updated asset with user info, or null if not found
 */
export function updateOtherAsset(id, data) {
  const db = getDatabase();

  // Fetch current row to compare tracked fields
  const current = db.query("SELECT * FROM other_assets WHERE id = ?").get(id);
  if (!current) {
    return null;
  }

  const today = getTodayDate();

  // Check if any of the three tracked fields changed
  const valueChanged = data.value !== current.value;
  const notesChanged = (data.notes || null) !== (current.notes || null);
  const execRefChanged = (data.executor_reference || null) !== (current.executor_reference || null);

  if (valueChanged || notesChanged || execRefChanged) {
    // Write old values to history before overwriting
    db.run(
      `INSERT INTO other_assets_history (other_asset_id, change_date, revised_value, revised_notes, revised_executor_reference)
       VALUES (?, ?, ?, ?, ?)`,
      [id, today, current.value, current.notes || null, current.executor_reference || null]
    );
  }

  const result = db.run(
    `UPDATE other_assets
     SET user_id = ?, description = ?, category = ?, value_type = ?,
         frequency = ?, value = ?, notes = ?, executor_reference = ?,
         last_updated = ?
     WHERE id = ?`,
    [
      data.user_id,
      data.description,
      data.category,
      data.value_type,
      data.frequency || null,
      data.value,
      data.notes || null,
      data.executor_reference || null,
      today,
      id,
    ]
  );

  if (result.changes === 0) {
    return null;
  }

  return getOtherAssetById(id);
}

/**
 * @description Delete an other asset by ID. History rows are removed
 * automatically via ON DELETE CASCADE.
 * @param {number} id - The asset ID to delete
 * @returns {boolean} True if the asset was deleted, false if not found
 */
export function deleteOtherAsset(id) {
  const db = getDatabase();
  const result = db.run("DELETE FROM other_assets WHERE id = ?", [id]);
  return result.changes > 0;
}

/**
 * @description Get the change history for an other asset, newest first.
 * @param {number} assetId - The other asset ID
 * @returns {Object[]} Array of history objects
 */
export function getOtherAssetHistory(assetId) {
  const db = getDatabase();
  return db.query(
    "SELECT * FROM other_assets_history WHERE other_asset_id = ? ORDER BY change_date DESC, id DESC"
  ).all(assetId);
}

/**
 * @description Get all other assets grouped by category with summary totals.
 * Used by the Household Assets report block.
 * @returns {Object} Categories with items and summary totals
 */
export function getHouseholdAssetsSummary() {
  const db = getDatabase();
  const rows = db.query(
    BASE_SELECT + " ORDER BY oa.category, oa.description"
  ).all();

  const categoryOrder = ["pension", "property", "savings", "alternative"];
  const categoryLabels = {
    pension: "Pensions",
    property: "Property",
    savings: "Savings",
    alternative: "Alternative Assets",
  };

  /** @type {Object<string, {label: string, items: Object[]}>} */
  const categories = {};
  for (const cat of categoryOrder) {
    categories[cat] = { label: categoryLabels[cat], items: [] };
  }

  let recurringAnnual = 0;
  let valueTotal = 0;

  for (const row of rows) {
    if (categories[row.category]) {
      categories[row.category].items.push(row);
    }

    if (row.value_type === "recurring" && row.frequency) {
      const multiplier = ANNUAL_MULTIPLIERS[row.frequency] || 1;
      recurringAnnual += row.value * multiplier;
    } else if (row.value_type === "value") {
      valueTotal += row.value;
    }
  }

  return {
    categories,
    totals: {
      recurring_annual: recurringAnnual,
      value_total: valueTotal,
    },
  };
}

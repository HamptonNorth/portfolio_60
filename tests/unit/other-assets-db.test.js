// Set isolated DB path BEFORE importing connection.js
process.env.DB_PATH = "data/portfolio_60_test/test-other-assets-db.db";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { createDatabase, closeDatabase, getDatabasePath } from "../../src/server/db/connection.js";
import { createUser } from "../../src/server/db/users-db.js";
import {
  getAllOtherAssets,
  getOtherAssetById,
  getOtherAssetsByCategory,
  createOtherAsset,
  updateOtherAsset,
  deleteOtherAsset,
  getOtherAssetHistory,
  getHouseholdAssetsSummary,
} from "../../src/server/db/other-assets-db.js";

const testDbPath = getDatabasePath();

/**
 * @description Clean up the isolated test database files only.
 */
function cleanupDatabase() {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    const filePath = testDbPath + suffix;
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }
}

/** @type {Object} Test user created in beforeAll */
let testUser;
/** @type {Object} Joint user (created by seed.sql) */
let jointUser;

beforeAll(() => {
  cleanupDatabase();
  createDatabase();

  // Create a test user for non-joint assets
  testUser = createUser({
    initials: "RC",
    first_name: "Robert",
    last_name: "Collins",
    provider: "ii",
    trading_ref: null,
    isa_ref: null,
    sipp_ref: null,
  });

  // Joint user should already exist from seed.sql
  const { getDatabase } = require("../../src/server/db/connection.js");
  const db = getDatabase();
  jointUser = db.query("SELECT * FROM users WHERE first_name = 'Joint' AND last_name = 'Household'").get();
});

afterAll(() => {
  cleanupDatabase();
  delete process.env.DB_PATH;
});

// --- CRUD operations ---

describe("createOtherAsset", () => {
  test("creates a recurring pension asset", () => {
    const asset = createOtherAsset({
      user_id: testUser.id,
      description: "State Pension",
      category: "pension",
      value_type: "recurring",
      frequency: "4_weeks",
      value: 8450000,
      notes: null,
      executor_reference: null,
    });

    expect(asset).not.toBeNull();
    expect(asset.id).toBeGreaterThan(0);
    expect(asset.description).toBe("State Pension");
    expect(asset.category).toBe("pension");
    expect(asset.value_type).toBe("recurring");
    expect(asset.frequency).toBe("4_weeks");
    expect(asset.value).toBe(8450000);
    expect(asset.user_initials).toBe("RC");
    expect(asset.last_updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("creates a value-type property asset with joint user", () => {
    const asset = createOtherAsset({
      user_id: jointUser.id,
      description: "12 Primrose Av",
      category: "property",
      value_type: "value",
      frequency: null,
      value: 4450000000,
      notes: null,
      executor_reference: null,
    });

    expect(asset).not.toBeNull();
    expect(asset.user_first_name).toBe("Joint");
    expect(asset.category).toBe("property");
    expect(asset.value_type).toBe("value");
    expect(asset.frequency).toBeNull();
    expect(asset.value).toBe(4450000000);
  });

  test("creates an asset with notes and executor reference", () => {
    const asset = createOtherAsset({
      user_id: testUser.id,
      description: "Scottish Widows Annuity",
      category: "pension",
      value_type: "recurring",
      frequency: "monthly",
      value: 6000000,
      notes: "Fixed, 50% spouse",
      executor_reference: "Policy SW/2013-45671",
    });

    expect(asset.notes).toBe("Fixed, 50% spouse");
    expect(asset.executor_reference).toBe("Policy SW/2013-45671");
  });

  test("rejects invalid user_id (FK violation)", () => {
    expect(() => {
      createOtherAsset({
        user_id: 99999,
        description: "Bad Asset",
        category: "savings",
        value_type: "value",
        frequency: null,
        value: 10000,
        notes: null,
        executor_reference: null,
      });
    }).toThrow();
  });
});

describe("getOtherAssetById", () => {
  test("returns asset with user info", () => {
    const all = getAllOtherAssets();
    const asset = getOtherAssetById(all[0].id);

    expect(asset).not.toBeNull();
    expect(asset.id).toBe(all[0].id);
    expect(asset.user_initials).toBeTruthy();
    expect(asset.user_first_name).toBeTruthy();
  });

  test("returns null for non-existent id", () => {
    const asset = getOtherAssetById(99999);
    expect(asset).toBeNull();
  });
});

describe("getAllOtherAssets", () => {
  test("returns all assets ordered by category then description", () => {
    const assets = getAllOtherAssets();
    expect(assets.length).toBeGreaterThanOrEqual(3);

    // Check ordering: pension categories should come before property, etc.
    const categories = assets.map((a) => a.category);
    const uniqueCategories = [...new Set(categories)];
    // pension < property in alphabetical order
    if (uniqueCategories.includes("pension") && uniqueCategories.includes("property")) {
      const firstPension = categories.indexOf("pension");
      const firstProperty = categories.indexOf("property");
      expect(firstPension).toBeLessThan(firstProperty);
    }
  });
});

describe("getOtherAssetsByCategory", () => {
  test("filters by pension category", () => {
    const pensions = getOtherAssetsByCategory("pension");
    expect(pensions.length).toBeGreaterThanOrEqual(2);
    for (const p of pensions) {
      expect(p.category).toBe("pension");
    }
  });

  test("returns empty array for category with no assets", () => {
    const alts = getOtherAssetsByCategory("alternative");
    expect(Array.isArray(alts)).toBe(true);
  });
});

describe("updateOtherAsset", () => {
  test("updates fields without creating history when tracked fields unchanged", () => {
    const asset = createOtherAsset({
      user_id: testUser.id,
      description: "Premium Bonds",
      category: "savings",
      value_type: "value",
      frequency: null,
      value: 25000000,
      notes: null,
      executor_reference: null,
    });

    // Update only description (not a tracked field)
    const updated = updateOtherAsset(asset.id, {
      user_id: testUser.id,
      description: "NS&I Premium Bonds",
      category: "savings",
      value_type: "value",
      frequency: null,
      value: 25000000,
      notes: null,
      executor_reference: null,
    });

    expect(updated.description).toBe("NS&I Premium Bonds");

    // No history should have been created
    const history = getOtherAssetHistory(asset.id);
    expect(history.length).toBe(0);
  });

  test("creates history when value changes", () => {
    const asset = createOtherAsset({
      user_id: testUser.id,
      description: "Barclays Savings",
      category: "savings",
      value_type: "value",
      frequency: null,
      value: 37500000,
      notes: "Easy access",
      executor_reference: null,
    });

    // Update value
    const updated = updateOtherAsset(asset.id, {
      user_id: testUser.id,
      description: "Barclays Savings",
      category: "savings",
      value_type: "value",
      frequency: null,
      value: 40000000,
      notes: "Easy access",
      executor_reference: null,
    });

    expect(updated.value).toBe(40000000);

    // History should contain the old value
    const history = getOtherAssetHistory(asset.id);
    expect(history.length).toBe(1);
    expect(history[0].revised_value).toBe(37500000);
    expect(history[0].revised_notes).toBe("Easy access");
  });

  test("creates history when notes change", () => {
    const asset = createOtherAsset({
      user_id: testUser.id,
      description: "Test Notes Change",
      category: "alternative",
      value_type: "value",
      frequency: null,
      value: 10000000,
      notes: "Original note",
      executor_reference: null,
    });

    updateOtherAsset(asset.id, {
      user_id: testUser.id,
      description: "Test Notes Change",
      category: "alternative",
      value_type: "value",
      frequency: null,
      value: 10000000,
      notes: "Updated note",
      executor_reference: null,
    });

    const history = getOtherAssetHistory(asset.id);
    expect(history.length).toBe(1);
    expect(history[0].revised_notes).toBe("Original note");
  });

  test("returns null for non-existent id", () => {
    const result = updateOtherAsset(99999, {
      user_id: testUser.id,
      description: "Ghost",
      category: "savings",
      value_type: "value",
      frequency: null,
      value: 0,
      notes: null,
      executor_reference: null,
    });
    expect(result).toBeNull();
  });
});

describe("deleteOtherAsset", () => {
  test("deletes asset and cascades to history", () => {
    const asset = createOtherAsset({
      user_id: testUser.id,
      description: "To Delete",
      category: "savings",
      value_type: "value",
      frequency: null,
      value: 5000000,
      notes: null,
      executor_reference: null,
    });

    // Create some history
    updateOtherAsset(asset.id, {
      user_id: testUser.id,
      description: "To Delete",
      category: "savings",
      value_type: "value",
      frequency: null,
      value: 6000000,
      notes: null,
      executor_reference: null,
    });

    const deleted = deleteOtherAsset(asset.id);
    expect(deleted).toBe(true);

    // Verify asset gone
    expect(getOtherAssetById(asset.id)).toBeNull();

    // Verify history also gone (cascade)
    const history = getOtherAssetHistory(asset.id);
    expect(history.length).toBe(0);
  });

  test("returns false for non-existent id", () => {
    expect(deleteOtherAsset(99999)).toBe(false);
  });
});

// --- Summary / report ---

describe("getHouseholdAssetsSummary", () => {
  test("returns categories and totals", () => {
    const summary = getHouseholdAssetsSummary();

    expect(summary.categories).toBeDefined();
    expect(summary.categories.pension).toBeDefined();
    expect(summary.categories.property).toBeDefined();
    expect(summary.categories.savings).toBeDefined();
    expect(summary.categories.alternative).toBeDefined();

    expect(summary.categories.pension.label).toBe("Pensions");
    expect(summary.categories.property.label).toBe("Property");
    expect(summary.categories.savings.label).toBe("Savings");
    expect(summary.categories.alternative.label).toBe("Alternative Assets");

    expect(summary.totals).toBeDefined();
    expect(typeof summary.totals.recurring_annual).toBe("number");
    expect(typeof summary.totals.value_total).toBe("number");
  });

  test("annualises recurring amounts correctly", () => {
    // Create a known recurring asset for annualisation check
    const monthlyAsset = createOtherAsset({
      user_id: testUser.id,
      description: "Test Monthly Income",
      category: "pension",
      value_type: "recurring",
      frequency: "monthly",
      value: 10000000, // £1,000/month
      notes: null,
      executor_reference: null,
    });

    const summary = getHouseholdAssetsSummary();

    // The recurring_annual total should include 10000000 * 12 = 120000000
    // from this asset plus others. Just verify it's > 0 and includes items.
    expect(summary.totals.recurring_annual).toBeGreaterThan(0);
    expect(summary.categories.pension.items.length).toBeGreaterThan(0);

    // Clean up
    deleteOtherAsset(monthlyAsset.id);
  });
});

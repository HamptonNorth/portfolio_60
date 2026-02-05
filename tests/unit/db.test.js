// Set isolated DB path BEFORE importing connection.js (which reads it at module load)
process.env.DB_PATH = "data/portfolio_60_test/test-db.db";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { databaseExists, createDatabase, getDatabase, closeDatabase, getDatabasePath } from "../../src/server/db/connection.js";

/**
 * @description Isolated test database path — set via env var above.
 */
const testDbPath = getDatabasePath();

/**
 * @description Clean up the isolated test database files only.
 * Does NOT remove the data/ directory (other tests may be using it).
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

beforeAll(() => {
  cleanupDatabase();
});

afterAll(() => {
  cleanupDatabase();
  // Unset the env var so it doesn't leak to other tests
  delete process.env.DB_PATH;
});

describe("Database - existence check", () => {
  test("databaseExists returns false when no database file", () => {
    expect(databaseExists()).toBe(false);
  });
});

describe("Database - creation", () => {
  test("createDatabase creates the database file and returns true", () => {
    const result = createDatabase();
    expect(result).toBe(true);
    expect(databaseExists()).toBe(true);
  });

  test("createDatabase returns false if database already exists", () => {
    const result = createDatabase();
    expect(result).toBe(false);
  });
});

describe("Database - WAL mode", () => {
  test("database uses WAL journal mode", () => {
    const db = getDatabase();
    const row = db.query("PRAGMA journal_mode").get();
    expect(row.journal_mode).toBe("wal");
  });
});

describe("Database - foreign keys", () => {
  test("foreign keys are enabled", () => {
    const db = getDatabase();
    const row = db.query("PRAGMA foreign_keys").get();
    expect(row.foreign_keys).toBe(1);
  });
});

describe("Database - tables exist", () => {
  const expectedTables = ["users", "investment_types", "currencies", "investments", "currency_rates", "global_events"];

  for (const tableName of expectedTables) {
    test(`table '${tableName}' exists`, () => {
      const db = getDatabase();
      const row = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
      expect(row).not.toBeNull();
      expect(row.name).toBe(tableName);
    });
  }
});

describe("Database - indexes exist", () => {
  const expectedIndexes = ["idx_currency_rates_lookup", "idx_investments_type", "idx_investments_currency", "idx_global_events_date"];

  for (const indexName of expectedIndexes) {
    test(`index '${indexName}' exists`, () => {
      const db = getDatabase();
      const row = db.query("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(indexName);
      expect(row).not.toBeNull();
      expect(row.name).toBe(indexName);
    });
  }
});

describe("Database - seed data", () => {
  test("investment_types has 5 rows", () => {
    const db = getDatabase();
    const row = db.query("SELECT COUNT(*) as count FROM investment_types").get();
    expect(row.count).toBe(5);
  });

  test("investment_types contains expected types", () => {
    const db = getDatabase();
    const rows = db.query("SELECT short_description FROM investment_types ORDER BY id").all();
    const types = rows.map((r) => r.short_description);
    expect(types).toEqual(["SHARE", "MUTUAL", "TRUST", "SAVINGS", "OTHER"]);
  });

  test("currencies has GBP as seed data", () => {
    const db = getDatabase();
    const row = db.query("SELECT code, description FROM currencies WHERE code = 'GBP'").get();
    expect(row).not.toBeNull();
    expect(row.code).toBe("GBP");
    expect(row.description).toBe("British Pound Sterling");
  });

  test("currencies has exactly 1 row (GBP only)", () => {
    const db = getDatabase();
    const row = db.query("SELECT COUNT(*) as count FROM currencies").get();
    expect(row.count).toBe(1);
  });
});

describe("Database - constraints", () => {
  test("currencies.code must be unique", () => {
    const db = getDatabase();
    expect(() => {
      db.run("INSERT INTO currencies (code, description) VALUES ('GBP', 'Duplicate')");
    }).toThrow();
  });

  test("currencies.code must be exactly 3 characters", () => {
    const db = getDatabase();
    expect(() => {
      db.run("INSERT INTO currencies (code, description) VALUES ('US', 'Too Short')");
    }).toThrow();
  });

  test("investments requires valid currencies_id FK", () => {
    const db = getDatabase();
    expect(() => {
      db.run("INSERT INTO investments (currencies_id, investment_type_id, description) VALUES (9999, 1, 'Bad FK')");
    }).toThrow();
  });

  test("investments requires valid investment_type_id FK", () => {
    const db = getDatabase();
    expect(() => {
      db.run("INSERT INTO investments (currencies_id, investment_type_id, description) VALUES (1, 9999, 'Bad FK')");
    }).toThrow();
  });

  test("currency_rates requires valid currencies_id FK", () => {
    const db = getDatabase();
    expect(() => {
      db.run("INSERT INTO currency_rates (currencies_id, rate_date, rate) VALUES (9999, '2024-01-01', 10000)");
    }).toThrow();
  });

  test("currency_rates enforces unique (currencies_id, rate_date)", () => {
    const db = getDatabase();
    // Insert a rate for USD (need to create USD first)
    db.run("INSERT INTO currencies (code, description) VALUES ('USD', 'US Dollar')");
    const usd = db.query("SELECT id FROM currencies WHERE code = 'USD'").get();

    db.run("INSERT INTO currency_rates (currencies_id, rate_date, rate) VALUES (?, '2024-01-15', 12543)", [usd.id]);

    // Inserting the same currency+date should fail (without OR REPLACE)
    expect(() => {
      db.run("INSERT INTO currency_rates (currencies_id, rate_date, rate) VALUES (?, '2024-01-15', 12600)", [usd.id]);
    }).toThrow();

    // But INSERT OR REPLACE should work
    db.run("INSERT OR REPLACE INTO currency_rates (currencies_id, rate_date, rate) VALUES (?, '2024-01-15', 12600)", [usd.id]);

    const row = db.query("SELECT rate FROM currency_rates WHERE currencies_id = ? AND rate_date = '2024-01-15'").get(usd.id);
    expect(row.rate).toBe(12600);

    // Clean up: remove USD and its rates so other tests are unaffected
    db.run("DELETE FROM currency_rates WHERE currencies_id = ?", [usd.id]);
    db.run("DELETE FROM currencies WHERE code = 'USD'");
  });

  test("users.initials must be 5 chars or fewer", () => {
    const db = getDatabase();
    expect(() => {
      db.run("INSERT INTO users (initials, first_name, last_name, provider) VALUES ('TOOLONG', 'Test', 'User', 'ii')");
    }).toThrow();
  });

  test("global_events.description must be 255 chars or fewer", () => {
    const db = getDatabase();
    const longDescription = "A".repeat(256);
    expect(() => {
      db.run("INSERT INTO global_events (event_date, description) VALUES ('2024-01-01', ?)", [longDescription]);
    }).toThrow();
  });
});

// Set isolated DB path BEFORE importing connection.js (which reads it lazily on first call)
process.env.DB_PATH = "data/portfolio_60_test/test-global-events-db.db";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { createDatabase, closeDatabase, getDatabasePath } from "../../src/server/db/connection.js";
import {
  getAllGlobalEvents,
  getGlobalEventById,
  createGlobalEvent,
  updateGlobalEvent,
  deleteGlobalEvent,
} from "../../src/server/db/global-events-db.js";

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

beforeAll(() => {
  cleanupDatabase();
  createDatabase();
});

afterAll(() => {
  cleanupDatabase();
  delete process.env.DB_PATH;
});

// --- Empty state ---

describe("Global Events - getAllGlobalEvents", () => {
  test("returns empty array when no events exist", () => {
    const events = getAllGlobalEvents();
    expect(events).toEqual([]);
  });
});

// --- Create ---

describe("Global Events - createGlobalEvent", () => {
  test("creates an event and returns it", () => {
    const event = createGlobalEvent({
      event_date: "2024-03-15",
      description: "Bank of England holds base rate at 5.25%",
    });
    expect(event).not.toBeNull();
    expect(event.id).toBeGreaterThan(0);
    expect(event.event_date).toBe("2024-03-15");
    expect(event.description).toBe("Bank of England holds base rate at 5.25%");
  });

  test("creates a second event with earlier date", () => {
    const event = createGlobalEvent({
      event_date: "2024-01-10",
      description: "UK CPI inflation falls to 4.0%",
    });
    expect(event).not.toBeNull();
    expect(event.event_date).toBe("2024-01-10");
  });

  test("creates a third event with later date", () => {
    const event = createGlobalEvent({
      event_date: "2024-06-20",
      description: "Bank of England cuts base rate to 5.0%",
    });
    expect(event).not.toBeNull();
    expect(event.event_date).toBe("2024-06-20");
  });
});

// --- List (reverse chronological) ---

describe("Global Events - getAllGlobalEvents after inserts", () => {
  test("returns events ordered by date descending (newest first)", () => {
    const events = getAllGlobalEvents();
    expect(events.length).toBe(3);
    expect(events[0].event_date).toBe("2024-06-20");
    expect(events[1].event_date).toBe("2024-03-15");
    expect(events[2].event_date).toBe("2024-01-10");
  });

  test("each event has required fields", () => {
    const events = getAllGlobalEvents();
    for (const event of events) {
      expect(event.id).toBeGreaterThan(0);
      expect(event.event_date).toBeTruthy();
      expect(event.description).toBeTruthy();
    }
  });
});

// --- Get by ID ---

describe("Global Events - getGlobalEventById", () => {
  test("returns the correct event", () => {
    const events = getAllGlobalEvents();
    const event = getGlobalEventById(events[0].id);
    expect(event).not.toBeNull();
    expect(event.id).toBe(events[0].id);
    expect(event.event_date).toBe(events[0].event_date);
    expect(event.description).toBe(events[0].description);
  });

  test("returns null for non-existent ID", () => {
    const event = getGlobalEventById(9999);
    expect(event).toBeNull();
  });
});

// --- Update ---

describe("Global Events - updateGlobalEvent", () => {
  test("updates event fields and returns the updated event", () => {
    const events = getAllGlobalEvents();
    const id = events[2].id; // The oldest event (Jan 10)

    const updated = updateGlobalEvent(id, {
      event_date: "2024-01-15",
      description: "UK CPI inflation falls to 3.9% (revised)",
    });

    expect(updated).not.toBeNull();
    expect(updated.event_date).toBe("2024-01-15");
    expect(updated.description).toBe("UK CPI inflation falls to 3.9% (revised)");
  });

  test("returns null for non-existent ID", () => {
    const result = updateGlobalEvent(9999, {
      event_date: "2024-01-01",
      description: "Does not exist",
    });
    expect(result).toBeNull();
  });

  test("ordering reflects updated date", () => {
    const events = getAllGlobalEvents();
    // After the update, dates should be: 2024-06-20, 2024-03-15, 2024-01-15
    expect(events[0].event_date).toBe("2024-06-20");
    expect(events[1].event_date).toBe("2024-03-15");
    expect(events[2].event_date).toBe("2024-01-15");
  });
});

// --- Delete ---

describe("Global Events - deleteGlobalEvent", () => {
  test("deletes an event and returns true", () => {
    const events = getAllGlobalEvents();
    const id = events[0].id; // The newest event

    const result = deleteGlobalEvent(id);
    expect(result).toBe(true);

    const deleted = getGlobalEventById(id);
    expect(deleted).toBeNull();
  });

  test("returns false for non-existent ID", () => {
    const result = deleteGlobalEvent(9999);
    expect(result).toBe(false);
  });

  test("remaining events are correct after deletion", () => {
    const events = getAllGlobalEvents();
    expect(events.length).toBe(2);
    expect(events[0].event_date).toBe("2024-03-15");
    expect(events[1].event_date).toBe("2024-01-15");
  });
});

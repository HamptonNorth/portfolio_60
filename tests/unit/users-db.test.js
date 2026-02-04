// Set isolated DB path BEFORE importing connection.js (which reads it at module load)
process.env.DB_PATH = "data/test-users-db.db";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { createDatabase, closeDatabase, getDatabasePath } from "../../src/server/db/connection.js";
import { getAllUsers, getUserById, createUser, updateUser, deleteUser } from "../../src/server/db/users-db.js";

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

describe("Users DB - getAllUsers", () => {
  test("returns empty array when no users exist", () => {
    const users = getAllUsers();
    expect(users).toEqual([]);
  });
});

describe("Users DB - createUser", () => {
  test("creates a user and returns it with an ID", () => {
    const user = createUser({
      initials: "JDS",
      first_name: "John",
      last_name: "Smith",
      ni_number: "AB123456C",
      utr: "1234567890",
      provider: "ii",
      trading_ref: "TR001",
      isa_ref: "ISA001",
      sipp_ref: "SIPP001",
    });

    expect(user).not.toBeNull();
    expect(user.id).toBeGreaterThan(0);
    expect(user.initials).toBe("JDS");
    expect(user.first_name).toBe("John");
    expect(user.last_name).toBe("Smith");
    expect(user.ni_number).toBe("AB123456C");
    expect(user.provider).toBe("ii");
    expect(user.trading_ref).toBe("TR001");
    expect(user.isa_ref).toBe("ISA001");
    expect(user.sipp_ref).toBe("SIPP001");
  });

  test("creates a user with optional fields as null", () => {
    const user = createUser({
      initials: "MJ",
      first_name: "Mary",
      last_name: "Jones",
      provider: "hl",
    });

    expect(user).not.toBeNull();
    expect(user.ni_number).toBeNull();
    expect(user.utr).toBeNull();
    expect(user.trading_ref).toBeNull();
    expect(user.isa_ref).toBeNull();
    expect(user.sipp_ref).toBeNull();
  });
});

describe("Users DB - getAllUsers after inserts", () => {
  test("returns all users ordered by last name then first name", () => {
    const users = getAllUsers();
    expect(users.length).toBe(2);
    // Jones comes before Smith alphabetically
    expect(users[0].last_name).toBe("Jones");
    expect(users[1].last_name).toBe("Smith");
  });
});

describe("Users DB - getUserById", () => {
  test("returns the correct user", () => {
    const users = getAllUsers();
    const user = getUserById(users[0].id);
    expect(user).not.toBeNull();
    expect(user.id).toBe(users[0].id);
  });

  test("returns null for non-existent ID", () => {
    const user = getUserById(9999);
    expect(user).toBeNull();
  });
});

describe("Users DB - updateUser", () => {
  test("updates user fields and returns the updated user", () => {
    const users = getAllUsers();
    const id = users[0].id;

    const updated = updateUser(id, {
      initials: "MJU",
      first_name: "Mary",
      last_name: "Jones-Updated",
      ni_number: "CD789012E",
      utr: null,
      provider: "hl",
      trading_ref: null,
      isa_ref: "ISA999",
      sipp_ref: null,
    });

    expect(updated).not.toBeNull();
    expect(updated.initials).toBe("MJU");
    expect(updated.last_name).toBe("Jones-Updated");
    expect(updated.ni_number).toBe("CD789012E");
    expect(updated.provider).toBe("hl");
    expect(updated.isa_ref).toBe("ISA999");
    expect(updated.sipp_ref).toBeNull();
  });

  test("returns null for non-existent ID", () => {
    const result = updateUser(9999, {
      initials: "XX",
      first_name: "No",
      last_name: "One",
      provider: "ii",
    });
    expect(result).toBeNull();
  });
});

describe("Users DB - deleteUser", () => {
  test("deletes a user and returns true", () => {
    const users = getAllUsers();
    const id = users[0].id;
    const result = deleteUser(id);
    expect(result).toBe(true);

    const deleted = getUserById(id);
    expect(deleted).toBeNull();
  });

  test("returns false for non-existent ID", () => {
    const result = deleteUser(9999);
    expect(result).toBe(false);
  });
});

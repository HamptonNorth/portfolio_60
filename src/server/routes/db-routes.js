import { databaseExists, createDatabase } from "../db/connection.js";

/**
 * @description Handle database-related API routes.
 * Supports checking database status and creating the database.
 * @param {string} method - The HTTP method (GET, POST, etc.)
 * @param {string} path - The URL pathname
 * @returns {Response|null} A Response if the route was handled, null otherwise
 */
export function handleDbRoute(method, path) {
  // GET /api/db/status — check whether the database exists
  if (method === "GET" && path === "/api/db/status") {
    const exists = databaseExists();
    return new Response(
      JSON.stringify({ exists }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // POST /api/db/create — create the database (schema + seed data)
  if (method === "POST" && path === "/api/db/create") {
    try {
      const created = createDatabase();

      if (!created) {
        return new Response(
          JSON.stringify({ error: "Database already exists" }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return new Response(
        JSON.stringify({
          message: "Database created successfully",
          tables: [
            "users",
            "investment_types",
            "currencies",
            "investments",
            "currency_rates",
            "global_events",
          ],
        }),
        {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: "Failed to create database",
          detail: err.message,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }

  return null;
}

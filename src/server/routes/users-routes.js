import { Router } from "../router.js";
import { getAllUsers, getUserById, createUser, updateUser, deleteUser } from "../db/users-db.js";
import { validateUser } from "../validation.js";

/**
 * @description Router instance for user API routes.
 * @type {Router}
 */
const usersRouter = new Router();

// GET /api/users — list all users
usersRouter.get("/api/users", function () {
  try {
    const users = getAllUsers();
    return new Response(JSON.stringify(users), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch users", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// GET /api/users/:id — get a single user
usersRouter.get("/api/users/:id", function (request, params) {
  try {
    const user = getUserById(Number(params.id));
    if (!user) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify(user), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch user", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// POST /api/users — create a new user
usersRouter.post("/api/users", async function (request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid request", detail: "Request body must be valid JSON" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const errors = validateUser(body);
  if (errors.length > 0) {
    return new Response(
      JSON.stringify({ error: "Validation failed", detail: errors.join("; ") }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const user = createUser(body);
    return new Response(JSON.stringify(user), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to create user", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// PUT /api/users/:id — update an existing user
usersRouter.put("/api/users/:id", async function (request, params) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid request", detail: "Request body must be valid JSON" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const errors = validateUser(body);
  if (errors.length > 0) {
    return new Response(
      JSON.stringify({ error: "Validation failed", detail: errors.join("; ") }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const user = updateUser(Number(params.id), body);
    if (!user) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify(user), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to update user", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// DELETE /api/users/:id — delete a user
usersRouter.delete("/api/users/:id", function (request, params) {
  try {
    const deleted = deleteUser(Number(params.id));
    if (!deleted) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ message: "User deleted" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to delete user", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

/**
 * @description Handle a user API request. Delegates to the users router.
 * @param {string} method - HTTP method
 * @param {string} path - URL pathname
 * @param {Request} request - The full Request object
 * @returns {Promise<Response|null>} Response if matched, null otherwise
 */
export async function handleUsersRoute(method, path, request) {
  return await usersRouter.match(method, path, request);
}

import { Router } from "../router.js";
import { getAccountsByUserId, getAccountById, createAccount, updateAccount, deleteAccount } from "../db/accounts-db.js";
import { getUserById } from "../db/users-db.js";
import { validateAccount } from "../validation.js";
import { verifyPassphrase, loadHashFromEnv } from "../auth.js";

/**
 * @description Router instance for account API routes.
 * @type {Router}
 */
const accountsRouter = new Router();

// GET /api/users/:userId/accounts — list all accounts for a user
accountsRouter.get("/api/users/:userId/accounts", function (request, params) {
  try {
    const userId = Number(params.userId);
    const user = getUserById(userId);
    if (!user) {
      return new Response(JSON.stringify({ error: "User not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }

    const accounts = getAccountsByUserId(userId);
    return new Response(JSON.stringify(accounts), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to fetch accounts", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// GET /api/accounts/:id — get a single account
accountsRouter.get("/api/accounts/:id", function (request, params) {
  try {
    const account = getAccountById(Number(params.id));
    if (!account) {
      return new Response(JSON.stringify({ error: "Account not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify(account), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to fetch account", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// POST /api/users/:userId/accounts — create an account for a user
accountsRouter.post("/api/users/:userId/accounts", async function (request, params) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request", detail: "Request body must be valid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const userId = Number(params.userId);
  const user = getUserById(userId);
  if (!user) {
    return new Response(JSON.stringify({ error: "User not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
  }

  const errors = validateAccount(body);
  if (errors.length > 0) {
    return new Response(JSON.stringify({ error: "Validation failed", detail: errors.join("; ") }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    const account = createAccount({
      user_id: userId,
      account_type: body.account_type,
      account_ref: body.account_ref,
      cash_balance: Number(body.cash_balance) || 0,
      warn_cash: Number(body.warn_cash) || 0,
    });
    return new Response(JSON.stringify(account), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    // Handle unique constraint violation (duplicate account type for user)
    if (err.message && err.message.includes("UNIQUE constraint")) {
      return new Response(JSON.stringify({ error: "Validation failed", detail: "This user already has a " + body.account_type.toUpperCase() + " account" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "Failed to create account", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// PUT /api/accounts/:id — update an account
accountsRouter.put("/api/accounts/:id", async function (request, params) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request", detail: "Request body must be valid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // For updates, account_type is not changeable — only validate ref and cash fields
  const errors = [];
  if (body.account_ref !== undefined) {
    const refErr = validateAccount({ account_type: "trading", account_ref: body.account_ref, cash_balance: body.cash_balance, warn_cash: body.warn_cash });
    // Filter out account_type errors (not relevant for update)
    for (const e of refErr) {
      if (!e.includes("Account type")) {
        errors.push(e);
      }
    }
  }

  if (errors.length > 0) {
    return new Response(JSON.stringify({ error: "Validation failed", detail: errors.join("; ") }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    const account = updateAccount(Number(params.id), {
      account_ref: body.account_ref,
      cash_balance: Number(body.cash_balance) || 0,
      warn_cash: Number(body.warn_cash) || 0,
    });
    if (!account) {
      return new Response(JSON.stringify({ error: "Account not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify(account), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to update account", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// DELETE /api/accounts/:id — delete an account (requires passphrase confirmation)
accountsRouter.delete("/api/accounts/:id", async function (request, params) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request", detail: "Request body must be valid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const passphrase = body.passphrase;
  if (!passphrase || typeof passphrase !== "string") {
    return new Response(JSON.stringify({ error: "Validation failed", detail: "Passphrase is required to delete an account" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const storedHash = loadHashFromEnv();
  if (!storedHash) {
    return new Response(JSON.stringify({ error: "No passphrase configured", detail: "No passphrase has been set" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const isValid = await verifyPassphrase(passphrase, storedHash);
  if (!isValid) {
    return new Response(JSON.stringify({ error: "Incorrect passphrase" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  try {
    const deleted = deleteAccount(Number(params.id));
    if (!deleted) {
      return new Response(JSON.stringify({ error: "Account not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ message: "Account deleted" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to delete account", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

/**
 * @description Handle an account API request. Delegates to the accounts router.
 * @param {string} method - HTTP method
 * @param {string} path - URL pathname
 * @param {Request} request - The full Request object
 * @returns {Promise<Response|null>} Response if matched, null otherwise
 */
export async function handleAccountsRoute(method, path, request) {
  return await accountsRouter.match(method, path, request);
}

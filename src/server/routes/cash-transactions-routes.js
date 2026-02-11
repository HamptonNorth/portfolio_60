import { Router } from "../router.js";
import {
  createCashTransaction,
  getCashTransactionById,
  getCashTransactionsByAccountId,
  deleteCashTransaction,
  getIsaDepositsForTaxYear,
} from "../db/cash-transactions-db.js";
import { getAccountById } from "../db/accounts-db.js";
import { getIsaAllowanceConfig } from "../config.js";
import { validateCashTransaction } from "../validation.js";

/**
 * @description Router instance for cash transaction API routes.
 * @type {Router}
 */
const cashTxRouter = new Router();

// GET /api/accounts/:accountId/cash-transactions — list transactions for an account
cashTxRouter.get("/api/accounts/:accountId/cash-transactions", function (request, params) {
  try {
    const accountId = Number(params.accountId);
    const account = getAccountById(accountId);
    if (!account) {
      return new Response(
        JSON.stringify({ error: "Account not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get("limit"), 10) || 50;
    const transactions = getCashTransactionsByAccountId(accountId, limit);
    return new Response(JSON.stringify(transactions), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch transactions", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// GET /api/cash-transactions/:id — get a single transaction
cashTxRouter.get("/api/cash-transactions/:id", function (request, params) {
  try {
    const tx = getCashTransactionById(Number(params.id));
    if (!tx) {
      return new Response(
        JSON.stringify({ error: "Transaction not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify(tx), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch transaction", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// POST /api/accounts/:accountId/cash-transactions — create a deposit or withdrawal
cashTxRouter.post("/api/accounts/:accountId/cash-transactions", async function (request, params) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid request", detail: "Request body must be valid JSON" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const accountId = Number(params.accountId);
  const account = getAccountById(accountId);
  if (!account) {
    return new Response(
      JSON.stringify({ error: "Account not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  const errors = validateCashTransaction(body);
  if (errors.length > 0) {
    return new Response(
      JSON.stringify({ error: "Validation failed", detail: errors.join("; ") }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Hard check: withdrawals must not exceed available cash balance
  const amount = Number(body.amount);
  if (body.transaction_type === "withdrawal" && amount > account.cash_balance) {
    return new Response(
      JSON.stringify({
        error: "Insufficient cash",
        detail: `Withdrawal of £${amount.toFixed(2)} exceeds available balance of £${account.cash_balance.toFixed(2)}`,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    const tx = createCashTransaction({
      account_id: accountId,
      transaction_type: body.transaction_type,
      transaction_date: body.transaction_date,
      amount: amount,
      notes: body.notes || null,
    });
    return new Response(JSON.stringify(tx), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to create transaction", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// DELETE /api/cash-transactions/:id — delete a transaction and reverse balance
cashTxRouter.delete("/api/cash-transactions/:id", function (request, params) {
  try {
    // Load the transaction first to check it exists and is user-deletable
    const tx = getCashTransactionById(Number(params.id));
    if (!tx) {
      return new Response(
        JSON.stringify({ error: "Transaction not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    // Drawdown transactions cannot be deleted by the user
    if (tx.transaction_type === "drawdown") {
      return new Response(
        JSON.stringify({ error: "Cannot delete drawdown", detail: "Drawdown transactions are system-generated and cannot be deleted" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const deleted = deleteCashTransaction(Number(params.id));
    if (!deleted) {
      return new Response(
        JSON.stringify({ error: "Transaction not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ message: "Transaction deleted" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to delete transaction", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

// GET /api/accounts/:accountId/isa-allowance — get ISA allowance usage for current tax year
cashTxRouter.get("/api/accounts/:accountId/isa-allowance", function (request, params) {
  try {
    const accountId = Number(params.accountId);
    const account = getAccountById(accountId);
    if (!account) {
      return new Response(
        JSON.stringify({ error: "Account not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    if (account.account_type !== "isa") {
      return new Response(
        JSON.stringify({ error: "Not an ISA account", detail: "ISA allowance is only available for ISA accounts" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const isaConfig = getIsaAllowanceConfig();
    const taxYear = getCurrentTaxYear(isaConfig.taxYearStartMonth, isaConfig.taxYearStartDay);
    const deposits = getIsaDepositsForTaxYear(accountId, taxYear.start, taxYear.end);
    const remaining = isaConfig.annualLimit - deposits;

    return new Response(
      JSON.stringify({
        annual_limit: isaConfig.annualLimit,
        tax_year: taxYear.label,
        tax_year_start: taxYear.start,
        tax_year_end: taxYear.end,
        deposits_this_year: deposits,
        remaining: remaining,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch ISA allowance", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

/**
 * @description Calculate the current UK tax year boundaries based on today's date.
 * UK tax year runs from taxYearStartDay/taxYearStartMonth to the day before next year.
 * @param {number} startMonth - Month the tax year starts (1-12, typically 4 for April)
 * @param {number} startDay - Day the tax year starts (typically 6)
 * @returns {{ start: string, end: string, label: string }} Tax year boundaries as ISO-8601 dates
 */
export function getCurrentTaxYear(startMonth, startDay) {
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1; // 1-indexed
  const currentDay = today.getDate();

  // Determine the tax year start year
  // If we're before the tax year start date, the tax year started last calendar year
  let taxYearStartYear;
  if (currentMonth < startMonth || (currentMonth === startMonth && currentDay < startDay)) {
    taxYearStartYear = currentYear - 1;
  } else {
    taxYearStartYear = currentYear;
  }

  const taxYearEndYear = taxYearStartYear + 1;

  // Build ISO date strings
  const startStr = `${taxYearStartYear}-${String(startMonth).padStart(2, "0")}-${String(startDay).padStart(2, "0")}`;

  // End date is the day before the next tax year starts
  const endDate = new Date(taxYearEndYear, startMonth - 1, startDay);
  endDate.setDate(endDate.getDate() - 1);
  const endStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;

  return {
    start: startStr,
    end: endStr,
    label: `${taxYearStartYear}/${taxYearEndYear}`,
  };
}

/**
 * @description Handle a cash transaction API request. Delegates to the cash tx router.
 * @param {string} method - HTTP method
 * @param {string} path - URL pathname
 * @param {Request} request - The full Request object
 * @returns {Promise<Response|null>} Response if matched, null otherwise
 */
export async function handleCashTransactionsRoute(method, path, request) {
  return await cashTxRouter.match(method, path, request);
}

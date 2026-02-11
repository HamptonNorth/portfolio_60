import { getActiveDrawdownSchedules, getDueDrawdownDates } from "../db/drawdown-schedules-db.js";
import { createCashTransaction, drawdownExistsForDate } from "../db/cash-transactions-db.js";
import { getAccountById } from "../db/accounts-db.js";

/**
 * @description Process all due drawdowns on app startup. For each active
 * drawdown schedule, calculates all trigger dates up to today and creates
 * any missing drawdown transactions. Already-processed dates are skipped
 * (idempotent — safe to call on every restart).
 *
 * SIPP drawdowns are legally required pension payments and cannot be
 * silently skipped. If a drawdown would cause the cash balance to go
 * negative, a warning is logged but the drawdown is still processed.
 *
 * @returns {{ processed: number, skipped: number, warnings: string[] }}
 *   Summary of what happened during processing
 */
export function processDrawdowns() {
  const today = new Date();
  const todayStr = formatDate(today);

  const activeSchedules = getActiveDrawdownSchedules();

  if (activeSchedules.length === 0) {
    return { processed: 0, skipped: 0, warnings: [] };
  }

  let processed = 0;
  let skipped = 0;
  const warnings = [];

  for (const schedule of activeSchedules) {
    const dueDates = getDueDrawdownDates(schedule, todayStr);

    for (const triggerDate of dueDates) {
      // Deduplication: check if this drawdown has already been created
      if (drawdownExistsForDate(schedule.account_id, triggerDate)) {
        skipped++;
        continue;
      }

      // Check if balance will go negative and log a warning
      const account = getAccountById(schedule.account_id);
      if (account && account.cash_balance < schedule.amount) {
        const msg = `[Drawdown] Warning: Account ${account.account_ref} (ID ${schedule.account_id}) ` + `balance £${account.cash_balance.toFixed(2)} is less than drawdown £${schedule.amount.toFixed(2)} ` + `on ${triggerDate}. Balance will go negative.`;
        warnings.push(msg);
        console.warn(msg);
      }

      // Create the drawdown transaction (deducts from cash balance)
      createCashTransaction({
        account_id: schedule.account_id,
        transaction_type: "drawdown",
        transaction_date: triggerDate,
        amount: schedule.amount,
        notes: schedule.notes || `Drawdown (${schedule.frequency})`,
      });

      processed++;
      console.log(`[Drawdown] Created £${schedule.amount.toFixed(2)} drawdown for account ${schedule.account_id} on ${triggerDate}`);
    }
  }

  if (processed > 0 || warnings.length > 0) {
    console.log(`[Drawdown] Processing complete: ${processed} created, ${skipped} already existed, ${warnings.length} warnings`);
  }

  return { processed, skipped, warnings };
}

/**
 * @description Preview what drawdowns would be processed without making any
 * database changes. Same logic as processDrawdowns() but collects results
 * into an array instead of creating transactions. Used by the UI test button.
 *
 * @returns {{ would_process: Object[], already_exist: number, total_amount: number }}
 *   Detailed preview of what would happen
 */
export function previewDrawdowns() {
  const today = new Date();
  const todayStr = formatDate(today);

  const activeSchedules = getActiveDrawdownSchedules();

  const wouldProcess = [];
  let alreadyExist = 0;
  let totalAmount = 0;

  if (activeSchedules.length === 0) {
    return { would_process: wouldProcess, already_exist: 0, total_amount: 0 };
  }

  // Track a simulated running balance per account so warnings are accurate
  // even when multiple drawdowns stack up in the preview
  const simulatedBalances = {};

  for (const schedule of activeSchedules) {
    const dueDates = getDueDrawdownDates(schedule, todayStr);

    for (const triggerDate of dueDates) {
      if (drawdownExistsForDate(schedule.account_id, triggerDate)) {
        alreadyExist++;
        continue;
      }

      // Get or initialise the simulated balance for this account
      if (simulatedBalances[schedule.account_id] === undefined) {
        const account = getAccountById(schedule.account_id);
        simulatedBalances[schedule.account_id] = {
          balance: account ? account.cash_balance : 0,
          account_ref: account ? account.account_ref : "Unknown",
        };
      }

      const sim = simulatedBalances[schedule.account_id];
      let warning = null;

      if (sim.balance < schedule.amount) {
        warning = `Balance £${sim.balance.toFixed(2)} is less than drawdown £${schedule.amount.toFixed(2)}. Balance would go negative.`;
      }

      // Deduct from simulated balance so subsequent drawdowns are accurate
      sim.balance -= schedule.amount;

      wouldProcess.push({
        account_id: schedule.account_id,
        account_ref: sim.account_ref,
        date: triggerDate,
        amount: schedule.amount,
        notes: schedule.notes || `Drawdown (${schedule.frequency})`,
        warning: warning,
      });

      totalAmount += schedule.amount;
    }
  }

  return {
    would_process: wouldProcess,
    already_exist: alreadyExist,
    total_amount: Math.round(totalAmount * 100) / 100,
  };
}

/**
 * @description Format a Date object as an ISO-8601 date string (YYYY-MM-DD).
 * @param {Date} date - The date to format
 * @returns {string} Formatted date string
 */
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

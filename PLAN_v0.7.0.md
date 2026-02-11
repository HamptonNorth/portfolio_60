# PLAN v0.7.0 — Cash Movements: Deposits, Withdrawals & Drawdowns

## Overview

Add cash movement recording to Portfolio 60: deposits (cash in), withdrawals (cash out), and SIPP drawdown schedules. Each transaction automatically updates the account cash balance. ISA accounts display the unused annual allowance. Drawdown schedules are processed on app startup.

## Version

**v0.7.0** builds on the accounts/holdings/summary work from v0.6.0.

### Phases

1. **Database & Config** — New `drawdown_schedules` table, ISA allowance config, cash transactions DB module
2. **API Routes & Validation** — CRUD for cash transactions, drawdown schedules, ISA allowance endpoint
3. **Drawdown Processor** — Startup service that processes due drawdowns
4. **UI — Cash Movements** — Deposit/withdrawal forms on the holdings view, transaction history list
5. **UI — Drawdown Setup** — Drawdown schedule management for SIPP accounts
6. **UI — ISA Allowance** — Display unused annual allowance on ISA holdings view
7. **CLAUDE.md Updates** — Documentation

---

## Phase 1 — Database & Config

### 1.1 New table: `drawdown_schedules` (via Migration 11 in `connection.js`)

```sql
CREATE TABLE IF NOT EXISTS drawdown_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    frequency TEXT NOT NULL CHECK(frequency IN ('monthly', 'quarterly', 'annually')),
    trigger_day INTEGER NOT NULL CHECK(trigger_day >= 1 AND trigger_day <= 28),
    from_date TEXT NOT NULL,
    to_date TEXT NOT NULL,
    amount INTEGER NOT NULL,
    notes TEXT CHECK(notes IS NULL OR length(notes) <= 255),
    active INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_drawdown_schedules_account
    ON drawdown_schedules(account_id);
```

**Design notes:**

- `account_id` FK to accounts — constrained at API level to SIPP accounts only.
- `frequency`: 'monthly' (every month), 'quarterly' (every 3 months from `from_date`), 'annually' (once per year from `from_date`).
- `trigger_day`: 1–28 only (avoids month-length edge cases with 29/30/31).
- `from_date` / `to_date`: ISO-8601 `YYYY-MM-DD` — the day component is ignored, only year+month matter. Stored as `YYYY-MM-01` for consistency.
- `amount`: Integer scaled × 10000 (same as all other monetary values).
- `active`: 1 = active, 0 = paused/disabled. Allows user to temporarily stop drawdowns without deleting.

### 1.2 Config addition: ISA allowance

Add to `config.json`:

```json
{
  "isaAllowance": {
    "annualLimit": 20000,
    "taxYearStartMonth": 4,
    "taxYearStartDay": 6
  }
}
```

Add to `config.js`:

- `getIsaAllowanceConfig()` — returns `{ annualLimit, taxYearStartMonth, taxYearStartDay }` with defaults of `{ 20000, 4, 6 }`.

### 1.3 New DB module: `src/server/db/cash-transactions-db.js`

Functions:

- `createCashTransaction(data)` — Insert a cash transaction and update account cash balance. `data: { account_id, transaction_type, transaction_date, amount, notes }`. Amount is in decimal pounds (e.g. 1500.00), scaled on write.
  - For deposits: `UPDATE accounts SET cash_balance = cash_balance + ? WHERE id = ?`
  - For withdrawals/drawdowns: `UPDATE accounts SET cash_balance = cash_balance - ? WHERE id = ?`
  - Both insert + balance update in a single transaction (BEGIN/COMMIT) for atomicity.
- `getCashTransactionsByAccountId(accountId, limit)` — Returns transactions newest first, with unscaled amounts. Default limit 50.
- `getCashTransactionById(id)` — Single transaction by ID.
- `deleteCashTransaction(id)` — Delete a transaction and reverse its effect on cash balance (re-add for withdrawal, subtract for deposit). Wrapped in a DB transaction.
- `getIsaDepositsForTaxYear(accountId, taxYearStart, taxYearEnd)` — Sum of deposit amounts for a given date range. Returns unscaled total.
- `scaleCashAmount(value)` / `unscaleCashAmount(scaledValue)` — Scale helpers.

### 1.4 New DB module: `src/server/db/drawdown-schedules-db.js`

Functions:

- `createDrawdownSchedule(data)` — Insert a new schedule. `data: { account_id, frequency, trigger_day, from_date, to_date, amount, notes }`.
- `updateDrawdownSchedule(id, data)` — Update an existing schedule.
- `deleteDrawdownSchedule(id)` — Delete a schedule.
- `getDrawdownScheduleById(id)` — Single schedule.
- `getDrawdownSchedulesByAccountId(accountId)` — All schedules for an account, ordered by from_date.
- `getActiveDrawdownSchedules()` — All active schedules across all accounts (for the processor).
- `getDueDrawdownDates(schedule, upToDate)` — Given a schedule and a date, return an array of all trigger dates from `from_date` to the earlier of `to_date` or `upToDate` that match the frequency.

### 1.5 Unit tests

- `tests/unit/cash-transactions-db.test.js` — Direct DB tests for CRUD, balance updates, ISA deposit totals, atomicity.
- `tests/unit/drawdown-schedules-db.test.js` — Direct DB tests for schedule CRUD, active filtering.

---

## Phase 2 — API Routes & Validation

### 2.1 Routes: `src/server/routes/cash-transactions-routes.js`

| Method | Path | Action |
|--------|------|--------|
| GET | `/api/accounts/:accountId/cash-transactions` | List transactions for account |
| GET | `/api/cash-transactions/:id` | Get single transaction |
| POST | `/api/accounts/:accountId/cash-transactions` | Create deposit or withdrawal |
| DELETE | `/api/cash-transactions/:id` | Delete and reverse balance |

**POST body:**
```json
{
  "transaction_type": "deposit",
  "transaction_date": "2026-02-11",
  "amount": 1500.00,
  "notes": "Monthly ISA deposit"
}
```

**Validation on POST:**
- `transaction_type` must be 'deposit' or 'withdrawal' (drawdowns are created by the processor, not directly by users).
- `transaction_date` must be valid ISO-8601 date.
- `amount` must be > 0.
- `notes` optional, max 255 chars.
- For withdrawals: `amount` must be ≤ account's current `cash_balance`. Hard block — no negative cash allowed.

### 2.2 Routes: `src/server/routes/drawdown-schedules-routes.js`

| Method | Path | Action |
|--------|------|--------|
| GET | `/api/accounts/:accountId/drawdown-schedules` | List schedules for account |
| GET | `/api/drawdown-schedules/:id` | Get single schedule |
| POST | `/api/accounts/:accountId/drawdown-schedules` | Create schedule |
| PUT | `/api/drawdown-schedules/:id` | Update schedule |
| DELETE | `/api/drawdown-schedules/:id` | Delete schedule |

**Validation on POST/PUT:**
- Account must be a SIPP account.
- `frequency` must be 'monthly', 'quarterly', or 'annually'.
- `trigger_day` must be 1–28.
- `from_date` and `to_date` must be valid, `to_date` > `from_date`.
- `amount` must be > 0.
- `notes` optional, max 255 chars.

### 2.3 Route: ISA allowance info

| Method | Path | Action |
|--------|------|--------|
| GET | `/api/accounts/:accountId/isa-allowance` | Get ISA allowance usage for current tax year |

**Response:**
```json
{
  "annual_limit": 20000,
  "tax_year": "2025/2026",
  "tax_year_start": "2025-04-06",
  "tax_year_end": "2026-04-05",
  "deposits_this_year": 4500.00,
  "remaining": 15500.00
}
```

This endpoint reads ISA config, calculates the current tax year boundaries, queries deposit totals, and returns the allowance status. Returns 400 if account is not ISA type.

### 2.4 Validation additions to `validation.js`

- `validateCashTransaction(data)` — Validates transaction_type, transaction_date, amount, notes.
- `validateDrawdownSchedule(data)` — Validates frequency, trigger_day, from_date, to_date, amount, notes.

### 2.5 Register routes in `index.js`

Add route handlers under `/api/accounts` (for nested paths with `/cash-transactions` and `/drawdown-schedules`) and standalone paths for `/api/cash-transactions` and `/api/drawdown-schedules`.

### 2.6 Unit tests

- `tests/unit/cash-transactions-routes.test.js` (port 1445) — HTTP tests for deposit, withdrawal, validation, balance updates, withdrawal-exceeds-balance rejection.
- `tests/unit/drawdown-schedules-routes.test.js` (port 1446) — HTTP tests for schedule CRUD, SIPP-only validation.

---

## Phase 3 — Drawdown Processor

### 3.1 Service: `src/server/services/drawdown-processor.js`

**`processDrawdowns()`** — Called on app startup (after database is ready):

1. Load all active drawdown schedules.
2. For each schedule, determine all trigger dates from `from_date` up to today.
3. For each trigger date, check if a cash_transaction with `transaction_type = 'drawdown'` and matching `account_id` and `transaction_date` already exists.
4. If not, create the drawdown cash transaction (which deducts from cash balance).
5. Log each created drawdown to console.
6. If cash balance would go negative, log a warning but still process the drawdown (the balance becomes negative as an alert condition — the user must then deposit funds or adjust the schedule). **Rationale:** SIPP drawdowns are legally required pension payments and cannot be silently skipped.

**Trigger date calculation — `getDueDrawdownDates(schedule, upToDate)`:**

- **Monthly**: Trigger on `trigger_day` of every month from `from_date` month/year to `to_date` month/year (inclusive).
- **Quarterly**: Trigger every 3 months from `from_date` month.
- **Annually**: Trigger once per year from `from_date` month.
- Skip any dates in the future (after `upToDate`).

**Deduplication:** Before creating a drawdown transaction, check `cash_transactions` for an existing row with the same `account_id`, `transaction_type = 'drawdown'`, and `transaction_date`. This ensures idempotency — multiple app restarts on the same day won't create duplicate drawdowns.

### 3.2 Integration with server startup

In `src/server/index.js`, after database initialisation, call:

```javascript
import { processDrawdowns } from "./services/drawdown-processor.js";
// ... after database is ready ...
processDrawdowns();
```

### 3.3 Unit tests

- `tests/unit/drawdown-processor.test.js` — Direct DB tests: processes due drawdowns, skips already-processed dates, handles monthly/quarterly/annually, handles negative balance with warning.

---

## Phase 4 — UI: Cash Movements

### 4.1 Holdings view enhancements

On the holdings view (the account detail page under "Account Setup" tab), add below the holdings table:

**Cash balance header** (already shown in the page header but replicated here with more detail):

```
Cash Balance: £23,765.00    [Deposit]  [Withdraw]
```

**Cash Transaction History** — a collapsible section below the holdings table:

```
Cash Transactions                              [Show/Hide]
─────────────────────────────────────────────────────────
Date         Type          Amount     Notes
11/02/2026   Deposit       £1,500     Monthly ISA deposit
05/02/2026   Withdrawal    £200       Transfer to current account
01/02/2026   Drawdown      £1,200     SIPP monthly pension
─────────────────────────────────────────────────────────
```

- Transactions displayed newest first, limited to 20 most recent with a "Show more" option.
- Drawdown transactions shown but not user-editable (created by the processor).
- Deposit and withdrawal transactions can be deleted (with confirmation dialog, which reverses the balance).

### 4.2 Deposit modal form

Triggered by the [Deposit] button:

- **Date**: Date input, defaults to today
- **Amount**: Decimal money input (step 0.01, min 0.01)
- **Notes**: Text input (max 255 chars, optional)
- Save / Cancel buttons

On save: POST to `/api/accounts/:accountId/cash-transactions` with `transaction_type: "deposit"`. Refresh holdings view (which reloads account data including updated cash balance) and transaction list.

### 4.3 Withdrawal modal form

Same layout as deposit but:

- Shows current cash balance prominently: "Available: £23,765.00"
- Amount validation: must be ≤ available cash balance
- Client-side check before submission, server-side hard block as backup

### 4.4 Transaction delete

- Delete button on each deposit/withdrawal row (not on drawdown rows)
- Confirmation dialog: "Delete this £1,500 deposit from 11/02/2026? This will reverse the cash balance change."
- On confirm: DELETE `/api/cash-transactions/:id`, refresh view.

---

## Phase 5 — UI: Drawdown Setup

### 5.1 Drawdown section on SIPP holdings view

Only visible when the selected account is a SIPP. Shown below the cash transactions section:

```
Drawdown Schedules
─────────────────────────────────────────────────────────────
Frequency   Day   From       To         Amount    Notes     
Monthly     15    04/2026    03/2027    £1,200    Pension     [Edit] [Delete]
─────────────────────────────────────────────────────────────
                                                  [Add Drawdown Schedule]
```

### 5.2 Drawdown schedule modal form

- **Frequency**: Dropdown — Monthly (default), Quarterly, Annually
- **Trigger Day**: Number input 1–28
- **From**: Month/Year picker (MM/YYYY format)
- **To**: Month/Year picker (MM/YYYY format)
- **Amount**: Decimal money input
- **Notes**: Text input (optional, max 255)
- Save / Cancel buttons
- Delete button (edit mode only)

### 5.3 Active/Paused toggle

Each schedule row has an Active/Paused indicator. Clicking toggles the `active` flag via PUT. Paused schedules are displayed greyed out and not processed by the drawdown processor.

---

## Phase 6 — UI: ISA Allowance

### 6.1 ISA allowance banner on ISA holdings view

Only visible when the selected account is an ISA. Shown at the top of the holdings view, below the header:

```
┌──────────────────────────────────────────────────────┐
│  Unused Annual ISA Allowance 2025/2026:  £15,500     │
│  (£4,500 of £20,000 used)                            │
└──────────────────────────────────────────────────────┘
```

- Fetched from `GET /api/accounts/:accountId/isa-allowance`
- Displayed as a light info banner (blue-ish brand background)
- If remaining ≤ 0: banner turns to warning colour with "ISA allowance fully used for 2025/2026"
- Refreshed after each deposit

---

## Phase 7 — CLAUDE.md Updates

### 7.1 Update Database Schema section

Add `drawdown_schedules` table documentation.

### 7.2 Update Development Milestones

Add v0.7.0 milestones (18–23).

### 7.3 Update Test Port Allocations

Add new test file ports (1445–1448).

### 7.4 Update Future Enhancements

Remove/update the Deposits/Withdrawals and Cash adjustments entries (now implemented). Add note about ISA allowance tracking across investment purchases (future).

---

## File Change Summary

### New files

| File | Purpose |
|---|---|
| `src/server/db/cash-transactions-db.js` | Cash transactions CRUD + balance updates |
| `src/server/db/drawdown-schedules-db.js` | Drawdown schedule CRUD |
| `src/server/routes/cash-transactions-routes.js` | Cash transaction API endpoints |
| `src/server/routes/drawdown-schedules-routes.js` | Drawdown schedule API endpoints |
| `src/server/services/drawdown-processor.js` | Startup drawdown processing |
| `tests/unit/cash-transactions-db.test.js` | DB-level cash transaction tests |
| `tests/unit/drawdown-schedules-db.test.js` | DB-level drawdown schedule tests |
| `tests/unit/cash-transactions-routes.test.js` | Route-level cash transaction tests |
| `tests/unit/drawdown-schedules-routes.test.js` | Route-level drawdown schedule tests |
| `tests/unit/drawdown-processor.test.js` | Drawdown processor tests |

### Modified files

| File | Changes |
|---|---|
| `src/server/db/schema.sql` | Add `drawdown_schedules` table |
| `src/server/db/connection.js` | Migration 11: create drawdown_schedules table + index |
| `src/server/index.js` | Register new routes, call drawdown processor on startup |
| `src/server/config.js` | Add `getIsaAllowanceConfig()` with defaults |
| `src/server/validation.js` | Add `validateCashTransaction()`, `validateDrawdownSchedule()` |
| `src/shared/config.json` | Add `isaAllowance` section |
| `src/ui/pages/portfolio.html` | Add cash transaction section, drawdown section, ISA banner, modal forms |
| `src/ui/js/portfolio.js` | Cash transaction UI logic, drawdown UI logic, ISA allowance display |
| `CLAUDE.md` | Schema docs, milestones, port allocations |

---

## Implementation Order

1. Phase 1: Database schema + config + DB modules + DB-level tests
2. Phase 2: API routes + validation + route-level tests
3. Phase 3: Drawdown processor + tests
4. Phase 4: UI for deposits/withdrawals
5. Phase 5: UI for drawdown schedules
6. Phase 6: ISA allowance display
7. Phase 7: CLAUDE.md updates

Each phase will be followed by a manual testing pause.

---

## Test Port Allocations

| Test file | Port |
|---|---|
| cash-transactions-db.test.js | (direct DB, no port) |
| drawdown-schedules-db.test.js | (direct DB, no port) |
| cash-transactions-routes.test.js | 1445 |
| drawdown-schedules-routes.test.js | 1446 |
| drawdown-processor.test.js | (direct DB, no port) |

---

## Open Design Notes

- **Drawdown negative balance**: SIPP drawdowns are legally required pension payments. The processor will create the transaction even if it results in a negative cash balance. The summary valuation cash warning (from v0.6.0) will flag this visually.
- **Tax year calculation**: UK tax year runs 6 April to 5 April. `getCurrentTaxYear()` helper derives the year boundaries from today's date.
- **Drawdown deduplication**: Uses `(account_id, transaction_type='drawdown', transaction_date)` as the uniqueness check — no UNIQUE constraint in the DB, checked in application code before insert.
- **Transaction deletion**: Only deposits and withdrawals can be deleted by the user. Drawdown transactions (created by the processor) cannot be deleted via the UI.
- **No edit for transactions**: Cash transactions are immutable once created (delete and re-enter if wrong). This keeps the audit trail simple.
- **ISA allowance future**: When buy transactions are added (v0.8.0+), the ISA limit check should also account for investment purchases funded from ISA deposits. For now, only cash deposits are counted.

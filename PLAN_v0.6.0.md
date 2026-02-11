# PLAN v0.6.0 — Portfolio: Accounts, Holdings & Summary Valuation

## Overview

This release introduces the portfolio hierarchy: **accounts** and **holdings** beneath each user, plus a **portfolio summary valuation report** with drill-down to individual holdings. Buy/sell transactions, deposits/withdrawals, and cash movements are deferred to a future phase — only the schema and CLAUDE.md documentation for those tables are included now.

## Version

Bump `APP_VERSION` in `src/shared/constants.js` from `"0.1.0"` to `"0.6.0"`.

---

## Phase 1 — Database Schema

### 1.1 New Tables (via Migration 10 in `connection.js`)

#### `accounts`

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PRIMARY KEY AUTOINCREMENT | |
| user_id | INTEGER NOT NULL | FK to users(id) |
| account_type | TEXT NOT NULL | CHECK(account_type IN ('trading', 'isa', 'sipp')) |
| account_ref | TEXT NOT NULL | The trading/ISA/SIPP reference (max 15 chars) |
| cash_balance | INTEGER NOT NULL DEFAULT 0 | Stored x10000, always positive. Format 9(7)v9(4) |
| warn_cash | INTEGER NOT NULL DEFAULT 0 | Stored x10000. Warn if cash_balance < this value |
| UNIQUE(user_id, account_type) | | One account per type per user |

- FK: `user_id` references `users(id)`
- Index: `idx_accounts_user` on `accounts(user_id)`

#### `holdings`

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PRIMARY KEY AUTOINCREMENT | |
| account_id | INTEGER NOT NULL | FK to accounts(id) |
| investment_id | INTEGER NOT NULL | FK to investments(id) |
| quantity | INTEGER NOT NULL DEFAULT 0 | Stored x10000. Format 9(6)v9(4) |
| average_cost | INTEGER NOT NULL DEFAULT 0 | Stored x10000. Format 9(6)v9(4) |
| UNIQUE(account_id, investment_id) | | One holding per investment per account |

- FK: `account_id` references `accounts(id)`
- FK: `investment_id` references `investments(id)`
- Index: `idx_holdings_account` on `holdings(account_id)`
- Index: `idx_holdings_investment` on `holdings(investment_id)`

#### `cash_transactions` (schema only — no UI in this phase)

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PRIMARY KEY AUTOINCREMENT | |
| account_id | INTEGER NOT NULL | FK to accounts(id) |
| transaction_type | TEXT NOT NULL | CHECK(IN ('deposit', 'withdrawal', 'drawdown', 'adjustment')) |
| transaction_date | TEXT NOT NULL | ISO-8601 date (YYYY-MM-DD) |
| amount | INTEGER NOT NULL | Stored x10000. Always positive |
| notes | TEXT | Optional description (max 255 chars) |

- FK: `account_id` references `accounts(id)`
- Index: `idx_cash_transactions_account` on `cash_transactions(account_id, transaction_date DESC)`

#### `holding_movements` (schema only — no UI in this phase)

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PRIMARY KEY AUTOINCREMENT | |
| holding_id | INTEGER NOT NULL | FK to holdings(id) |
| movement_type | TEXT NOT NULL | CHECK(IN ('buy', 'sell', 'adjustment')) |
| movement_date | TEXT NOT NULL | ISO-8601 date (YYYY-MM-DD) |
| quantity | INTEGER NOT NULL | Stored x10000. Positive for buys, negative for sells |
| movement_value | INTEGER NOT NULL | Stored x10000. Cash amount of the trade |
| notes | TEXT | Optional description (max 255 chars) |

- FK: `holding_id` references `holdings(id)`
- Index: `idx_holding_movements_holding` on `holding_movements(holding_id, movement_date DESC)`

### 1.2 Data Migration — Auto-create accounts from existing user refs

Inside Migration 10, after creating tables:

1. Query all users.
2. For each user, if `trading_ref` is not null/empty, INSERT an account row with `account_type='trading'`, `account_ref=trading_ref`, `cash_balance=0`, `warn_cash=0`.
3. Same for `isa_ref` → `account_type='isa'`.
4. Same for `sipp_ref` → `account_type='sipp'`.

The existing `trading_ref`, `isa_ref`, `sipp_ref` columns on the users table are **left in place** for now (they are still used on the users CRUD page). They become the canonical source only for new account creation going forward — the accounts table is the authoritative record.

### 1.3 New DB modules

- **`src/server/db/accounts-db.js`** — CRUD for accounts:
  - `getAccountsByUserId(userId)` — returns all accounts for a user, ordered by account_type
  - `getAccountById(id)` — single account with user details
  - `createAccount(data)` — create account (user_id, account_type, account_ref, cash_balance, warn_cash)
  - `updateAccount(id, data)` — update cash_balance, warn_cash, account_ref
  - `deleteAccount(id)` — delete account (cascading delete of holdings)

- **`src/server/db/holdings-db.js`** — CRUD for holdings:
  - `getHoldingsByAccountId(accountId)` — all holdings for an account, joined with investment details
  - `getHoldingById(id)` — single holding with investment details
  - `createHolding(data)` — create holding (account_id, investment_id, quantity, average_cost)
  - `updateHolding(id, data)` — update quantity, average_cost
  - `deleteHolding(id)` — delete a holding

### 1.4 Scaling helpers

All values (cash_balance, warn_cash, quantity, average_cost) use the existing `CURRENCY_SCALE_FACTOR` (10000). The existing `scalePrice`/`unscalePrice` pattern from `prices-db.js` will be reused. No new scale factor needed.

### 1.5 Unit tests

- **`tests/unit/accounts-db.test.js`** (port 1440) — test account CRUD, unique constraint, cascade delete
- **`tests/unit/holdings-db.test.js`** (port 1441) — test holding CRUD, unique constraint, investment joins

---

## Phase 2 — API Routes & Validation

### 2.1 Routes

- **`src/server/routes/accounts-routes.js`**:
  - `GET /api/users/:userId/accounts` — list accounts for a user
  - `GET /api/accounts/:id` — get single account
  - `POST /api/users/:userId/accounts` — create account for a user
  - `PUT /api/accounts/:id` — update account
  - `DELETE /api/accounts/:id` — delete account

- **`src/server/routes/holdings-routes.js`**:
  - `GET /api/accounts/:accountId/holdings` — list holdings for an account
  - `GET /api/holdings/:id` — get single holding
  - `POST /api/accounts/:accountId/holdings` — create holding for an account
  - `PUT /api/holdings/:id` — update holding
  - `DELETE /api/holdings/:id` — delete holding

### 2.2 Validation (additions to `validation.js`)

- `validateAccount(data)` — check account_type is valid, account_ref required and max 15 chars, cash_balance and warn_cash are non-negative numbers
- `validateHolding(data)` — check investment_id is a positive integer, quantity is non-negative, average_cost is non-negative

### 2.3 Register routes in `index.js`

Add route handlers for `/api/accounts` and `/api/holdings` paths, plus `/api/users/:userId/accounts`. All behind the auth gate (not scraper endpoints).

### 2.4 Unit tests

- **`tests/unit/accounts-routes.test.js`** (port 1442) — test API endpoints
- **`tests/unit/holdings-routes.test.js`** (port 1443) — test API endpoints

---

## Phase 3 — Portfolio Setup UI (Accounts + Holdings)

### 3.1 New page: `src/ui/pages/portfolio.html`

A single "Portfolio" page accessible from the main nav (replaces the disabled "Valuations" link). The page has two views:

**View 1 — Accounts list (per user)**

- Dropdown at top to select a user (populated from `/api/users`)
- On user selection, load that user's accounts from `/api/users/:id/accounts`
- Table showing: Account Type (SIPP/ISA/Trading), Account Ref, Cash Balance (formatted as GBP), Warning Threshold
- "Add Account" button — opens a modal form:
  - Account Type (dropdown: Trading/ISA/SIPP — only show types not yet used by this user)
  - Account Ref (text, pre-filled from user's corresponding ref field if available)
  - Cash Balance (number input, formatted as pounds.pence, stored x10000)
  - Warning Threshold (number input, same format)
- Click row to edit account (same modal, pre-filled)
- Delete from edit modal with confirmation
- Each account row has a "Holdings" button to drill into View 2

**View 2 — Holdings list (per account)**

- Shows account header: User Name, Account Type, Account Ref
- Table showing: Investment (description + public_id), Currency, Quantity, Average Cost
- "Add Holding" button — opens a modal form:
  - Investment (dropdown, populated from `/api/investments` — only show investments not already held in this account)
  - Quantity (number input, 4 decimal places)
  - Average Cost (number input, 4 decimal places)
- Click row to edit holding (same modal, pre-filled)
- Delete from edit modal with confirmation
- "Back to Accounts" button to return to View 1

### 3.2 New JS: `src/ui/js/portfolio.js`

Follows the established pattern from `users.js` — event listeners on DOMContentLoaded, functions for load/show/edit/delete, `apiRequest()` for API calls, `escapeHtml()` for XSS prevention.

### 3.3 Navigation changes

- Enable the "Valuations" nav link → points to `/pages/portfolio.html`
- Rename it from "Valuations" to "Portfolio" (clearer for the target audience)
- Add `data-nav="portfolio"` for nav highlighting
- Update nav in **all** page HTML files (users.html, investments.html, currencies.html, global-events.html, benchmarks.html, scraping.html, scraper-testing.html, backup.html, index.html)

---

## Phase 4 — Portfolio Summary Valuation Report

### 4.1 New API endpoint

**`GET /api/portfolio/summary/:userId`**

Returns a computed summary for a single user, including:

```json
{
  "user": { "id": 1, "first_name": "Robert", "last_name": "Collins" },
  "valuation_date": "2026-02-11",
  "accounts": [
    {
      "id": 1,
      "account_type": "sipp",
      "account_ref": "12345",
      "cash_balance": 23765.00,
      "warn_cash": 25000.00,
      "cash_warning": true,
      "investments_total": 191169.00,
      "account_total": 214934.00,
      "holdings": [
        {
          "holding_id": 1,
          "investment_id": 5,
          "public_id": "LSE:RPI",
          "description": "Raspberry Pi Holdings",
          "currency_code": "GBP",
          "quantity": 365.0000,
          "price": 1.5650,
          "price_date": "2026-02-10",
          "rate": null,
          "value_local": 571.23,
          "value_gbp": 571.23,
          "average_cost": 0.9550
        }
      ]
    }
  ],
  "totals": {
    "investments": 419913.00,
    "cash": 42880.00,
    "grand_total": 462793.00
  }
}
```

**Computation logic** (in a new service module `src/server/services/portfolio-service.js`):

1. Load all accounts for the user
2. For each account, load all holdings
3. For each holding:
   a. Get latest price from `prices` table
   b. Get the investment's currency
   c. If currency is not GBP, get latest rate from `currency_rates` table
   d. Calculate: `value_local = quantity * price`
   e. Calculate: `value_gbp = value_local * rate` (or just `value_local` if GBP)
4. Sum all `value_gbp` per account → `investments_total`
5. `account_total = investments_total + cash_balance`
6. Set `cash_warning = (cash_balance < warn_cash && warn_cash > 0)`
7. Aggregate totals across all accounts

### 4.2 Portfolio routes file

**`src/server/routes/portfolio-routes.js`**:
- `GET /api/portfolio/summary/:userId` — calls portfolio service, returns JSON
- `GET /api/portfolio/summary` — returns summaries for ALL users (for the overview page)

Register in `index.js` under `/api/portfolio`.

### 4.3 Portfolio report UI

Extend the existing `portfolio.html` page with a third view:

**View 0 — Summary Report (default/landing view)**

- Dropdown to select a user, or "All Users" (default)
- For each user, display the summary table matching the mockup:

```
Robert Collins  Summary valuation  11/02/2026

SIPP      Account 12345         Investments   £191,169   Cash  £23,765   £214,934   ** warning min cash £25,000
Trading   Account 7654321       Investments    £58,123   Cash      £27    £58,150
ISA       Account 775339        Investments   £238,001   Cash  £19,088   £257,089
                                              --------         -------   --------
                                Total         £419,913         £42,880   £462,793
```

- Account type labels displayed as uppercase (SIPP, TRADING, ISA)
- Cash warning shown in red with `**` prefix
- Amounts right-aligned, formatted with commas and GBP symbol
- "View" button on each account row → drills into holding detail

**View 3 — Holdings Detail (drill-down)**

- Displayed when user clicks "View" on a summary row
- Header: `SIPP  Account 12345  Investments £191,169  Cash £23,765  Total £214,934  ** warning`
- Holdings table matching the mockup:

```
Public ID/Name                          Currency  Quantity    Price     Rate    Value   Value GBP   Avg Cost
LSE:RPI
Raspberry Pi Holdings                      GBP       365    1.5650              571         571     0.9550
ISIN:GB00B7FQLN12
Rathbone Global Opportunities Fund...     GBP   661.1520  234.0055          154,713     154,713    130.4000
ISF:LSE:GBX
iShares Core FTSE 100...                   GBP       210   19.5000            4,095       4,095    16.0000
NSQ:MSFT
Microsoft                                  USD       125  185.7700   1.3690  23,221      31,790   101.0000 USD
                                                                                       --------
                                                                 Total Investments GBP  191,169
```

- Public ID on first line (bold/muted), investment name on second line
- For non-GBP holdings: "Value" column shows local currency value, "Value GBP" shows converted value, rate column shows the exchange rate
- For GBP holdings: "Value" column is blank or same as Value GBP, rate column is blank
- Average cost shown in investment's native currency; if non-GBP, append currency code (e.g. "101.0000 USD")
- "Back to Summary" button

### 4.4 Formatting helpers

Add to `src/ui/js/app.js` (or a new `src/ui/js/format-utils.js`):

- `formatGBP(amount)` — format as `£1,234` or `£1,234.56` (no decimal if whole number, 2 decimals otherwise)
- `formatQuantity(qty)` — format with up to 4 decimal places, stripping trailing zeros
- `formatPrice(price)` — format with up to 4 decimal places
- `formatRate(rate)` — format with 4 decimal places

### 4.5 Styling

- Summary table uses a clean, financial-report layout
- Right-aligned numeric columns
- Zebra striping on holdings rows
- Cash warning in red text
- Totals row with top border separator
- Responsive within the 1536x864 target viewport

---

## Phase 5 — CLAUDE.md Updates

### 5.1 Add to "Future Enhancements (post v0.1.0)" section:

- **Buy/Sell transactions**: Record investment purchases and sales in `holding_movements` table. Buys increase holding quantity and debit account cash; sells decrease quantity and credit cash. Average cost recalculated on each buy. Book cost recorded on sell.
- **Deposits/Withdrawals**: Record cash movements in/out of accounts via `cash_transactions` table. Deposit credits cash; withdrawal debits. SIPP drawdowns as a special withdrawal type on fixed schedule (15th or last day of month).
- **Cash adjustments**: Direct adjustments to account cash balance to reconcile with provider (management charges, admin fees, etc.).
- **Holding adjustments**: Small adjustments to holding quantity and average cost for mutual income funds with automatic reinvestment.

### 5.2 Update "Database Schema" section

Add the four new tables (accounts, holdings, cash_transactions, holding_movements) to the schema documentation.

### 5.3 Update "Development Milestones" section

Add milestones for v0.6.0 work.

---

## File Change Summary

### New files:
| File | Purpose |
|---|---|
| `src/server/db/accounts-db.js` | Accounts CRUD database layer |
| `src/server/db/holdings-db.js` | Holdings CRUD database layer |
| `src/server/routes/accounts-routes.js` | Accounts API endpoints |
| `src/server/routes/holdings-routes.js` | Holdings API endpoints |
| `src/server/routes/portfolio-routes.js` | Portfolio summary/valuation API |
| `src/server/services/portfolio-service.js` | Valuation computation logic |
| `src/ui/pages/portfolio.html` | Portfolio page (accounts, holdings, report) |
| `src/ui/js/portfolio.js` | Portfolio page JavaScript |
| `tests/unit/accounts-db.test.js` | Accounts DB unit tests |
| `tests/unit/holdings-db.test.js` | Holdings DB unit tests |
| `tests/unit/accounts-routes.test.js` | Accounts API unit tests |
| `tests/unit/holdings-routes.test.js` | Holdings API unit tests |

### Modified files:
| File | Change |
|---|---|
| `src/server/db/connection.js` | Migration 10: create accounts, holdings, cash_transactions, holding_movements tables + migrate existing user refs |
| `src/server/db/schema.sql` | Add the four new table definitions (for fresh installs) |
| `src/server/index.js` | Register accounts, holdings, and portfolio route handlers |
| `src/server/validation.js` | Add validateAccount() and validateHolding() |
| `src/shared/constants.js` | Bump APP_VERSION to "0.6.0" |
| `src/ui/index.html` | Update nav: enable "Portfolio" link |
| `src/ui/pages/users.html` | Update nav: enable "Portfolio" link |
| `src/ui/pages/investments.html` | Update nav: enable "Portfolio" link |
| `src/ui/pages/currencies.html` | Update nav: enable "Portfolio" link |
| `src/ui/pages/global-events.html` | Update nav: enable "Portfolio" link |
| `src/ui/pages/benchmarks.html` | Update nav: enable "Portfolio" link |
| `src/ui/pages/scraping.html` | Update nav: enable "Portfolio" link |
| `src/ui/pages/scraper-testing.html` | Update nav: enable "Portfolio" link |
| `src/ui/pages/backup.html` | Update nav: enable "Portfolio" link |
| `src/ui/js/app.js` | Add GBP/number formatting helpers |
| `CLAUDE.md` | Add future enhancements + schema docs for new tables |

---

## Implementation Order

1. **Phase 1** — Schema migration + DB modules + DB tests
2. **Phase 2** — API routes + validation + route tests
3. **Phase 3** — Portfolio setup UI (accounts + holdings CRUD)
4. **Phase 4** — Portfolio summary valuation report + holdings drill-down
5. **Phase 5** — CLAUDE.md documentation updates

Each phase will be followed by a manual testing pause.

---

## Test Port Allocations

| Test file | Port |
|---|---|
| accounts-db.test.js | 1440 |
| holdings-db.test.js | 1441 |
| accounts-routes.test.js | 1442 |
| holdings-routes.test.js | 1443 |

---

## Open Design Notes

- The holdings detail view shows price date alongside price, so the user can see how stale a price is (e.g. if scraping failed for a few days).
- For investments with no price data yet, the holdings detail shows "No price" and excludes from valuation totals (with a note).
- The summary "valuation date" is today's date (when the report is generated), not the date of the latest price.
- All monetary formatting uses UK conventions: comma thousands separator, GBP symbol prefix.

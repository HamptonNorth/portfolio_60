# Portfolio 60 - UK Family Investment Portfolio Tracker

## Project Overview
A browser-based application for UK families to track investments across multiple people and account types. Investments may include shares, mutual funds, investment trusts, savings accounts and other instruments. All valuations and reports are in GBP, with support for foreign-currency-priced investments via currency conversion.

This is a UK-only application due to tax rule complexity.

## Version Scope
**v0.1.0** — Foundation: database, core CRUD screens, currency/price scraping, backup/restore.

Future versions will add portfolio holdings per person, valuations, performance comparison against benchmarks, inflation adjustment, SIPP withdrawal tracking, and sold-investment shadow portfolios.

## Future Enhancements (post v0.1.0)

- **Scraping history viewer**: UI page to browse/filter past scrape attempts. Backend API already exists (`GET /api/scraper/history` with filtering by scrapeType, success, date range). Useful for diagnosing recurring failures and confirming scheduled scrapes ran correctly.
- **Cron-scheduled automated scraping**: Run price/benchmark scrapes on a schedule without user interaction.
- **YubiKey HMAC-SHA1 challenge-response**: Hardware-bound authentication.
- **SQLCipher database encryption**: Encrypt database at rest.
- **Buy/Sell transactions**: Record investment purchases and sales in `holding_movements` table. Buys increase holding quantity and debit account cash; sells decrease quantity and credit cash. Average cost recalculated on each buy. Book cost recorded on sell.
- **Deposits/Withdrawals**: Record cash movements in/out of accounts via `cash_transactions` table. Deposit credits cash; withdrawal debits. SIPP drawdowns as a special withdrawal type on fixed schedule (15th or last day of month).
- **Cash adjustments**: Direct adjustments to account cash balance to reconcile with provider (management charges, admin fees, etc.).
- **Holding adjustments**: Small adjustments to holding quantity and average cost for mutual income funds with automatic reinvestment.

## Tech Stack
- **Runtime/Server**: Bun with Bun.serve for the backend HTTP server
- **Frontend**: HTML, vanilla JS, TailwindCSS v4, served by Bun and accessed via browser
- **Database**: SQLite (persistent local storage)
- **Testing**: Bun's built-in test runner for unit tests; Playwright for UI tests
- **Web scraping**: Playwright for scraping live prices and currency rates
- **Target display**: Desktop browser, designed for 1920x1080 monitor at ~80% viewport (effective ~1536x864)
- **Internet**: Required (for price/currency scraping)

## Security

- **Startup passphrase**: On first run, the user sets a passphrase. The app stores a bcrypt/argon2 hash in `.env` as `APP_PASSPHRASE_HASH`. On every subsequent launch, the app presents a passphrase prompt and verifies against the hash before serving any UI pages or data API routes.
- **Unprotected routes**: Scraper endpoints (price fetching, currency rate fetching) are NOT behind the passphrase gate. Future versions will run these on a cron schedule without user interaction, so they must be accessible without authentication.
- **`.env` file**: Stored in the project root, gitignored. Contains `APP_PASSPHRASE_HASH` and any future secrets.
- **No session timeout** for v0.1.0 — once unlocked, the app stays unlocked until closed.
- **Future upgrades**: YubiKey HMAC-SHA1 challenge-response, SQLCipher database-at-rest encryption, cron-scheduled automated scraping.

## Project Structure
```
portfolio_60/
├── CLAUDE.md
├── .env                # APP_PASSPHRASE_HASH (gitignored)
├── .env.example        # Template showing required env vars
├── .gitignore
├── package.json
├── bunfig.toml
├── src/
│   ├── server/         # Bun.serve backend
│   │   ├── index.js    # Server entry point
│   │   ├── routes/     # API route handlers
│   │   ├── db/         # SQLite database layer
│   │   │   ├── schema.sql
│   │   │   ├── seed.sql       # Hard-coded investment_types inserts
│   │   │   └── connection.js
│   │   └── scrapers/   # Playwright-based price/currency scrapers
│   ├── ui/             # Frontend served by Bun
│   │   ├── index.html
│   │   ├── css/
│   │   ├── js/
│   │   └── pages/      # Page-specific HTML/JS
│   └── shared/         # Constants and helpers shared between server and UI
├── tests/
│   ├── unit/           # Bun test runner
│   └── e2e/            # Playwright UI tests
├── data/               # SQLite database file location (gitignored)
└── backups/            # One-click backup destination (gitignored)
```

## Database Schema (v0.1.0)

SQLite with ISO-8601 date format (`YYYY-MM-DD`) for all date fields.

### users
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PRIMARY KEY AUTOINCREMENT | |
| initials | TEXT(5) NOT NULL | |
| first_name | TEXT(30) NOT NULL | |
| last_name | TEXT(30) NOT NULL | |
| ni_number | TEXT(9) | National Insurance number |
| utr | TEXT(15) | Unique Taxpayer Reference |
| provider | TEXT(5) NOT NULL | Abbreviation code e.g. "ii", "hl" |
| trading_ref | TEXT(15) | Trading account reference |
| isa_ref | TEXT(15) | ISA account reference |
| sipp_ref | TEXT(15) | SIPP account reference |

Each user has one provider with up to three account types (trading, ISA, SIPP) at that provider.

### investment_types
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PRIMARY KEY AUTOINCREMENT | |
| short_description | TEXT(8) NOT NULL | e.g. "SHARE" |
| description | TEXT(30) NOT NULL | e.g. "Shares" |
| usage_notes | TEXT(240) | |

Hard-coded seed data (no CRUD UI):
- shares
- mutual_funds
- investment_trusts
- savings_accounts
- other

### investments
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PRIMARY KEY AUTOINCREMENT | |
| currencies_id | INTEGER NOT NULL | FK to currencies |
| investment_type_id | INTEGER NOT NULL | FK to investment_types |
| description | TEXT(60) NOT NULL | |
| investment_url | TEXT(255) | Public web page URL for price scraping |
| selector | TEXT(120) | CSS selector for price element on that page |

### currencies
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PRIMARY KEY AUTOINCREMENT | |
| code | TEXT(3) NOT NULL UNIQUE | e.g. "GBP", "USD" |
| description | TEXT(30) NOT NULL | |

### currency_rates
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PRIMARY KEY AUTOINCREMENT | |
| currencies_id | INTEGER NOT NULL | FK to currencies |
| rate_date | TEXT NOT NULL | ISO-8601 date (YYYY-MM-DD) |
| rate | INTEGER NOT NULL | Exchange rate to GBP × 10000 (e.g. 1.2543 stored as 12543) |

Rate is stored as integer-scaled value (multiplied by 10000) for financial precision. All application code must scale on read and write.

### global_events
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PRIMARY KEY AUTOINCREMENT | |
| event_date | TEXT NOT NULL | ISO-8601 date (YYYY-MM-DD) |
| description | TEXT(255) NOT NULL | |

### accounts
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PRIMARY KEY AUTOINCREMENT | |
| user_id | INTEGER NOT NULL | FK to users |
| account_type | TEXT NOT NULL | CHECK('trading', 'isa', 'sipp') |
| account_ref | TEXT NOT NULL | Max 15 chars |
| cash_balance | INTEGER NOT NULL DEFAULT 0 | GBP × 10000 |
| warn_cash | INTEGER NOT NULL DEFAULT 0 | Warning threshold × 10000 |

Each user may have up to one account per type (UNIQUE on user_id + account_type).

### holdings
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PRIMARY KEY AUTOINCREMENT | |
| account_id | INTEGER NOT NULL | FK to accounts |
| investment_id | INTEGER NOT NULL | FK to investments |
| quantity | INTEGER NOT NULL DEFAULT 0 | Quantity × 10000 |
| average_cost | INTEGER NOT NULL DEFAULT 0 | Average cost price × 10000 |

One holding per investment per account (UNIQUE on account_id + investment_id).

### cash_transactions (schema only — no UI yet)
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PRIMARY KEY AUTOINCREMENT | |
| account_id | INTEGER NOT NULL | FK to accounts |
| transaction_type | TEXT NOT NULL | CHECK('deposit', 'withdrawal', 'drawdown', 'adjustment') |
| transaction_date | TEXT NOT NULL | ISO-8601 date |
| amount | INTEGER NOT NULL | Amount × 10000 |
| notes | TEXT | Max 255 chars |

### holding_movements (schema only — no UI yet)
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PRIMARY KEY AUTOINCREMENT | |
| holding_id | INTEGER NOT NULL | FK to holdings |
| movement_type | TEXT NOT NULL | CHECK('buy', 'sell', 'adjustment') |
| movement_date | TEXT NOT NULL | ISO-8601 date |
| quantity | INTEGER NOT NULL | Quantity × 10000 |
| movement_value | INTEGER NOT NULL | Value × 10000 |
| notes | TEXT | Max 255 chars |

### Database Constraints and Indexes

**Foreign keys** (enforced via `PRAGMA foreign_keys = ON`):
- `investments.currencies_id` → `currencies.id`
- `investments.investment_type_id` → `investment_types.id`
- `currency_rates.currencies_id` → `currencies.id`
- `accounts.user_id` → `users.id`
- `holdings.account_id` → `accounts.id`
- `holdings.investment_id` → `investments.id`
- `cash_transactions.account_id` → `accounts.id`
- `holding_movements.holding_id` → `holdings.id`

**Indexes** (add as data grows; included in schema from day 1 where the cost is negligible):
- `idx_currency_rates_lookup` ON `currency_rates(currencies_id, rate_date DESC)` — fast latest-rate lookup
- `idx_investments_type` ON `investments(investment_type_id)` — filter by type
- `idx_investments_currency` ON `investments(currencies_id)` — filter by currency
- `idx_global_events_date` ON `global_events(event_date DESC)` — chronological listing
- `idx_accounts_user` ON `accounts(user_id)` — list accounts per user
- `idx_holdings_account` ON `holdings(account_id)` — list holdings per account
- `idx_cash_transactions_account` ON `cash_transactions(account_id, transaction_date DESC)` — list transactions per account
- `idx_holding_movements_holding` ON `holding_movements(holding_id, movement_date DESC)` — list movements per holding

**Unique constraints:**
- `currencies.code` — already marked UNIQUE
- `currency_rates(currencies_id, rate_date)` — one rate per currency per day. If a rate is fetched again on the same day, the existing row is overwritten (INSERT OR REPLACE) with the latest value.
- `accounts(user_id, account_type)` — one account per type per user
- `holdings(account_id, investment_id)` — one holding per investment per account

**Overwrite behaviour**: Both currency rates and scraped prices use INSERT OR REPLACE. A user may trigger valuations multiple times per day; each run overwrites the previous values for that day with the latest data.

## Development Milestones (v0.1.0)

1. Project scaffolding: Bun project, TailwindCSS v4 setup
2. Bun.serve server with static file serving for the frontend
3. Security: .env setup, passphrase set/verify flow, protect UI/data routes (scraper routes unprotected)
4. SQLite database: check existence, prompt user, create tables + indexes, seed investment_types
5. Confirmation message to user that tables were created
-- **PAUSE: Manual testing** — Verify server starts, passphrase flow works, database creates correctly --
6. UI: Add/amend/delete **users**
-- **PAUSE: Manual testing** — Verify user CRUD operations, form validation, table display --
7. UI: Add/amend/delete **investments**
-- **PAUSE: Manual testing** — Verify investment CRUD, foreign key dropdowns for currency/type --
8. UI: Add/amend/delete **currencies**
9. UI: Add/amend/delete **global events**
-- **PAUSE: Manual testing** — Verify currencies and global events CRUD, all tables working together --
10. Scraper: Fetch today's currency exchange rates (to GBP) via Playwright
-- **PAUSE: Manual testing** — Verify currency rates fetched and stored, INSERT OR REPLACE behaviour --
11. Scraper: Fetch current price for each investment row using its URL + CSS selector. A price scrape always fetches currency rates first so both are contemporaneous.
-- **PAUSE: Manual testing** — Verify price scraping with real URLs/selectors, currency rates also refreshed, error handling --
12. One-click database backup and one-click restore
-- **PAUSE: Manual testing** — Verify backup creates timestamped file, restore overwrites DB, full end-to-end walkthrough --

## Development Milestones (v0.6.0)

13. Database: Add accounts, holdings, cash_transactions, holding_movements tables (Migration 10). Auto-migrate user refs to accounts rows.
14. API: CRUD routes for accounts (`/api/users/:userId/accounts`, `/api/accounts/:id`) and holdings (`/api/accounts/:accountId/holdings`, `/api/holdings/:id`)
15. UI: Portfolio page with account setup view (add/edit/delete accounts per user) and holdings setup view (add/edit/delete holdings per account with searchable investment dropdown, avg cost price / book cost value input)
-- **PAUSE: Manual testing** — Verify account and holding CRUD, book cost auto-calculation, investment search --
16. API: Portfolio summary service (`/api/portfolio/summary`, `/api/portfolio/summary/:userId`) computing valuations with latest prices, currency conversion to GBP, cash warnings, and aggregated totals
17. UI: Summary Valuation report (default landing view) with per-user summary table, drill-down to holdings detail with price, rate, local/GBP values
-- **PAUSE: Manual testing** — Verify summary report accuracy, currency conversion, drill-down, tab switching --

## Coding Conventions

- **Language**: Vanilla JavaScript (latest ES features) throughout — no TypeScript. Use JSDoc comments on all functions, including `@param`, `@returns`, and `@description` tags.
- **Code clarity**: Favour easy-to-understand code over concise or clever code. The target maintainers will have 2-3 years experience with JS/HTML/CSS. Write code and comments with that audience in mind. If a choice exists between a clever one-liner and a clear multi-line version, choose the clear version.
- **API style**: REST-like JSON API served by Bun.serve, consumed by frontend fetch calls.
- **SQL**: Raw SQL via bun:sqlite (no ORM). Parameterised queries for all user input.
- **Error handling**: Return structured JSON errors from API `{ error: string, detail?: string }`
- **Naming**: snake_case for database columns, camelCase for JS variables and functions, kebab-case for file names.
- **Tests**: Write unit tests alongside implementation. Tests are the acceptance criteria. Run with `bun test`.
- **UI pattern**: Server-rendered HTML pages with progressive enhancement via vanilla JS. No SPA framework.
- **CSS**: TailwindCSS v4 utility classes. Minimal custom CSS.

## Ports

- **Application server**: Port 1420 (`src/shared/constants.js` → `SERVER_PORT`). Used by the user via browser.
- **Automated testing (Claude)**: Ports 1430+ (each test file uses a unique port). All test files must spawn the server with `env: { PORT: "<unique_port>" }` to avoid conflicts with the user's running application on port 1420 and with each other. The server reads the `PORT` environment variable and falls back to `SERVER_PORT` (1420) if not set. Current allocations: server.test.js=1430, auth-routes.test.js=1431, accounts-db.test.js=1440, holdings-db.test.js=1441, accounts-routes.test.js=1442, holdings-routes.test.js=1443, portfolio-routes.test.js=1444. New test files should increment from there.

## Commands
```bash
bun install          # Install dependencies
bun run dev          # Start Bun dev server (port 1420)
bun test             # Run unit tests
npx playwright test  # Run Playwright e2e/UI tests
```

## UI Style Guidelines

- **Target audience**: Users aged 50-85 with varying technical confidence. The interface must be straightforward, uncluttered, and self-explanatory.
- **Theme**: Light colour scheme only. No dark mode. Use a discreet, professional colour palette appropriate for a financial application — muted blues/greys, minimal use of bright colours. Reserve colour accents for actionable elements (buttons, links) and status indicators (success green, error red).
- **Typography**: Legible font sizes (minimum 16px body text). Clear hierarchy with headings, adequate line spacing.
- **Layout**: Single-column or simple two-column layouts. No dense dashboards. Generous whitespace and padding. Clear section boundaries.
- **Forms**: Large, clearly labelled input fields. Visible validation messages. Obvious submit/cancel buttons. Confirmation dialogs before destructive actions (delete).
- **Tables**: Zebra-striped rows for readability. Clear column headers. Adequate row height.
- **Language**: Use UK English spelling throughout (colour, favourites, organisation, etc.). Plain, non-technical language in user-facing labels and messages.
- **Navigation**: Simple top-level navigation bar. Active page clearly indicated. No nested menus or dropdowns for primary navigation.

## Key Design Decisions

- **Price scraping**: End users identify the CSS selector for the price element on a public web page using browser DevTools (Inspect Element) or the SelectorGadget Chrome extension (easier). They enter the URL and selector into the investments record. The scraper navigates to the URL and extracts the text content of the matched element.
- **Scraping coupling**: A price scrape always fetches currency rates first, so prices and exchange rates are contemporaneous (within minutes of each other). Currency rates can also be fetched independently.
- **Currency**: GBP is the base currency. All non-GBP investments are converted using the most recent rate in currency_rates.
- **Provider codes**: Short abbreviation codes (max 5 chars) for management companies. Common codes: `ii` (Interactive Investors), `hl` (Hargreaves Lansdown), `aj` (AJ Bell), etc.
- **Backup/Restore**: SQLite file copy to/from `backups/` directory with timestamped filenames.
- **App security**: A hashed passphrase stored in `.env` is checked on startup. The app will not serve any content until the correct passphrase is provided. Future versions may add YubiKey hardware binding and/or SQLCipher database encryption.

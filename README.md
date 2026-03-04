# Portfolio 60

A browser-based application for UK families to track investments across multiple people and account types.

## What it does

Portfolio 60 helps you manage a family investment portfolio covering shares, mutual funds, investment trusts, savings accounts and other instruments. All valuations are in GBP, with automatic currency conversion for foreign-currency investments.

**Key features:**

- Track investments across multiple family members and account types (Trading, ISA, SIPP)
- Automatic price fetching from FT Markets, Fidelity and custom web sources
- Currency exchange rates from the European Central Bank via the Frankfurter API
- Benchmark tracking (FTSE 100, S&P 500, etc.) for performance comparison
- Historical data backfill from Morningstar, Yahoo Finance and the Bank of England
- Portfolio valuation with drill-down to individual holdings per person and account
- Buy/sell transaction recording with automatic cash balance updates
- SIPP drawdown scheduling and tracking
- Scheduled price fetching on a configurable timetable
- One-click database backup and restore
- Built-in documentation system

**Who is it for?**

UK families managing their own investments across one or more providers. The interface is designed for users aged 50–85, with clear layouts, large text and straightforward navigation. This is a UK-only application due to the complexity of UK tax rules and account types.

## Getting started

1. Install [Bun](https://bun.sh) (the JavaScript runtime)
2. Clone this repository and install dependencies:
   ```bash
   git clone https://github.com/your-repo/portfolio-60.git
   cd portfolio-60
   bun install
   ```
3. Start the application:
   ```bash
   bun run dev
   ```
4. Open your browser at **http://localhost:1420**
5. On first run, you will be asked to set a passphrase to protect your data

Your database and settings are stored locally in `~/.config/portfolio_60/`.

---

## Technical summary

### Stack

| Layer | Technology |
|---|---|
| Runtime & server | Bun with Bun.serve |
| Frontend | HTML, vanilla JS, Lit web components |
| Styling | TailwindCSS v4 |
| Database | SQLite via bun:sqlite |
| Web scraping | Playwright (headless Chromium) |
| Testing | Bun test runner (unit), Playwright (e2e) |

### Architecture

- **Server**: Bun.serve HTTP server with a lightweight custom router. REST-like JSON API consumed by frontend fetch calls. No framework — raw request/response handling.
- **Frontend**: Server-rendered HTML pages with progressive enhancement via vanilla JavaScript. No SPA framework. Lit web components for reusable UI elements (navbar, footer).
- **Database**: SQLite with raw SQL (no ORM). Parameterised queries throughout. Financial values stored as integers scaled by 10,000 for precision. WAL mode enabled.
- **Scraping**: Playwright launches headless Chromium to visit public financial websites and extract prices via CSS selectors. Currency rates fetched via REST API (Frankfurter/ECB). Historical data from Morningstar API, Yahoo Finance and Bank of England CSV downloads.
- **Security**: Passphrase-protected on startup (bcrypt hash stored in `.env`). Scraper endpoints are unprotected to support future cron-scheduled operation.

### Project structure

```
src/
├── server/           # Bun.serve backend
│   ├── routes/       # API route handlers
│   ├── db/           # SQLite database layer (schema, seeds, queries)
│   ├── scrapers/     # Playwright price/currency/benchmark scrapers
│   └── services/     # Scheduled scraping, historic backfill, drawdowns
├── ui/               # Frontend served by Bun
│   ├── pages/        # HTML pages
│   ├── js/           # Page-specific JavaScript
│   └── css/          # TailwindCSS input/output
└── shared/           # Constants shared between server and UI
tests/
├── unit/             # Bun test runner
└── e2e/              # Playwright UI tests
docs/                 # Built-in user documentation (markdown)
```

### Commands

```bash
bun install           # Install dependencies
bun run dev           # Start dev server (port 1420)
bun test              # Run unit tests
bunx playwright test  # Run e2e tests
```

### Conventions

- Vanilla JavaScript throughout — no TypeScript
- JSDoc comments on all functions
- snake_case for database columns, camelCase for JS, kebab-case for filenames
- UK English spelling in all user-facing text

### Data storage

All data is stored locally in a SQLite database at `~/.config/portfolio_60/data/`. No cloud services, no external accounts required. Backups are saved to `~/.config/portfolio_60/backups/` as timestamped SQLite copies.

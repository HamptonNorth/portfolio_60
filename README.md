> **Beta** — Portfolio 60 is beta-quality until v1.0. The core functionality is stable from v0.1.4 onwards, but expect breaking changes between minor releases.

# Portfolio 60

A browser-based application for UK families to track investments across multiple people and account types. All valuations in GBP, with automatic currency conversion for foreign-currency holdings.

## Who is it for?

UK families managing their own investments across one or more providers (Interactive Investor, Hargreaves Lansdown, AJ Bell, etc.). The interface is designed with clear layouts, generous text sizes and straightforward navigation.

## Key features

- Track investments across multiple family members and account types (Trading, ISA, SIPP)
- Automatic price fetching via Morningstar, with currency rates from the Frankfurter/ECB API
- Benchmark tracking (FTSE 100, S&P 500, etc.) via Yahoo Finance
- Investment analysis — comparison tables, league tables, risk/return scatter plots, top/bottom performers
- Portfolio valuation with drill-down to individual holdings per person and account
- PDF reports — portfolio summaries, detailed valuations, performance charts, household assets
- Buy/sell transaction recording with automatic cash balance updates
- SIPP drawdown scheduling and tracking
- Track other assets (pensions, property, savings) alongside investments
- Scheduled price fetching on a configurable timetable
- One-click database backup and restore
- Built-in documentation system and embedded spreadsheet lists
- Read-only demo mode for trying the application without installation

## Documentation

Two guides are included in the application's built-in Docs system (under **Docs > User Guide**) and in the `docs/guide/` directory:

- **[User Guide](docs/guide/user_guide_v0.1.7.md)** — a friendly walkthrough of every feature, written for non-technical users
- **[Technical Reference](docs/guide/technical_reference_v0.1.7.md)** — installation, JSON configuration, scheduling, embedding spreadsheets, and advanced settings

## Try the demo

A public demo is available at **[portfolio60.redmug.dev](https://portfolio60.redmug.dev)**. Enter **demo** as the passphrase to explore the application with pre-loaded sample data. The demo is read-only — you can browse everything but cannot modify data.

## Installation

### Prerequisites

- [Bun](https://bun.sh) v1.1 or later (the JavaScript runtime)

### From source

```bash
git clone https://github.com/rcollins/portfolio-60.git
cd portfolio-60
bun install
bun run dev
```

Open your browser at **http://localhost:1420**. On first run, set a passphrase to protect your data.

<!--### Compiled executable

Standalone compiled executables for Linux, macOS and Windows are available from the GitHub Releases page. These bundle the Bun runtime so no separate installation is needed:

```bash
# Example — Linux
chmod +x portfolio-60-linux
./portfolio-60-linux
```

Packaged installers (`.msi`, `.dmg`, `.deb`) may be made available in future if there is demand.-->

### Data storage

All data is stored locally on your computer at `~/.config/portfolio_60/`. No cloud services or external accounts are required. The only internet connections made are to fetch prices, exchange rates and benchmark values from public financial data APIs.

---

## Technical summary

### Stack

| Layer | Technology |
|---|---|
| Runtime & server | Bun with Bun.serve (port 1420) |
| Frontend | Server-rendered HTML, vanilla JS, Lit web components |
| Styling | TailwindCSS v4 |
| Database | SQLite via bun:sqlite (WAL mode) |
| Testing | Bun test runner (unit), Playwright (e2e) |
| Price sources | Morningstar API (investments), Yahoo Finance API (benchmarks), Frankfurter API (currency rates) |

### Architecture

- **Server**: Bun.serve HTTP server with a custom regex router. REST-like JSON API consumed by frontend fetch calls. No framework.
- **Frontend**: Server-rendered HTML with vanilla JavaScript. Lit web components for shared UI (navbar, footer). No SPA framework.
- **Database**: SQLite with raw parameterised SQL (no ORM). Financial values stored as integers scaled by 10,000. SCD2 temporal pattern on holdings for historic portfolio tracking.
- **Fetchers**: API clients for Morningstar, Yahoo Finance and Frankfurter/ECB. SSE streaming for real-time fetch progress in the UI.
- **Security**: Passphrase-protected (bcrypt hash in `.env`). Fetch endpoints are unprotected to support scheduled background fetching.

### Project structure

```
src/
├── server/           # Bun.serve backend
│   ├── routes/       # API route handlers
│   ├── db/           # SQLite database layer (schema, seeds, queries)
│   ├── fetchers/     # API clients (Morningstar, Yahoo, Frankfurter)
│   ├── services/     # Fetch orchestration, scheduling, analysis, drawdowns
│   └── reports/      # PDF generation
├── ui/               # Frontend served by Bun
│   ├── pages/        # HTML pages
│   ├── js/           # Page-specific JavaScript + Lit components
│   └── css/          # TailwindCSS input/output
└── shared/           # Constants shared between server and UI
tests/
├── unit/             # Bun test runner
└── e2e/              # Playwright UI tests
docs/                 # Built-in user documentation (Markdown)
```

### Commands

```bash
bun install              # Install dependencies
bun run dev              # Start dev server + Tailwind watcher (port 1420)
bun run dev:server       # Start server only
bun run dev:css          # Tailwind watcher only
bun test                 # Run unit tests
bunx playwright test     # Run e2e tests
```

### Conventions

- Vanilla JavaScript throughout — no TypeScript
- JSDoc comments on all functions
- snake_case for database columns, camelCase for JS, kebab-case for filenames
- UK English spelling in all user-facing text

---

## Licence

Portfolio 60 is released under the [MIT License](LICENSE).

## Disclaimer

Portfolio 60 is a personal portfolio tracker provided for informational purposes only. It does not constitute financial advice, nor is it a recommendation to buy, sell or hold any investment. The authors accept no responsibility or liability for any investment decisions made using this software, or for any financial losses arising from its use. Always consult a qualified financial adviser before making investment decisions.

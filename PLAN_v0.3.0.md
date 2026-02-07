# Historic Data Backfill — Implementation Plan (Phased)

## Context

The app currently holds only 2 days of price/rate/benchmark data. Future reporting (e.g. "how has my portfolio performed vs Vanguard LS 80% over 24 months?") requires historic data going back ~3 years. Three free, no-subscription, no-API-key data sources have been verified as working:

- **Morningstar UK API** — historic investment prices (funds, shares, trusts) via ISIN lookup
- **Bank of England IADB** — historic GBP exchange rates as CSV download
- **Yahoo Finance** (`yahoo-finance2` npm) — historic benchmark index/fund values

The goal is a one-off "Load Historic Data" feature the user triggers from the Fetching page. It auto-discovers identifiers from existing data (ISINs from URLs, currency codes, benchmark descriptions) and backfills weekly data for ~3 years into the existing `prices`, `currency_rates`, and `benchmark_data` tables.

**No manual identifier entry.** The user should not need to know about Morningstar IDs or Yahoo tickers.

---

## Phase 1: DB migrations + Bank of England currency rate backfill

Simplest source — just CSV parsing via `fetch()`, no npm dependencies.

### Changes
- **`src/server/db/connection.js`** — Add Migration 6: `ALTER TABLE investments ADD COLUMN morningstar_id TEXT`. Add Migration 7: `ALTER TABLE benchmarks ADD COLUMN yahoo_ticker TEXT`.
- **`src/server/services/historic-backfill.js`** — New file. Implement `fetchBoeRateHistory(startDate, endDate)` which fetches CSV from BoE in 1-year chunks, parses dates from `DD Mon YYYY` to ISO-8601, and returns rates per currency per date. Hardcoded mapping: USD→XUDLUSS, EUR→XUDLERS, AUD→XUDLADS, CAD→XUDLCDS. Implement `backfillCurrencyRates(progressCallback)` which calls BoE fetch and uses existing `upsertRate()` / `scaleRate()` to INSERT OR REPLACE into `currency_rates`.
- **`src/server/routes/backfill-routes.js`** — New file. `GET /api/backfill/historic/currencies/stream` — SSE endpoint that runs currency backfill and streams progress.
- **`src/server/index.js`** — Register backfill route (unprotected, like scraper routes).

### PAUSE: Manual testing
- Start server, hit the SSE endpoint (or curl it)
- Verify currency_rates table has ~780 rows per non-GBP currency (3 years of weekday rates)
- Spot-check a few dates against BoE website
- Confirm existing rates (from today's live fetch) are not corrupted

---

## Phase 2: Morningstar investment price backfill

Most complex phase — ISIN extraction, Morningstar API lookup, price history fetch.

### Changes
- **`src/server/services/historic-backfill.js`** — Add:
  - `extractIsinFromUrl(url)` — regex to pull ISIN from Fidelity URLs (`/factsheet\/([A-Z]{2}[A-Z0-9]{9,10})/`). For LSE URLs, extract ticker (`/stock\/([A-Z]+)\//`).
  - `lookupMorningstarId(isin)` — calls Morningstar screener API with universes `FOGBR$$ALL|E0WWE$$ALL`, returns SecId. For LSE tickers, searches by name.
  - `fetchMorningstarHistory(morningstarId, universe, currency, startDate, endDate)` — fetches weekly prices from Morningstar timeseries API. Requests in the investment's own currency (not GBP-converted) so the app can do its own conversion.
  - `backfillInvestmentPrices(progressCallback)` — for each investment: extract ISIN → lookup Morningstar ID (cache in `investments.morningstar_id`) → fetch weekly history → `upsertPrice()` into `prices` table.
- **`src/server/routes/backfill-routes.js`** — Add `GET /api/backfill/historic/prices/stream` — SSE endpoint for price backfill with progress.

### PAUSE: Manual testing
- Hit the prices SSE endpoint
- Verify prices table has ~156 rows per investment (3 years weekly)
- Spot-check Fundsmith, a USD share (Amazon), and an LSE stock (PCT) against known historic values
- Confirm `investments.morningstar_id` is populated for all investments
- Confirm today's prices are not overwritten

---

## Phase 3: Yahoo Finance benchmark backfill

### Changes
- `bun add yahoo-finance2`
- **`src/server/services/historic-backfill.js`** — Add:
  - `YAHOO_TICKER_MAP` — hardcoded lookup: FTSE 100→`^FTSE`, FTSE 250→`^FTMC`, FTSE All Share→`^FTAS`, S&P 500→`^GSPC`, Nasdaq→`^IXIC`, Dow Jones→`^DJI`, MSCI World Index→`SWDA.L` (ETF proxy), Vanguard Life Strategy 80%→`0P0001824G.L`.
  - `fetchYahooBenchmarkHistory(yahooTicker, startDate, endDate)` — uses `yahoo-finance2` v3. Handles GBp vs GBP (divide by 100 when currency is `GBp`).
  - `backfillBenchmarkValues(progressCallback)` — for each benchmark: match description to `YAHOO_TICKER_MAP`, populate `benchmarks.yahoo_ticker` if NULL, fetch weekly history → `upsertBenchmarkData()`.
- **`src/server/routes/backfill-routes.js`** — Add `GET /api/backfill/historic/benchmarks/stream` — SSE endpoint for benchmark backfill.

### PAUSE: Manual testing
- Hit the benchmarks SSE endpoint
- Verify benchmark_data table has ~156 rows per benchmark
- Spot-check FTSE 100 and Vanguard LS 80% against known values
- Confirm `benchmarks.yahoo_ticker` is populated

---

## Phase 4: UI integration

Wire everything together with a single button on the Fetching page.

### Changes
- **`src/ui/pages/scraping.html`** — Add "Load Historic Data" section below "Fetch All" with button, progress area, results area.
- **`src/ui/js/scraping.js`** — Add:
  - Confirmation dialog via `showModal()` before starting
  - `runBackfill()` function that calls the three SSE endpoints in sequence (currencies → prices → benchmarks)
  - Progress display: "Fetching currency rates... done (780 rates)", "Fetching prices for Fundsmith... done (156 weeks)", etc.
  - Summary on completion: total counts for each data type
- **`src/server/routes/backfill-routes.js`** — Add `GET /api/backfill/historic/stream` — combined SSE endpoint that runs all three phases sequentially, streaming progress for each.

### PAUSE: Manual testing
- Navigate to Fetching page, click "Load Historic Data"
- Confirm dialog appears, click to proceed
- Watch progress stream through all three phases
- Verify final summary counts
- Click "Show Current" — should still show today's values
- Run `bun test` to confirm no regressions

---

## Key Files

| File | Phase | Change |
|---|---|---|
| `src/server/db/connection.js` | 1 | Migrations 6 & 7 (add columns) |
| `src/server/services/historic-backfill.js` | 1-3 | **New file** — backfill orchestrator, built incrementally |
| `src/server/routes/backfill-routes.js` | 1-4 | **New file** — API routes, built incrementally |
| `src/server/index.js` | 1 | Register backfill route |
| `package.json` | 3 | Add `yahoo-finance2` dependency |
| `src/ui/pages/scraping.html` | 4 | Add "Load Historic Data" section |
| `src/ui/js/scraping.js` | 4 | Add backfill button handler and SSE progress |

## Existing Code to Reuse

- `upsertPrice()` from `src/server/db/prices-db.js`
- `upsertBenchmarkData()` from `src/server/db/benchmark-data-db.js`
- `upsertRate()` and `scaleRate()` from `src/server/db/currency-rates-db.js`
- `CURRENCY_SCALE_FACTOR` from `src/shared/constants.js`
- `getDatabase()` from `src/server/db/connection.js`
- `Router` class from `src/server/router.js`
- `showModal()`, `apiRequest()` from `src/ui/js/app.js`

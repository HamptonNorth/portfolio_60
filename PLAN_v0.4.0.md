# v0.4.0 — Public ID + Scraper Testing — Implementation Plan

## Context

### Problem 1: Fragile price lookups

Investments currently store a `investment_url` and `selector` for price scraping. Users must manually find a price page URL and (for non-known-sites) a CSS selector. This is fragile — any website redesign breaks the selector, and there is no standardised way to construct the URL programmatically.

Mutual funds have **ISIN codes** (e.g. `GB00B4PQW151`) — globally unique 12-character identifiers per share class. Shares and investment trusts have **exchange:ticker codes** (e.g. `LSE:AZN`). Both can be used to construct reliable pricing URLs automatically.

### Problem 2: No safe way to test scraping

To test whether a new pricing source or selector works, the user must add a real investment record, test it, then delete it — polluting the live portfolio data. There is no sandbox for scraper experimentation.

### Solution

**Phase A**: Add a `public_id` column to `investments`. For mutual funds this stores the ISIN; for shares/investment trusts it stores `EXCHANGE:TICKER`. The app uses `public_id` to auto-generate pricing URLs (FT Markets for ISINs, Yahoo Finance or FT Markets for tickers), while retaining the existing `investment_url` + `selector` as a manual override.

**Phase B**: Add a `test_investments` table with its own `test_prices` table. A dedicated "Scraper Testing" page lets the user add test investments, scrape them individually or in bulk, and compare results across pricing sources — without affecting the real portfolio.

---

## Research Summary

### ISIN → Price (Mutual Funds)

**Best source: FT Markets** (markets.ft.com) — no login, no API key, ISIN goes directly in URL.

| Purpose | URL pattern |
|---|---|
| Current price | `https://markets.ft.com/data/funds/tearsheet/summary?s={ISIN}:{CURRENCY}` |
| Historical prices | `https://markets.ft.com/data/funds/tearsheet/historical?s={ISIN}:{CURRENCY}` |

- CSS selector: `span.mod-ui-data-list__value` (first match = current NAV)
- Requires Playwright (JS-rendered page)
- Precision: 2 decimal places
- Yahoo Finance and Google Finance do **not** accept ISINs
- Morningstar accepts ISINs via search but uses fragile undocumented APIs with rotating tokens

### Exchange:Ticker → Price (Shares & Investment Trusts)

Investment trusts trade on the LSE with regular tickers (e.g. `SMT`, `CTY`, `MNKS`) — identical to ordinary shares.

**Option A: FT Markets** (consistent with ISIN approach)
- URL: `https://markets.ft.com/data/equities/tearsheet/summary?s={TICKER}:{EXCHANGE}`
- Same selector as funds: `span.mod-ui-data-list__value`
- Requires Playwright
- Pro: single source for all investment types

**Option B: Yahoo Finance v8 JSON API** (no Playwright needed)
- URL: `https://query2.finance.yahoo.com/v8/finance/chart/{TICKER}.L?interval=1d&range=1d`
- Returns JSON — can use `fetch()` directly
- **Caveat**: Prices in GBX (pence) — must divide by 100 for GBP
- **Risk**: Unofficial/reverse-engineered endpoint

**Recommendation**: Use FT Markets as the primary auto-generated source for both ISINs and tickers. This gives a single consistent approach. The existing `investment_url` + `selector` override handles edge cases and alternative sources.

### Sources NOT suitable

| Source | Why not |
|---|---|
| Yahoo Finance | No ISIN support; GBX/GBP confusion; unofficial API |
| Google Finance | No ISIN support; heavy bot detection |
| Morningstar | Fragile APIs, rotating tokens |
| Trustnet | Unscrapeable heavy JS |
| Hargreaves Lansdown | No ISIN search; requires SEDOL |
| LSE website | No ISIN support; heavy bot detection; requires company slug in URL |

---

## Phase A: `public_id` Column + Auto-URL Generation

### A1. Database migration

**`src/server/db/connection.js`** — Add Migration 8:

```sql
ALTER TABLE investments ADD COLUMN public_id TEXT;
```

- `public_id` stores either an ISIN (e.g. `GB00B4PQW151`) or exchange:ticker (e.g. `LSE:AZN`)
- Nullable — not all investments have a public identifier (savings accounts, "other")
- No UNIQUE constraint — a user might track the same fund in different accounts (unlikely but possible)
- Max length enforced in validation: 20 characters

### A2. Public ID type detection

**`src/shared/public-id-utils.js`** — New shared utility file.

```javascript
/**
 * Detect whether a public_id is an ISIN or an exchange:ticker.
 * ISIN: exactly 12 chars, starts with 2 uppercase letters, rest alphanumeric.
 * Ticker: format EXCHANGE:TICKER (e.g. LSE:AZN, NYSE:AAPL).
 */
function detectPublicIdType(publicId)  // returns 'isin' | 'ticker' | null

/**
 * Validate a public_id string.
 * ISIN: 12 chars, /^[A-Z]{2}[A-Z0-9]{10}$/
 * Ticker: /^[A-Z]{1,10}:[A-Z0-9.]{1,10}$/
 */
function validatePublicId(publicId)  // returns { valid, type, error? }

/**
 * Build the FT Markets URL for a given public_id and currency code.
 * ISIN → https://markets.ft.com/data/funds/tearsheet/summary?s={ISIN}:{CURRENCY}
 * Ticker → https://markets.ft.com/data/equities/tearsheet/summary?s={TICKER}:{EXCHANGE}
 *   (FT uses TICKER:EXCHANGE format, e.g. AZN:LSE — reversed from our LSE:AZN storage)
 */
function buildFtMarketsUrl(publicId, currencyCode)  // returns URL string or null

/**
 * Get the CSS selector for FT Markets pages.
 */
function getFtMarketsSelector()  // returns 'span.mod-ui-data-list__value'
```

### A3. Scraper integration

**`src/server/scrapers/price-scraper.js`** — Modify `scrapeSingleInvestmentPrice()`:

1. If `investment_url` is set → use it (existing behaviour, manual override wins)
2. Else if `public_id` is set → call `buildFtMarketsUrl(public_id, currency_code)` to generate URL, use `getFtMarketsSelector()` as selector
3. Else → skip (no URL available)

Update `getScrapeableInvestments()` to also include investments that have a `public_id` but no `investment_url`.

### A4. Config: add FT Markets as a known site

**`src/shared/config.json`** — Add two new entries to `scraperSites.sites`:

```json
{
  "pattern": "markets.ft.com/data/funds",
  "name": "FT Markets (Funds)",
  "selector": "span.mod-ui-data-list__value",
  "waitStrategy": "networkidle",
  "notes": "Fund/ETF tearsheet pages. Auto-used when public_id contains an ISIN."
},
{
  "pattern": "markets.ft.com/data/equities",
  "name": "FT Markets (Equities)",
  "selector": "span.mod-ui-data-list__value",
  "waitStrategy": "networkidle",
  "notes": "Share/investment trust tearsheet pages. Auto-used when public_id contains a ticker."
}
```

### A5. Investment form updates

**`src/ui/pages/investments.html`** — Add a `public_id` field to both the add/edit form and the read-only view modal:

- Position: after the Currency dropdown, before Price Page URL
- Label: "Public ID"
- Placeholder: "ISIN (e.g. GB00B4PQW151) or Exchange:Ticker (e.g. LSE:AZN)"
- Help text: "For mutual funds, enter the ISIN code. For shares or investment trusts, enter EXCHANGE:TICKER (e.g. LSE:AZN). Leave blank for savings accounts."
- Max length: 20
- Optional field
- On input (debounced 500ms): validate format, show green/amber status below field indicating detected type

**`src/ui/js/investments.js`** — Update form handling:

- Add `public_id` to form data collection in `handleFormSubmit()`
- Add `public_id` to the read-only view modal
- Add real-time validation on input: detect ISIN vs ticker format, show feedback
- When `public_id` is set and `investment_url` is empty: show info message "Price URL will be generated automatically from FT Markets"
- When both `public_id` and `investment_url` are set: show info message "Manual URL takes priority over auto-generated URL"

### A6. Investment table display

**`src/ui/js/investments.js`** — Update `loadInvestments()` table:

- Add "Public ID" column between "Currency" and "URL"
- Show the raw `public_id` value (or "—" if empty)
- Table rows with `public_id` but no `investment_url` should show the "Test" button (since they're now scrapeable)

### A7. API and validation updates

**`src/server/routes/investments-routes.js`** — Include `public_id` in POST/PUT request body handling.

**`src/server/db/investments-db.js`** — Update all queries:

- `getAllInvestments()` — add `i.public_id` to SELECT
- `getInvestmentById()` — add `i.public_id` to SELECT
- `createInvestment()` — add `public_id` to INSERT
- `updateInvestment()` — add `public_id` to UPDATE

**`src/shared/validation.js`** (or equivalent) — Add `public_id` validation:

- Optional field
- If provided: max 20 chars, must match ISIN or ticker format
- Use `validatePublicId()` from `public-id-utils.js`

### A8. Historic backfill integration

**`src/server/services/historic-backfill.js`** — Update `backfillInvestmentPrices()`:

Currently the backfill extracts ISINs from Fidelity URLs via `extractIsinFromUrl()`. With the new `public_id` field:

1. If `public_id` is an ISIN → use it directly for Morningstar lookup (skip URL parsing)
2. If `public_id` is a ticker → use Yahoo Finance for historic data (yahoo-finance2, same as benchmarks)
3. Else → fall back to existing URL-based ISIN/ticker extraction

Update `testBackfillInvestment()` and `loadBackfillInvestment()` similarly.

### A9. Unit tests

**`tests/unit/public-id-utils.test.js`** — New test file:

- `detectPublicIdType()`: ISIN detection (GB, IE, LU prefixes), ticker detection (LSE:AZN, NYSE:AAPL), null/empty/invalid
- `validatePublicId()`: valid ISINs, valid tickers, too long, invalid formats
- `buildFtMarketsUrl()`: ISIN → funds URL, ticker → equities URL, null input

### PAUSE: Manual testing
- Add an existing investment's ISIN (e.g. Fundsmith `GB00B41YBW71`) via the form
- Clear its `investment_url` — verify "Test" button still appears
- Click "Test" — verify it scrapes from FT Markets using the auto-generated URL
- Add a share with ticker (e.g. `LSE:AZN`) — verify auto-generated URL works
- Verify investments with manual `investment_url` still use the manual URL
- Verify "Fetch All" includes public_id-based investments
- Run historic backfill — verify ISIN-based investments use `public_id` directly
- Run `bun test`

---

## Phase B: Scraper Testing Sandbox

### Feature flag

The Scraper Testing feature is controlled by `config.json` → `scraperTesting.enabled` (default: `false`). When disabled:

- The "Scraper Testing" nav link is **hidden** from the Set Up dropdown
- Direct navigation to `/pages/scraper-testing.html` shows a "Feature not enabled" message
- API routes under `/api/test-investments` and `/api/scraper/test-investments` return `403 { error: "Scraper testing is not enabled", detail: "Set scraperTesting.enabled to true in Edit Settings to use this feature." }`
- The database tables (`test_investments`, `test_prices`) are still created by migrations regardless — the flag only controls UI visibility and API access

To enable: open the gear icon → Edit Settings → set `"scraperTesting": { "enabled": true }` → Save. The nav link appears immediately on next page load.

### B1. Database tables

**`src/server/db/schema.sql`** — Add (and migration in `connection.js`):

```sql
-- Test investments: sandbox for testing scraper configurations
CREATE TABLE IF NOT EXISTS test_investments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    currencies_id INTEGER NOT NULL,
    investment_type_id INTEGER NOT NULL,
    description TEXT NOT NULL CHECK(length(description) <= 60),
    public_id TEXT CHECK(public_id IS NULL OR length(public_id) <= 20),
    investment_url TEXT CHECK(investment_url IS NULL OR length(investment_url) <= 255),
    selector TEXT CHECK(selector IS NULL OR length(selector) <= 255),
    source_site TEXT CHECK(source_site IS NULL OR length(source_site) <= 60),
    notes TEXT CHECK(notes IS NULL OR length(notes) <= 255),
    last_test_date TEXT,
    last_test_success INTEGER,
    last_test_price TEXT,
    FOREIGN KEY (currencies_id) REFERENCES currencies(id),
    FOREIGN KEY (investment_type_id) REFERENCES investment_types(id)
);

-- Test prices: scraped prices from test investments (kept for comparison)
CREATE TABLE IF NOT EXISTS test_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    test_investment_id INTEGER NOT NULL,
    price_date TEXT NOT NULL,
    price_time TEXT NOT NULL DEFAULT '00:00:00',
    price INTEGER NOT NULL,
    FOREIGN KEY (test_investment_id) REFERENCES test_investments(id) ON DELETE CASCADE,
    UNIQUE(test_investment_id, price_date)
);

CREATE INDEX IF NOT EXISTS idx_test_prices_lookup ON test_prices(test_investment_id, price_date DESC);
```

Key differences from `investments`:
- `source_site` — tags which scraperSite config this tests (e.g. "Hargreaves Lansdown (Funds)")
- `notes` — free text for test context (e.g. "Testing HL selector after Jan 2026 redesign")
- `last_test_date`, `last_test_success`, `last_test_price` — quick-glance status without querying test_prices
- `ON DELETE CASCADE` on test_prices FK — deleting a test investment removes its price history
- `public_id` — same as investments, supports auto-URL generation

### B2. Database layer

**`src/server/db/test-investments-db.js`** — New file:

- `getAllTestInvestments()` — SELECT with JOIN to currencies and investment_types, ordered by description
- `getTestInvestmentById(id)` — single record with joins
- `createTestInvestment(data)` — INSERT
- `updateTestInvestment(id, data)` — UPDATE
- `deleteTestInvestment(id)` — DELETE (cascade removes test_prices)
- `updateTestResult(id, date, success, price)` — updates the last_test_* fields

**`src/server/db/test-prices-db.js`** — New file:

- `upsertTestPrice(testInvestmentId, date, time, priceMinorUnit)` — INSERT OR REPLACE
- `getTestPriceHistory(testInvestmentId, limit)` — SELECT ordered by date DESC
- `getLatestTestPrice(testInvestmentId)` — most recent price

### B3. API routes

**`src/server/routes/test-investments-routes.js`** — New file.

All routes check `config.scraperTesting.enabled` at the start. If `false`, return `403 { error: "Scraper testing is not enabled", detail: "Set scraperTesting.enabled to true in Edit Settings to use this feature." }`.

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/test-investments` | GET | List all test investments |
| `/api/test-investments/:id` | GET | Get single test investment |
| `/api/test-investments` | POST | Create test investment |
| `/api/test-investments/:id` | PUT | Update test investment |
| `/api/test-investments/:id` | DELETE | Delete test investment (cascades) |
| `/api/test-investments/:id/prices` | GET | Get price history for a test investment |

**`src/server/routes/scraper-routes.js`** — Add test scraping endpoints (also gated by `scraperTesting.enabled`):

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/scraper/test-investments/:id` | POST | Scrape single test investment, store in test_prices |
| `/api/scraper/test-investments/all/stream` | GET | SSE stream — scrape all test investments |

These use the same `scrapeSingleInvestmentPrice()` function from the price scraper but write to `test_prices` and update `test_investments.last_test_*` instead of the real `prices` table.

### B4. Scraper integration

**`src/server/scrapers/price-scraper.js`** — Add:

- `scrapeTestInvestment(testInvestment, browser, options)` — wraps `scrapeSingleInvestmentPrice()` but:
  - Writes to `test_prices` via `upsertTestPrice()` instead of `prices`
  - Updates `test_investments.last_test_*` fields
  - Records in `scraping_history` with `scrape_type='test_investment'`
- `scrapeAllTestInvestments(onProgress, options)` — batch version with shared browser, delays, SSE progress

Update `scraping_history` CHECK constraint to allow `'test_investment'` as a new `scrape_type`:

```sql
-- Migration: ALTER scraping_history check constraint
-- SQLite doesn't support ALTER CHECK, so we recreate the check via application-level validation
-- or accept that SQLite CHECK constraints are not enforced on ALTER. Since the table already
-- exists, we handle this in the INSERT code by allowing the new value.
```

Note: SQLite CHECK constraints on existing tables cannot be altered. The existing CHECK `scrape_type IN ('currency', 'investment', 'benchmark')` will reject `'test_investment'`. Options:
1. **Recreate the table** (complex, risky for existing data)
2. **Use `scrape_type='investment'` with a flag** (confuses the history)
3. **Don't log test scrapes to scraping_history** (simplest — test scrapes have their own `last_test_*` tracking)

**Recommendation**: Option 3 — test scrapes do not write to `scraping_history`. The `test_investments.last_test_*` fields and `test_prices` table provide sufficient tracking. This avoids schema migration complexity and keeps test data cleanly separated.

### B5. UI — Scraper Testing page

**`src/ui/pages/scraper-testing.html`** — New page.

**Feature gate on page load**: The page JS checks `GET /api/config/scraper-testing-enabled` on load. If `false`, the page shows an info panel: "Scraper Testing is not enabled. To enable, open the gear icon → Edit Settings → set `scraperTesting.enabled` to `true` → Save." All CRUD/test controls are hidden.

**Page layout (when enabled)**:

```
┌─────────────────────────────────────────────────────────┐
│ Scraper Testing                        [Add Test]       │
│                                        [Test All]       │
├─────────────────────────────────────────────────────────┤
│ Description  │ Type   │ Source Site │ Public ID │ Status│
│──────────────┼────────┼────────────┼───────────┼───────│
│ Jupiter India│ Mutual │ FT Markets │ GB00B4T.. │  ✓    │
│ Jupiter India│ Mutual │ HL (Funds) │           │  ✓    │
│ AstraZeneca  │ Share  │ FT Markets │ LSE:AZN   │  ✓    │
│ AstraZeneca  │ Share  │ LSE (Stock)│           │  ✗    │
│ Scot Mortgage│ Inv Tr │ Yahoo API  │ LSE:SMT   │  —    │
├─────────────────────────────────────────────────────────┤
│ [Test]  [History]  [Edit]  [Delete]      per row        │
└─────────────────────────────────────────────────────────┘
```

**Table columns**:
- Description — investment name
- Type — investment type (from investment_types)
- Source Site — which pricing source this tests
- Public ID — ISIN or ticker (if set)
- URL — truncated (if set)
- Last Test — date of last test, or "—"
- Status — green tick (success), red cross (failure), dash (never tested)
- Price — last scraped price, or "—"
- Actions — Test, History, Edit, Delete buttons

**"Add Test" form** — modal, same fields as investment form plus:
- `source_site` — dropdown populated from `config.json` scraperSites names, plus "FT Markets (Funds)", "FT Markets (Equities)", "Custom"
- `notes` — textarea for test context
- When `source_site` is selected: auto-fills `selector` from config (same as known-site logic on investments page)
- When `public_id` is entered with a source_site of "FT Markets (Funds)" or "FT Markets (Equities)": auto-generates `investment_url` preview

**"Test" button (per row)** — scrapes this single test investment:
- Shows inline spinner on the row
- On completion: updates Status, Price, Last Test columns in-place
- On failure: shows error tooltip on Status icon

**"Test All" button** — scrapes all test investments sequentially via SSE:
- Disables all buttons during run
- Updates each row in-place as results arrive
- Shows summary bar at top on completion ("8/10 succeeded, 2 failed")

**"History" button (per row)** — expands an inline detail panel below the row:
- Shows last 10 prices from `test_prices` in a mini-table (date, time, price)
- Collapsible — click again to hide

### B6. UI JavaScript

**`src/ui/js/scraper-testing.js`** — New file:

- CRUD operations mirroring `investments.js` patterns
- `testSingleInvestment(id)` — POST to `/api/scraper/test-investments/:id`, update row
- `testAllInvestments()` — SSE from `/api/scraper/test-investments/all/stream`, update rows progressively
- `toggleHistory(id)` — GET `/api/test-investments/:id/prices`, show/hide detail panel
- `populateSourceSiteDropdown()` — loads from config.json scraperSites + FT Markets entries
- Real-time `public_id` validation (same as investments page)

### B7. Navigation update (conditional)

**All HTML pages** (nav bar) — Add a placeholder `<a>` for "Scraper Testing" in the Set Up dropdown, **hidden by default**:

```html
<a href="/pages/scraper-testing.html" id="nav-scraper-testing" class="hidden block px-4 py-2 hover:bg-brand-50 transition-colors" data-nav="scraper-testing">Scraper Testing</a>
```

Position: after "Fetching", before "Backup".

**`src/ui/js/app.js`** — On page load, fetch `GET /api/config/scraper-testing-enabled` (a lightweight endpoint returning `{ enabled: boolean }`). If `true`, remove the `hidden` class from `#nav-scraper-testing`. This keeps the nav clean for typical users while making the link appear instantly when the feature is enabled via Edit Settings.

**`src/server/routes/config-routes.js`** — Add:

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/config/scraper-testing-enabled` | GET | Returns `{ enabled: boolean }` from config |

This endpoint is lightweight (no auth required, reads config only) so the nav can check it on every page load without performance impact.

### B8. Unit tests

**`tests/unit/test-investments-db.test.js`** — New test file:
- CRUD operations on test_investments
- CASCADE delete behaviour (deleting test_investment removes test_prices)
- `updateTestResult()` updates last_test_* fields

**`tests/unit/test-investments-routes.test.js`** — New test file:
- API endpoint testing (GET, POST, PUT, DELETE)
- Validation of source_site, notes fields

### PAUSE: Manual testing
- With `scraperTesting.enabled: false` (default):
  - Verify "Scraper Testing" does NOT appear in the Set Up nav dropdown
  - Navigate directly to `/pages/scraper-testing.html` — verify "not enabled" info message
  - Call `GET /api/test-investments` — verify 403 response
- Enable via gear icon → Edit Settings → set `scraperTesting.enabled` to `true` → Save
  - Verify "Scraper Testing" now appears in the Set Up nav dropdown
  - Navigate to Scraper Testing page — verify full UI loads
- Add test investments for the same fund across multiple sources (e.g. Jupiter India via FT Markets ISIN, via HL Funds URL, via Morningstar URL)
- Click "Test" on each — verify prices are scraped and stored in test_prices
- Click "Test All" — verify SSE streaming, progressive row updates
- Click "History" — verify price history panel
- Delete a test investment — verify test_prices cascade
- Verify real investments page is unaffected
- Disable the feature again — verify nav link disappears, page shows "not enabled"
- Run `bun test`

---

## Key Files Summary

| File | Phase | Change |
|---|---|---|
| `src/server/db/connection.js` | A1, B1 | Migrations 8 (public_id), 9-10 (test tables) |
| `src/server/db/schema.sql` | B1 | Add test_investments and test_prices tables |
| `src/shared/public-id-utils.js` | A2 | **New** — public_id detection, validation, URL building |
| `src/server/db/investments-db.js` | A7 | Add public_id to all queries |
| `src/server/routes/investments-routes.js` | A7 | Include public_id in request handling |
| `src/shared/validation.js` | A7 | Add public_id validation |
| `src/shared/config.json` | A4 | Add FT Markets known sites |
| `src/server/scrapers/price-scraper.js` | A3, B4 | Auto-URL from public_id; test investment scraping |
| `src/server/services/historic-backfill.js` | A8 | Use public_id for ISIN/ticker lookup |
| `src/ui/pages/investments.html` | A5 | Add public_id field to form and view |
| `src/ui/js/investments.js` | A5, A6 | Form handling, table column, validation |
| `src/server/db/test-investments-db.js` | B2 | **New** — test investments CRUD |
| `src/server/db/test-prices-db.js` | B2 | **New** — test prices storage |
| `src/server/routes/test-investments-routes.js` | B3 | **New** — test investments API |
| `src/server/routes/scraper-routes.js` | B3 | Add test scraping endpoints (gated) |
| `src/server/routes/config-routes.js` | B7 | Add `/api/config/scraper-testing-enabled` endpoint |
| `src/ui/pages/scraper-testing.html` | B5 | **New** — Scraper Testing page (with feature gate) |
| `src/ui/js/scraper-testing.js` | B6 | **New** — Scraper Testing page logic (checks enabled) |
| `src/ui/js/app.js` | B7 | Check feature flag, conditionally show nav link |
| All HTML pages (nav) | B7 | Add hidden Scraper Testing link to nav dropdown |
| `tests/unit/public-id-utils.test.js` | A9 | **New** — public_id utility tests |
| `tests/unit/test-investments-db.test.js` | B8 | **New** — test investments DB tests |
| `tests/unit/test-investments-routes.test.js` | B8 | **New** — test investments route tests |

## Existing Code to Reuse

- `scrapeSingleInvestmentPrice()` from `src/server/scrapers/price-scraper.js` — core scraping logic
- `getSelector()` from `src/server/config.js` — known site matching
- `upsertPrice()` from `src/server/db/prices-db.js` — pattern for `upsertTestPrice()`
- `getAllInvestments()` patterns from `src/server/db/investments-db.js` — query structure
- `investments.js` UI patterns — form handling, table rendering, modal management
- `scraping.js` SSE patterns — streaming progress for "Test All"
- `validateInvestment()` — extend for public_id and test investment validation
- `Router` class from `src/server/router.js` — route registration
- `showModal()`, `apiRequest()` from `src/ui/js/app.js` — shared UI utilities

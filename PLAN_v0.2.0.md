# Portfolio 60 — v0.2.0 Implementation Plan

## Overview

Version 0.2.0 adds benchmark tracking, historical price/benchmark data storage, scheduled automated scraping with retry logic, and a settings UI for configuration management.

---

## Phase 1: Benchmarks

### 1.1 Database Schema — Benchmarks Table

Add new table to `src/server/db/schema.sql`:

```sql
-- Benchmarks: indices and reference prices for performance comparison
CREATE TABLE IF NOT EXISTS benchmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    currencies_id INTEGER NOT NULL,
    benchmark_type TEXT NOT NULL CHECK(benchmark_type IN ('index', 'price')),
    description TEXT NOT NULL CHECK(length(description) <= 60),
    benchmark_url TEXT CHECK(benchmark_url IS NULL OR length(benchmark_url) <= 255),
    selector TEXT CHECK(selector IS NULL OR length(selector) <= 255),
    FOREIGN KEY (currencies_id) REFERENCES currencies(id)
);

CREATE INDEX IF NOT EXISTS idx_benchmarks_type ON benchmarks(benchmark_type);
CREATE INDEX IF NOT EXISTS idx_benchmarks_currency ON benchmarks(currencies_id);
```

**Implementation notes:**
- Table creation uses `CREATE TABLE IF NOT EXISTS` — safe for existing databases
- On startup, database initialisation checks for table existence and creates if missing
- Existing data in other tables remains untouched

### 1.2 Benchmarks CRUD API

Create `src/server/routes/benchmarks.js` with REST endpoints:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/benchmarks` | List all benchmarks with currency details |
| GET | `/api/benchmarks/:id` | Get single benchmark |
| POST | `/api/benchmarks` | Create new benchmark |
| PUT | `/api/benchmarks/:id` | Update existing benchmark |
| DELETE | `/api/benchmarks/:id` | Delete benchmark |

**Validation rules:**
- `description` required, max 60 chars
- `benchmark_type` required, must be `index` or `price`
- `currencies_id` required, must reference valid currency
- When `benchmark_type = 'index'`, `currencies_id` must be GBP (enforced server-side)
- `benchmark_url` and `selector` optional, max 255 chars each

### 1.3 Benchmarks CRUD UI

Create `src/ui/pages/benchmarks.html` and `src/ui/js/benchmarks.js`:

- Page structure mirrors `investments.html`
- Table columns: Description, Type, Currency, URL (truncated), Actions
- Add/Edit form with fields:
  - Description (text, required)
  - Benchmark Type (dropdown: Index / Price, required)
  - Currency (dropdown, required) — **disabled and set to GBP when Type = Index**
  - Benchmark URL (textarea, optional)
  - CSS Selector (textarea, optional)
- Double-click row for read-only view panel
- Delete confirmation dialog
- Form validation with clear error messages

**UI behaviour:**
- When user selects Type = "Index", currency dropdown automatically selects GBP and becomes disabled
- When user selects Type = "Price", currency dropdown is enabled
- Server rejects any attempt to save an index with non-GBP currency

### 1.4 Navigation Update

Add "Benchmarks" link to navigation bar in all page templates, positioned after "Investments".

### 1.5 Unit Tests — Phase 1

Create `tests/unit/benchmarks.test.js`:
- CRUD operations (create, read, update, delete)
- Validation: reject missing required fields
- Validation: reject index with non-GBP currency
- Foreign key constraint: reject invalid currencies_id

---

**PAUSE: Manual Testing — Phase 1**

Verify:
- [ ] Benchmarks table created on fresh database
- [ ] Existing database upgraded without data loss
- [ ] Add benchmark (both index and price types)
- [ ] Currency dropdown disabled/GBP when Type = Index
- [ ] Edit benchmark, verify type/currency constraint
- [ ] Delete benchmark with confirmation
- [ ] Table displays correctly, navigation works

---

## Phase 2: Historical Data Storage

### 2.1 Database Schema — Prices Table

Add to `src/server/db/schema.sql`:

```sql
-- Prices: historical investment prices, stored as integer x 10000
CREATE TABLE IF NOT EXISTS prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    investment_id INTEGER NOT NULL,
    price_date TEXT NOT NULL,
    price INTEGER NOT NULL,
    FOREIGN KEY (investment_id) REFERENCES investments(id),
    UNIQUE(investment_id, price_date)
);

CREATE INDEX IF NOT EXISTS idx_prices_lookup ON prices(investment_id, price_date DESC);
```

**Storage format:** Price stored as INTEGER × 10000 (e.g., 123.4567 stored as 1234567). Same scaling as `currency_rates.rate`.

### 2.2 Database Schema — Benchmark Data Table

Add to `src/server/db/schema.sql`:

```sql
-- Benchmark data: historical benchmark values, stored as integer x 10000
CREATE TABLE IF NOT EXISTS benchmark_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    benchmark_id INTEGER NOT NULL,
    benchmark_date TEXT NOT NULL,
    value INTEGER NOT NULL,
    FOREIGN KEY (benchmark_id) REFERENCES benchmarks(id),
    UNIQUE(benchmark_id, benchmark_date)
);

CREATE INDEX IF NOT EXISTS idx_benchmark_data_lookup ON benchmark_data(benchmark_id, benchmark_date DESC);
```

### 2.3 Database Schema — Scraping History Table

Add to `src/server/db/schema.sql`:

```sql
-- Scraping history: log of all scrape attempts for monitoring
CREATE TABLE IF NOT EXISTS scraping_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scrape_type TEXT NOT NULL CHECK(scrape_type IN ('currency', 'investment', 'benchmark')),
    reference_id INTEGER NOT NULL,
    scrape_datetime TEXT NOT NULL,
    started_by INTEGER NOT NULL DEFAULT 0,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    success INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_scraping_history_datetime ON scraping_history(scrape_datetime DESC);
CREATE INDEX IF NOT EXISTS idx_scraping_history_type_ref ON scraping_history(scrape_type, reference_id);
```

**Column notes:**
- `scrape_type`: 'currency', 'investment', or 'benchmark'
- `reference_id`: FK to currencies.id, investments.id, or benchmarks.id (not enforced by FK constraint due to polymorphic reference)
- `scrape_datetime`: ISO-8601 datetime (YYYY-MM-DDTHH:MM:SS)
- `started_by`: 0 = manual/interactive, 1 = scheduled/cron
- `attempt_number`: 1-5 (retry attempt counter, used for both manual and scheduled)
- `success`: 0 = failure, 1 = success
- `error_code`: HTTP status code or error type (e.g., "404", "TIMEOUT", "SELECTOR_NOT_FOUND")
- `error_message`: Human-readable error description

### 2.4 Update Scraping to Store Prices

Modify `src/server/scrapers/price-scraper.js`:

- After successful price extraction, INSERT OR REPLACE into `prices` table
- Record success in `scraping_history`
- On failure, record failure in `scraping_history` with error details

### 2.5 Update Scraping to Store Currency Rates History

Modify currency rate fetching:

- Already stores to `currency_rates` table (existing behaviour)
- Add recording to `scraping_history` for success/failure tracking

### 2.6 Benchmark Scraping

Create `src/server/scrapers/benchmark-scraper.js`:

- Similar structure to price-scraper.js
- Fetch each benchmark's URL, extract value using selector
- Parse value (handle commas, currency symbols, percentage signs for indices)
- INSERT OR REPLACE into `benchmark_data` table
- Record to `scraping_history`

### 2.7 Benchmark Scraping API Endpoint

Add to `src/server/routes/scraping.js`:

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/scraping/benchmarks` | Scrape all benchmarks, return results via SSE |

Response format matches investment price scraping (SSE streaming with progress updates).

### 2.8 Scraping UI Updates

Update `src/ui/pages/scraping.html` and `src/ui/js/scraping.js`:

- Add "Benchmark Scraping" section after "Investment Price Scraping"
- "Fetch All Benchmarks" button
- Results table: Description, Type, Currency, Raw Value, Parsed Value, Status
- Add "Last scrape: YYYY-MM-DD HH:MM" indicator in page header area
- Add link to view scraping history (new page, see 2.9)

### 2.9 Scraping History View

Create `src/ui/pages/scraping-history.html` and `src/ui/js/scraping-history.js`:

- Simple table view of `scraping_history` records
- Columns: Date/Time, Type, Reference (description), Started By, Attempt, Status, Error
- Filter by: date range, type, success/failure
- Sorted by datetime descending (most recent first)
- Pagination if > 100 records

Add API endpoint:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/scraping/history` | Get scraping history with filters |

### 2.10 Unit Tests — Phase 2

Create/update test files:
- `tests/unit/prices.test.js` — price storage and retrieval
- `tests/unit/benchmark-data.test.js` — benchmark data storage
- `tests/unit/scraping-history.test.js` — history logging
- `tests/unit/benchmark-scraper.test.js` — benchmark scraping logic

---

**PAUSE: Manual Testing — Phase 2**

Verify:
- [ ] New tables created on startup (prices, benchmark_data, scraping_history)
- [ ] Fetch Currency Rates records to scraping_history
- [ ] Fetch All Prices stores to prices table and scraping_history
- [ ] Fetch All Benchmarks stores to benchmark_data and scraping_history
- [ ] Same-day re-fetch overwrites previous values (INSERT OR REPLACE)
- [ ] "Last scrape" indicator displays correctly
- [ ] Scraping history page shows all records with filters working
- [ ] started_by column correctly shows 0 for manual scrapes

---

## Phase 3: Scraping with Retry Logic

### 3.1 Configuration File

Create `config.json` in project root:

```json
{
  "scheduling": {
    "enabled": true,
    "cron": "0 8 * * 6",
    "runOnStartupIfMissed": true,
    "startupDelayMinutes": 10
  },
  "retry": {
    "delayMinutes": 5,
    "maxAttempts": 5
  },
  "scrapeDelayProfile": "cron"
}
```

**Configuration options:**
- `scheduling.enabled`: Enable/disable scheduled scraping (default: true)
- `scheduling.cron`: Cron expression for schedule (default: "0 8 * * 6" = Saturday 8am)
- `scheduling.runOnStartupIfMissed`: If true, run scrape on startup if last successful scrape is older than scheduled interval (default: true)
- `scheduling.startupDelayMinutes`: Delay before missed-schedule scrape runs after startup (default: 10)
- `retry.delayMinutes`: Minutes between retry attempts for failed items (default: 5)
- `retry.maxAttempts`: Maximum retry attempts per item (default: 5)
- `scrapeDelayProfile`: Which delay profile to use for scheduled scrapes ("interactive" or "cron")

### 3.2 Config Loader

Create `src/server/config.js`:

- Load `config.json` from project root
- Validate configuration values
- Provide defaults for missing values
- Export configuration object for use by other modules

### 3.3 Install Croner Dependency

Add to `package.json`:

```json
"dependencies": {
  "croner": "^8.0.0"
}
```

### 3.4 Scraping Service with Retry Logic

Create `src/server/services/scraping-service.js`:

**Core scraping logic used by BOTH interactive and scheduled scraping:**

1. Execute scrape for all currencies, investments, and benchmarks
2. Track which items failed
3. For each failed item, schedule individual retry after `retry.delayMinutes`
4. Each retry increments attempt_number in scraping_history (1, 2, 3, 4, 5)
5. Successful retry stops further retries for that item
6. Stop retrying after `retry.maxAttempts` failures

**Retry logic detail:**
- Each failed item gets its own retry timer (not batch retry)
- Retry only the specific failed currency/investment/benchmark
- Each retry increments attempt_number in scraping_history
- Successful retry stops further retries for that item
- After max attempts, item is marked as failed (no more retries until next scrape run)

**Difference between interactive and scheduled:**
- Interactive (`started_by = 0`): User clicks button, scrape runs immediately with retry logic
- Scheduled (`started_by = 1`): Cron triggers scrape with same retry logic

### 3.5 Scheduled Scraper Service

Create `src/server/services/scheduled-scraper.js`:

**Responsibilities:**
1. On server startup, initialise Croner with cron expression from config
2. Check if missed scrape should run (compare last successful scrape datetime with cron schedule)
3. If missed and `runOnStartupIfMissed` is true, schedule scrape after `startupDelayMinutes`
4. When scheduled scrape triggers, call scraping-service with `started_by = 1`

### 3.6 Update Interactive Scraping

Modify existing scraping routes to use the new scraping-service:

- "Fetch Currency Rates" → calls scraping-service with `started_by = 0`
- "Fetch All Prices" → calls scraping-service with `started_by = 0`
- "Fetch All Benchmarks" → calls scraping-service with `started_by = 0`

All interactive scrapes now benefit from automatic retry logic.

### 3.7 Startup Integration

Modify `src/server/index.js`:

- Import and initialise scheduled-scraper service after database initialisation
- Pass config to scheduler
- Log scheduled scrape times to console (for debugging)

### 3.8 Last Scrape Indicator

Update scraping page to show "Last scrape: YYYY-MM-DD HH:MM" with link to history:

- Query scraping_history for most recent successful scrape datetime
- Display in header area of scraping page
- Format: "Last scrape: 2026-02-01 08:15" as clickable link to `/pages/scraping-history.html`

Add API endpoint:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/scraping/last-success` | Get datetime of most recent successful scrape |

### 3.9 Unit Tests — Phase 3

Create `tests/unit/scraping-service.test.js`:
- Retry scheduling logic
- Attempt number tracking
- Max attempts enforcement
- started_by value handling

Create `tests/unit/scheduled-scraper.test.js`:
- Config loading and validation
- Cron expression parsing (via Croner)
- Missed scrape detection logic

Create `tests/unit/config.test.js`:
- Valid config loading
- Default values for missing keys
- Invalid config handling

---

**PAUSE: Manual Testing — Phase 3**

Verify:
- [ ] `config.json` created and loaded on startup
- [ ] Croner schedules next scrape correctly (check console logs)
- [ ] Missed scrape detection works (set cron to past time, restart app)
- [ ] Startup delay works (10 minute delay before missed scrape runs)
- [ ] **Interactive scraping**: Failed items retry individually after 5 minutes
- [ ] **Scheduled scraping**: Failed items retry individually after 5 minutes
- [ ] Retry stops after 5 attempts (both interactive and scheduled)
- [ ] scraping_history shows correct started_by (0 for interactive, 1 for scheduled)
- [ ] scraping_history shows correct attempt_number (1-5 for retries)
- [ ] "Last scrape" indicator updates after successful scrape

---

## Phase 4: Settings UI

### 4.1 Settings Page

Create `src/ui/pages/settings.html` and `src/ui/js/settings.js`:

- Simple text editor for `config.json`
- Displayed as a `<textarea>` with monospace font
- "Save" button to write changes
- "Reset to Defaults" button to restore default configuration
- JSON validation before save (display error if invalid JSON)
- Warning message: "Changes take effect after restarting the application"

### 4.2 Settings API Endpoints

Create `src/server/routes/settings.js`:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/settings` | Get current config.json contents |
| PUT | `/api/settings` | Update config.json (validates JSON before saving) |
| POST | `/api/settings/reset` | Reset config.json to defaults |

**Validation:**
- Must be valid JSON
- Validate required structure exists
- Validate value types and ranges

### 4.3 Navigation Update

Add gear icon (settings) to navigation bar in all page templates:

- Position: Right side of navigation bar, after "Backup" link
- Icon: Gear/cog SVG icon
- Link: `/pages/settings.html`
- Tooltip: "Settings"

### 4.4 Unit Tests — Phase 4

Create `tests/unit/settings.test.js`:
- GET settings returns current config
- PUT settings validates and saves JSON
- PUT settings rejects invalid JSON
- Reset restores default values

---

**PAUSE: Manual Testing — Phase 4**

Verify:
- [ ] Settings page displays current config.json contents
- [ ] Edit and save changes successfully
- [ ] Invalid JSON shows validation error, not saved
- [ ] Reset to defaults works
- [ ] Gear icon visible in navigation on all pages
- [ ] Changes persist after app restart

---

## Summary of New Files

### Database
- Schema additions to `src/server/db/schema.sql` (4 new tables)

### Server
- `src/server/routes/benchmarks.js` — Benchmarks CRUD API
- `src/server/routes/settings.js` — Settings API
- `src/server/scrapers/benchmark-scraper.js` — Benchmark value scraping
- `src/server/services/scraping-service.js` — Core scraping with retry logic
- `src/server/services/scheduled-scraper.js` — Cron scheduling
- `src/server/config.js` — Configuration loader

### UI
- `src/ui/pages/benchmarks.html` — Benchmarks CRUD page
- `src/ui/js/benchmarks.js` — Benchmarks page logic
- `src/ui/pages/scraping-history.html` — Scraping history view
- `src/ui/js/scraping-history.js` — History page logic
- `src/ui/pages/settings.html` — Settings/config editor
- `src/ui/js/settings.js` — Settings page logic

### Configuration
- `config.json` — User-editable application configuration

### Tests
- `tests/unit/benchmarks.test.js`
- `tests/unit/prices.test.js`
- `tests/unit/benchmark-data.test.js`
- `tests/unit/scraping-history.test.js`
- `tests/unit/benchmark-scraper.test.js`
- `tests/unit/scraping-service.test.js`
- `tests/unit/scheduled-scraper.test.js`
- `tests/unit/config.test.js`
- `tests/unit/settings.test.js`

---

## Version Update

Update version to `0.2.0` in:
- `package.json`
- `src/shared/constants.js` (APP_VERSION)
- Footer in all HTML pages
- `CLAUDE.md` (if version-specific references exist)

---

## Future Considerations (Not in v0.2.0)

- Scraping schedule visible in UI (next run time)
- Email/notification on scrape failure
- SQLCipher database encryption
- YubiKey authentication

# v0.5.0 — Price History Testing in Scraper Testing UI — Implementation Plan

## Context

### Problem

The Investments UI "Test" button tests both live scraping AND historic price data (Morningstar) in parallel, giving full visibility into whether a fund/share will work end-to-end. The Scraper Testing page — the sandbox for validating scraper configurations — only tests live scraping. Its "Test" and "Test All" buttons have no visibility into whether Morningstar historic data is available for a test investment.

This makes the sandbox incomplete: a user can confirm a live price scrapes successfully but has no way to check whether historic backfill will work until they promote the investment to the live table.

### Solution

Add a "History" column to the Scraper Testing table showing whether Morningstar has historic data for each test investment. Updated by both the single "Test" button and the "Test All" SSE stream. Clicking the history indicator shows a detail modal with the 10 most recent weekly prices.

### Key Constraint

`test_investments` does NOT have a `morningstar_id` column (unlike `investments` which got it via migration 6). Morningstar ID resolution cannot be cached for test investments — it resolves fresh each time. This is acceptable for a testing sandbox and avoids a schema migration.

---

## Implementation Plan

### Step 1: Add `testBackfillTestInvestment()` to historic-backfill.js

The existing `testBackfillInvestment(investmentId)` reads from the `investments` table via a raw SQL query. Add a parallel function that reads from `test_investments` instead.

```js
export async function testBackfillTestInvestment(testInvestmentId)
```

- Uses `getTestInvestmentById(testInvestmentId)` from `test-investments-db.js`
- The returned object already has `public_id`, `currency_code`, `investment_url`, `description` — same fields the Morningstar resolution logic needs
- No `morningstar_id` caching — always resolves fresh from ISIN/ticker/URL
- Otherwise identical to `testBackfillInvestment`: resolve Morningstar ID, fetch 10 most recent weekly prices, return `{success, description, currency, rows, error?}`
- Read-only — no DB writes

**File**: `src/server/services/historic-backfill.js`
**Import**: `getTestInvestmentById` from `../db/test-investments-db.js`
**Reuses** (all already in same file): `detectPublicIdType`, `extractIsinFromUrl`, `extractLseTickerFromUrl`, `lookupMorningstarIdByIsin`, `lookupMorningstarIdByName`, `fetchMorningstarHistory`

### Step 2: Add backend route

```
GET /api/test-investments/:id/backfill/test
```

- Calls `testBackfillTestInvestment(id)`
- Returns the result as JSON
- Client handles 30s timeout

**File**: `src/server/routes/test-investments-routes.js`
**Import**: `testBackfillTestInvestment` from `../services/historic-backfill.js`

### Step 3: Add "History" column to the table

In `loadTestInvestments()`:

- Add `<th>History</th>` column header between "Price" and the buttons column
- Add `<td id="history-{id}">—</td>` cell for each row, defaulting to "—"
- Table colspan references updated accordingly (e.g. history panel)

**File**: `src/ui/js/scraper-testing.js`

### Step 4: Update `testSingle()` to include history preview

Modify `testSingle(id, button)` to fire the history preview in parallel with the live scrape:

1. Set both status cell AND history cell to spinners
2. Fire two requests in parallel:
   - Live scrape: `POST /api/test-investments/{id}/scrape` (existing, 120s timeout)
   - History preview: `GET /api/test-investments/{id}/backfill/test` (new, 30s timeout)
3. Update status/price cells from live scrape result (existing logic, unchanged)
4. Update history cell from backfill result:
   - Success with rows: green tick + row count (e.g. `✓ 10`)
   - Success with 0 rows: amber dash
   - Failure: red cross
5. Store rows data in `historyResults[id]` for the detail modal
6. Make history cell clickable via `onclick="showHistoryDetail({id})"`

**File**: `src/ui/js/scraper-testing.js`

### Step 5: Add `history` event to Test All SSE stream

**Backend** — in the existing per-investment loop (after price scrape + retries complete):

1. Call `testBackfillTestInvestment(testInvestment.id)`
2. Send a new `history` SSE event with the result
3. 500ms delay before next investment (Morningstar rate politeness)

**Frontend** — in `testAll()`:

- Add `history` event listener to the EventSource
- On receive, update the history cell (same ✓/✗/— logic as Step 4)
- Store rows data in `historyResults` for the detail modal
- Update `init` event handler to set history cells to spinners alongside status cells
- Update `done` summary to include history success/fail counts

**Files**: `src/server/routes/test-investments-routes.js`, `src/ui/js/scraper-testing.js`

### Step 6: Add history detail modal

Add `showHistoryDetail(id)` function:

- Reads from `historyResults[id]` (populated by Steps 4/5)
- Shows a modal with date/price table (same format as `buildHistoricPreviewTable` in `investments.js`)
- If no data cached, shows "Run Test to see historic data"

**File**: `src/ui/js/scraper-testing.js`

---

## Files to Modify

| File | Change |
|------|--------|
| `src/server/services/historic-backfill.js` | Add `testBackfillTestInvestment()` function, import `getTestInvestmentById` |
| `src/server/routes/test-investments-routes.js` | Add `GET .../backfill/test` route, add `history` SSE event to stream |
| `src/ui/js/scraper-testing.js` | Add History column, update `testSingle()` + `testAll()`, add `showHistoryDetail()` modal, add `historyResults` cache |

---

## Verification

1. **`bun test`** — all existing tests pass (no breaking changes)
2. **Single Test button** — pick an ISIN-based test investment, click Test, confirm both Status and History columns update; click history cell to see 10-row price preview modal
3. **Test All** — click Test All, confirm both columns update progressively as each investment completes
4. **No-data case** — test investment Morningstar can't find (savings account, obscure fund) shows red ✗ or amber — in History column
5. **Ticker-based equities** — should still get history results via Morningstar name lookup

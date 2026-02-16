# Plan v0.12.0 — Expanded Backup/Restore and Reference Test Database

## Background / Context

For:
1. A starting test set up for a new user following fresh install
2. On going testing as new features are introduced
3. For demonstration (without giving personal financial details)
4. For use in end user documentation

There is a need for a separate database/config/Docs directory and List samples that can be "single click" recreated. It needs to be kept up to date — prices/currency/benchmarks used in the "Test" database should be updated as part of the standard fetch/CRON job.

The initial set up should be created by a one-off copy script (a development task, not available to subsequent end users — just used to create a working set of data that will then be pruned, accounts anonymised and holding quantities changed).

Prior to this phase of the feature, the backup and restore need expanding. Currently the backup only deals with the SQLite database. The user's data also includes Lists (embedded spreadsheet config), markdown content in `./docs` and Settings in `config.json`.

### Expanded Backup

Note: the test database backed up should always be the reference database, `./docs` content and `config.json` created in the initial setup. It should not be changed by the end user.

1. Back up databases (live and reference test)
2. Download all files in `./docs` and `config.json` (live and reference test)
3. Create a `*.zip` file named `portfolio_60_backup_YYMMDD_HHMM.zip` and write to the directory specified by `"backup_dir"` in `config.json`. Test backup `test_backup_YYMMDD_HHMM.zip` always written to project root.

### Restore Test

If the user signs in with a passphrase of "test" (any case) it is presumed to be a test/demo/training session.

1. There is no verification of passphrase
2. The database, `./docs` directory content and `config.json` are restored from the test reference data
3. To show the user they are using the test reference database and data, the navbar should change the title from "Portfolio 60" to "Portfolio 60 - Test"

### Restore Live

Expand current restore to include `./docs` directory files and `config.json`.

---

## Data Separation: Live vs Test

To cleanly separate live and test data and eliminate any risk of cross-contamination:

| Data | Live location | Test reference location |
|------|--------------|------------------------|
| Database | `data/portfolio60.db` | `data/test_reference/portfolio60.db` |
| Docs | `docs/` | `data/test_reference/docs/` |
| Config | `src/shared/config.json` | `data/test_reference/config.json` |

The `data/test_reference/` directory holds the "gold master" test data. This directory is:
- Created once by the developer copy script
- Never modified by the end user
- Included in backups as a complete unit
- Used as the source when restoring for a test session

When the user logs in with "test", the application copies the reference data into the live locations, runs the session, and the user's live data is untouched (it was backed up before the swap, and restored when the test session ends — or alternatively, the swap only happens in memory/config without touching live files).

**Simpler approach chosen:** When "test" is entered as the passphrase, the application switches to use the test reference paths directly (point `DB_PATH` at `data/test_reference/portfolio60.db`, `DOCS_DIR` at `data/test_reference/docs/`, and load `data/test_reference/config.json`). The live data is never touched. This avoids any copy/swap complexity.

---

## Phase 1 — Expanded Backup/Restore

### 1.1 Install zip dependency

```bash
bun add archiver adm-zip
```

- `archiver` for creating zip files (streaming, handles directories)
- `adm-zip` for extracting zip files on restore

### 1.2 Add backup directories to config.json

Add to `src/shared/config.json`:

```json
"backup_dir_live": "/home/rcollins/backup",
"backup_dir_test": "/home/rcollins/backup/test"
```

- **`backup_dir_live`** — Where live backup zips are written. Fallback: `backups/` (existing constant).
- **`backup_dir_test`** — Where test reference backup zips are written. Fallback: `backups/test/`.

Update `src/server/config.js` to read both values with their respective fallbacks. Both directories are created automatically if they do not exist.

### 1.3 Expand `createBackup()` in `src/server/db/backup-db.js`

**Current behaviour:** Copies `portfolio60.db` to `backups/portfolio60_YYMMDD_HHMMSS.db`.

**New behaviour:** Creates a zip archive containing:

```
portfolio_60_backup_YYMMDD_HHMM.zip
├── portfolio60.db          (live database, after WAL checkpoint)
├── config.json             (copy of src/shared/config.json)
└── docs/                   (full copy of docs/ directory tree)
    ├── guide/
    │   ├── user_guide_v1.0.md
    │   └── ...
    ├── notes/
    │   └── ...
    └── media/
        └── ...
```

Written to the directory specified by `backup_dir_live` in config.json.

If test reference data exists (`data/test_reference/`), also create:

```
test_backup_YYMMDD_HHMM.zip
├── portfolio60.db          (test reference database)
├── config.json             (test reference config)
└── docs/                   (test reference docs)
```

Written to the directory specified by `backup_dir_test` in config.json.

### 1.4 Expand `restoreBackup()` in `src/server/db/backup-db.js`

**Current behaviour:** Copies a `.db` file over the live database.

**New behaviour:** 
- Accept `.zip` files (new format) as well as `.db` files (legacy format for backwards compatibility)
- For `.zip` restores:
  1. Close the database connection
  2. Extract `portfolio60.db` → `data/portfolio60.db` (remove WAL/SHM files first)
  3. Extract `config.json` → `src/shared/config.json`
  4. Extract `docs/` → `docs/` (clear existing docs first, then extract)
  5. Reopen database connection and reload config
- For `.db` restores: existing behaviour (database only)

### 1.5 Expand `listBackups()` in `src/server/db/backup-db.js`

- Read from `backup_dir_live` (from config) instead of hardcoded `backups/`
- List both `.db` (legacy) and `.zip` (new format) files
- Return file type indicator so the UI can show which format each backup is

### 1.6 Update backup UI (`src/ui/pages/backup.html` and `src/ui/js/backup.js`)

- Show file format (zip vs db) in the backup list
- Add a note explaining that zip backups include docs and config
- Legacy `.db` backups still restorable (database only)
- Download button for zip files (so user can save to external storage)

### 1.7 Update `deleteBackup()`

- Read from `backup_dir_live` (from config) instead of hardcoded path
- Handle both `.db` and `.zip` files

---

**PAUSE: Manual testing after Phase 1**

Verify:
- [ ] Backup creates a `.zip` file in the configured `backup_dir_live`
- [ ] Zip contains database, config.json, and docs/ directory
- [ ] Restore from `.zip` replaces database, config, and docs
- [ ] Restore from legacy `.db` still works (database only)
- [ ] List shows both `.zip` and `.db` backups from `backup_dir_live`
- [ ] Delete works for both formats
- [ ] Test backup zip created in `backup_dir_test` (if test reference data exists)
- [ ] `bun test` passes — all existing tests still work

---

## Phase 2 — Reference Test Database and Test Mode

### 2.1 One-off copy script (developer tool)

Create `scripts/create-test-reference.js` — a one-off script run by the developer to seed the test reference data:

```bash
bun scripts/create-test-reference.js
```

What it does:
1. Creates `data/test_reference/` directory
2. Copies `data/portfolio60.db` → `data/test_reference/portfolio60.db`
3. Copies `src/shared/config.json` → `data/test_reference/config.json`
4. Copies `docs/` → `data/test_reference/docs/` (full directory tree)
5. Prints summary of what was copied

After running, the developer prunes and anonymises the test database. Open it with sqlite3:

```bash
sqlite3 data/test_reference/portfolio60.db
```

#### Step A: Anonymise users and accounts

```sql
-- Anonymise user details
UPDATE users SET first_name = 'Alice', last_name = 'Smith',
  ni_number = 'AB123456A', utr = '1234567890',
  trading_ref = 'TR-001', isa_ref = 'ISA-001', sipp_ref = 'SIPP-001'
  WHERE id = 1;

UPDATE users SET first_name = 'Bob', last_name = 'Smith',
  ni_number = 'CD789012B', utr = '0987654321',
  trading_ref = 'TR-002', isa_ref = 'ISA-002', sipp_ref = 'SIPP-002'
  WHERE id = 2;
-- Repeat for other users, or delete surplus users (see step B)

-- Update account refs to match
UPDATE accounts SET account_ref = 'TR-001' WHERE user_id = 1 AND account_type = 'trading';
UPDATE accounts SET account_ref = 'ISA-001' WHERE user_id = 1 AND account_type = 'isa';
UPDATE accounts SET account_ref = 'SIPP-001' WHERE user_id = 1 AND account_type = 'sipp';
-- Repeat for user 2 etc.

-- Adjust cash balances to non-real values
UPDATE accounts SET cash_balance = 50000000, warn_cash = 5000000;
```

#### Step B: Reduce investments to a representative subset

Keep a small set (e.g. 8-12) covering each investment type and a mix of GBP/foreign currencies. Delete the rest, working bottom-up through the foreign key chain:

```sql
-- Identify which investment IDs to KEEP (adjust to your choices)
-- e.g. keep IDs 1, 3, 7, 12, 15, 20, 25, 30

-- Delete child rows for investments being removed
-- Order matters: holding_movements and cash_transactions first, then holdings, then prices

-- Remove cash_transactions linked to holding_movements for holdings being removed
DELETE FROM cash_transactions WHERE holding_movement_id IN (
  SELECT hm.id FROM holding_movements hm
  JOIN holdings h ON hm.holding_id = h.id
  WHERE h.investment_id NOT IN (1, 3, 7, 12, 15, 20, 25, 30)
);

-- Remove holding_movements for holdings being removed
DELETE FROM holding_movements WHERE holding_id IN (
  SELECT id FROM holdings
  WHERE investment_id NOT IN (1, 3, 7, 12, 15, 20, 25, 30)
);

-- Remove holdings for investments being removed
DELETE FROM holdings WHERE investment_id NOT IN (1, 3, 7, 12, 15, 20, 25, 30);

-- Remove prices for investments being removed
DELETE FROM prices WHERE investment_id NOT IN (1, 3, 7, 12, 15, 20, 25, 30);

-- Remove the investments themselves
DELETE FROM investments WHERE id NOT IN (1, 3, 7, 12, 15, 20, 25, 30);

-- Clean up scraping history for removed investments
DELETE FROM scraping_history WHERE scrape_type = 'investment'
  AND reference_id NOT IN (1, 3, 7, 12, 15, 20, 25, 30);
```

#### Step C: Reduce test_investments

`test_prices` has ON DELETE CASCADE, so this is straightforward:

```sql
-- Keep a handful of test investments (e.g. IDs 1, 2, 3, 4, 5)
DELETE FROM test_investments WHERE id NOT IN (1, 2, 3, 4, 5);
-- test_prices rows cascade-deleted automatically
```

#### Step D: Set up an example portfolio from the reduced investment set

Adjust holdings to create a believable demo portfolio using only the kept investments:

```sql
-- Clear existing holdings/movements and rebuild
DELETE FROM cash_transactions;
DELETE FROM holding_movements;
DELETE FROM holdings;

-- Example holdings for Alice's ISA (account_id depends on your data)
INSERT INTO holdings (account_id, investment_id, quantity, average_cost) VALUES
  (1, 1, 1500000, 12500),   -- 150 units at 1.25
  (1, 3, 500000, 350000),   -- 50 units at 35.00
  (1, 7, 10000000, 1500);   -- 1000 units at 0.15

-- Example holdings for Bob's Trading account
INSERT INTO holdings (account_id, investment_id, quantity, average_cost) VALUES
  (4, 12, 2000000, 85000),  -- 200 units at 8.50
  (4, 15, 750000, 220000);  -- 75 units at 22.00

-- Adjust account IDs and investment IDs to match your kept data
```

#### Step E: Clear sensitive notes and surplus history

```sql
DELETE FROM scraping_history;
DELETE FROM global_events;  -- Or keep a few example events
UPDATE cash_transactions SET notes = NULL;
UPDATE holding_movements SET notes = NULL;
VACUUM;
```

#### Step F: Prune test docs and config

- Edit `data/test_reference/config.json`: remove personal list items (embedded spreadsheets), replace with sample entries or leave empty
- Review `data/test_reference/docs/`: remove documents with personal content, keep the user guide and any generic docs

#### Step G: Run a price fetch

Start the app pointing at the test reference database and run a manual fetch to populate current prices, currency rates and benchmark values for the kept investments:

```bash
# Start the app temporarily using the test reference DB
DB_PATH=data/test_reference/portfolio60.db bun src/server/index.js
```

Navigate to **Set Up > Fetching** and click **Fetch All**. This ensures the test database has up-to-date prices so the demo portfolio valuation looks realistic. Stop the server afterwards.

#### Step H: Commit as the gold master

```bash
git add data/test_reference/
git commit -m "feat: Add reference test database with anonymised sample data"
```

From this point on, the scheduled scraper keeps the test database prices current automatically (step 2.2).

#### Saving Prune SQL for Reuse

After completing Steps A–E, save the SQL statements used as a reusable script:

```bash
scripts/prune-test-reference.sql
```

This script captures all the DELETE, UPDATE and INSERT statements so the pruning process can be repeated in future (e.g. every 6 months to refresh the reference data). The workflow for a refresh is:

1. Re-run `scripts/create-test-reference.js` to take a fresh copy of the live database, docs and config
2. Run the saved SQL against the fresh copy: `sqlite3 data/test_reference/portfolio60.db < scripts/prune-test-reference.sql`
3. Review and adjust if investments have been added/removed since last time (edit the SQL `NOT IN (...)` lists)
4. Repeat Steps F–H (prune docs/config, run a price fetch, commit)

This avoids re-inventing the prune statements each time and keeps the process quick and repeatable.

This script and the manual pruning steps are development tools only — not exposed in the application UI.

### 2.2 Update scheduled scraper to include test reference database

In `src/server/services/scheduled-scraper.js` (or wherever the cron fetch runs):

After a successful price/currency/benchmark fetch to the live database, also update the test reference database:
1. Open `data/test_reference/portfolio60.db` as a second connection
2. Copy the freshly fetched prices, currency_rates, and benchmark_data rows into the test database
3. Close the second connection

This keeps the test database valuations current without requiring separate scraping.

### 2.3 Test mode passphrase bypass

Modify `src/server/routes/auth-routes.js` — both the `POST /api/auth/verify` and `POST /api/auth/set-passphrase` handlers:

```javascript
// Before verifying against hash (or before setting a new hash on first run),
// check for test mode
if (passphrase.toLowerCase() === "test") {
  // Switch to test reference data
  setTestMode(true);
  setAuthStatus(true);
  return Response.json({ success: true, testMode: true });
}
```

**First-run support:** On a fresh install there is no passphrase hash in `.env`. The passphrase page shows the "set passphrase" form. If the user types "test" here, the app enters test mode immediately — no hash is created, no `.env` is written. This gives new users the lowest-friction path to exploring the app with sample data.

The passphrase page UI (`src/ui/pages/passphrase.html` / JS) also needs updating: when the API returns `{ testMode: true }`, redirect to the home page as normal (skip any "confirm passphrase" step).

### 2.4 Test mode data switching

Create `src/server/test-mode.js`:

```javascript
let testModeActive = false;

export function setTestMode(active) {
  testModeActive = active;
  if (active) {
    // Point database to test reference
    process.env.DB_PATH = "data/test_reference/portfolio60.db";
    // Point docs to test reference
    process.env.DOCS_DIR = "data/test_reference/docs";
    // Load test reference config
    setConfigPath("data/test_reference/config.json");
    // Reopen database with test path
    closeDatabase();
  }
}

export function isTestMode() {
  return testModeActive;
}
```

### 2.5 Add test mode API endpoint

Add `GET /api/auth/test-mode` endpoint that returns `{ testMode: true/false }`. The navbar and other UI components call this on load to know whether to show the test indicator.

### 2.6 Update navbar for test mode

Modify `src/ui/js/components/app-navbar.js`:

- On `connectedCallback()`, fetch `/api/auth/test-mode`
- If test mode is active, change the title from "Portfolio 60" to "Portfolio 60 - Test"
- Add a visual indicator (e.g. amber/orange background stripe or badge) so it's unmistakable

### 2.7 Passphrase confirmation isolation

Destructive operations (e.g. cascade-deleting a user or account) require the user to re-enter their passphrase as a confirmation gate. The passphrase used for confirmation must match the mode the session was started in — the two are not interchangeable:

- **Live session:** Confirmation must verify against the real passphrase hash in `.env`. Entering "test" as the confirmation passphrase must be rejected.
- **Test session:** Confirmation must accept "test" (case-insensitive) and reject anything else. The real passphrase hash is never consulted.

Modify the passphrase verification endpoint (or the specific confirmation endpoint used by delete operations) to check `isTestMode()`:

```javascript
if (isTestMode()) {
  // In test mode, only "test" is accepted as confirmation
  var confirmed = passphrase.toLowerCase() === "test";
  return Response.json({ verified: confirmed });
} else {
  // In live mode, verify against the real hash — reject "test"
  if (passphrase.toLowerCase() === "test") {
    return Response.json({ verified: false });
  }
  var hash = loadHashFromEnv();
  var confirmed = await verifyPassphrase(passphrase, hash);
  return Response.json({ verified: confirmed });
}
```

This ensures a user cannot accidentally perform destructive operations on live data by entering "test", and cannot bypass test-mode confirmation by guessing the real passphrase.

### 2.8 Prevent writes to test reference data

When in test mode, the user can browse and view all data but should not be able to modify the reference data permanently. Two approaches:

**Option A (simple):** Allow writes during the test session — they go to the test database. Since the test reference is restored fresh each time someone logs in with "test", any changes are discarded on the next test login.

**Option B (strict):** Block all write operations (POST/PUT/DELETE to data endpoints) when in test mode. Return a friendly error: "Changes are not saved in test mode."

**Recommended: Option A** — it's simpler and lets users practice the full workflow (adding holdings, recording transactions, etc.) without restriction. The reference data is restored from the committed files on next test login.

### 2.9 Test mode exit

When the user closes the app or logs out:
- If in test mode, reset `DB_PATH`, `DOCS_DIR`, and config path back to live values
- Close and reopen the database connection pointing at live data

Since there is no session timeout in v0.1.0, test mode persists until the app is restarted. On restart, the user enters their real passphrase (or "test" again) — the choice is made fresh each time.

---

**PAUSE: Manual testing after Phase 2**

Verify:
- [ ] Run `scripts/create-test-reference.js` to create reference data
- [ ] Anonymise/prune the test reference database manually
- [ ] Start the app and enter "test" as passphrase — app opens in test mode
- [ ] Navbar shows "Portfolio 60 - Test"
- [ ] All data shown is from the test reference database
- [ ] Docs shown are from the test reference docs directory
- [ ] Config (providers, lists, etc.) is from the test reference config
- [ ] Close app, restart, enter real passphrase — live data is intact and unchanged
- [ ] In test mode, cascade-delete confirmation accepts "test" and rejects real passphrase
- [ ] In live mode, cascade-delete confirmation accepts real passphrase and rejects "test"
- [ ] On fresh install (no `.env`), entering "test" on set-passphrase screen enters test mode without creating a hash
- [ ] Scheduled fetch updates both live and test reference databases
- [ ] Backup zip includes test reference data as a separate zip in `backup_dir_test`
- [ ] `bun test` passes — all existing tests still work

---

## Files to Create

| File | Purpose |
|------|---------|
| `scripts/create-test-reference.js` | One-off developer script to seed test reference data |
| `src/server/test-mode.js` | Test mode state management |
| `data/test_reference/` | Directory for test reference database, docs, config |

## Files to Modify

| File | Changes |
|------|---------|
| `package.json` | Add `archiver` and `adm-zip` dependencies |
| `src/shared/config.json` | Add `backup_dir_live` and `backup_dir_test` settings |
| `src/server/config.js` | Read `backup_dir_live` and `backup_dir_test` from config |
| `src/server/db/backup-db.js` | Zip creation/extraction, expanded backup/restore/list/delete |
| `src/server/routes/backup-routes.js` | Handle zip format, download endpoint |
| `src/server/routes/auth-routes.js` | Test passphrase bypass |
| `src/server/services/scheduled-scraper.js` | Copy fresh prices to test reference DB |
| `src/ui/pages/backup.html` | Show zip/db format, download button |
| `src/ui/js/backup.js` | Handle new backup format in UI |
| `src/ui/js/components/app-navbar.js` | Test mode title change |
| `src/ui/pages/passphrase.html` (+ JS) | Handle `testMode` response, skip confirm step on first run |
| `.gitignore` | Ensure `data/test_reference/` is tracked (not ignored) |

## Dependencies

| Package | Purpose |
|---------|---------|
| `archiver` | Create zip archives for backup |
| `adm-zip` | Extract zip archives for restore |

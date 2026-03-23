import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, chmodSync, accessSync, statfsSync, constants as fsConstants } from "node:fs";
import { resolve, dirname } from "node:path";
import { execSync } from "node:child_process";
import { DB_PATH } from "../../shared/server-constants.js";

/**
 * @description Btrfs filesystem magic number used by statfs.
 * Btrfs copy-on-write semantics conflict with SQLite WAL mode,
 * causing "disk I/O error" under sustained writes.
 *
 * Node returns this as unsigned (0x9123683e = 2434729022), but Bun
 * returns it as a signed 32-bit integer (-1860238274). We check both.
 * @type {number}
 */
const BTRFS_MAGIC = 0x9123683e;
const BTRFS_MAGIC_SIGNED = BTRFS_MAGIC | 0; // -1860238274 (signed 32-bit)

/**
 * @description Cached resolved path to the database file. Set on first
 * call to getResolvedDbPath() so that test files can override
 * process.env.DB_PATH before any database function is called.
 * (ES module imports are hoisted above all other code, so a module-level
 * constant would evaluate before the test's env var assignment.)
 * @type {string|null}
 */
let resolvedDbPath = null;

/**
 * @description Get the resolved absolute path to the SQLite database file.
 * Uses the DB_PATH environment variable if set (e.g. for testing with
 * isolated databases), otherwise falls back to DB_PATH from constants.
 * The result is cached after the first call.
 * @returns {string} The absolute path to the database file
 */
function getResolvedDbPath() {
  if (resolvedDbPath === null) {
    resolvedDbPath = resolve(process.env.DB_PATH || DB_PATH);
  }
  return resolvedDbPath;
}

/**
 * @description Singleton database instance. Null until the database is
 * first opened via getDatabase().
 * @type {Database|null}
 */
let db = null;

/**
 * @description Check whether a path is on a btrfs filesystem.
 * Btrfs copy-on-write conflicts with SQLite WAL mode, causing
 * "disk I/O error" under sustained writes.
 * @param {string} dirPath - Directory path to check
 * @returns {boolean} True if the path is on btrfs
 */
function isBtrfs(dirPath) {
  try {
    const stats = statfsSync(dirPath);
    return stats.type === BTRFS_MAGIC || stats.type === BTRFS_MAGIC_SIGNED;
  } catch {
    return false;
  }
}

/**
 * @description Disable btrfs copy-on-write on a directory using chattr +C.
 * Only effective on empty directories — existing files keep their CoW setting.
 * Fails silently on non-btrfs filesystems or if chattr is unavailable.
 * @param {string} dirPath - Directory path to modify
 */
function disableCopyOnWrite(dirPath) {
  try {
    execSync("chattr +C " + JSON.stringify(dirPath), { stdio: "ignore" });
    console.log("[DB] Disabled btrfs copy-on-write on " + dirPath);
  } catch {
    // chattr may not be available or may fail on non-btrfs — ignore
  }
}

/**
 * @description Check whether the database file exists on disk.
 * @returns {boolean} True if the database file exists
 */
export function databaseExists() {
  return existsSync(getResolvedDbPath());
}

/**
 * @description Get the singleton database connection. Opens the database
 * if not already open, enables WAL mode and foreign key enforcement.
 * Throws an error if the database file does not exist — use
 * createDatabase() first.
 * @returns {Database} The open database connection
 */
export function getDatabase() {
  if (db) {
    return db;
  }

  if (!databaseExists()) {
    throw new Error("Database does not exist. Call createDatabase() first.");
  }

  const dbPath = getResolvedDbPath();

  // Verify the file is readable and writable before attempting to open it
  try {
    accessSync(dbPath, fsConstants.R_OK | fsConstants.W_OK);
  } catch (err) {
    throw new Error(
      `Database file is not readable/writable: ${dbPath}. ` +
      `Check file permissions (expected owner read/write, i.e. chmod 600). ` +
      `Original error: ${err.message}`
    );
  }

  db = new Database(dbPath);

  // Btrfs copy-on-write conflicts with SQLite WAL mode, causing
  // "disk I/O error" under sustained writes (e.g. fetching 20+ prices).
  // Use DELETE journal mode on btrfs for reliability.
  const dbDir = dirname(dbPath);
  if (isBtrfs(dbDir)) {
    db.exec("PRAGMA journal_mode = DELETE");
    console.log("[DB] Btrfs detected — using DELETE journal mode");
  } else {
    db.exec("PRAGMA journal_mode = WAL");
  }

  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");

  runMigrations(db);

  return db;
}

/**
 * @description Run any pending schema migrations on an existing database.
 * Each migration checks whether it has already been applied before running.
 * @param {Database} database - The open database connection
 */
function runMigrations(database) {
  // Migration 1: Increase investments.selector CHECK constraint from 120 to 255.
  // Detect by inspecting the CREATE TABLE SQL in sqlite_master.
  const tableInfo = database.query("SELECT sql FROM sqlite_master WHERE type='table' AND name='investments'").get();

  if (tableInfo && tableInfo.sql && tableInfo.sql.includes("length(selector) <= 120")) {
    database.exec("PRAGMA foreign_keys = OFF");
    database.exec("BEGIN TRANSACTION");
    try {
      database.exec(`
        CREATE TABLE investments_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          currencies_id INTEGER NOT NULL,
          investment_type_id INTEGER NOT NULL,
          description TEXT NOT NULL CHECK(length(description) <= 60),
          investment_url TEXT CHECK(investment_url IS NULL OR length(investment_url) <= 255),
          selector TEXT CHECK(selector IS NULL OR length(selector) <= 255),
          FOREIGN KEY (currencies_id) REFERENCES currencies(id),
          FOREIGN KEY (investment_type_id) REFERENCES investment_types(id)
        )
      `);
      database.exec("INSERT INTO investments_new SELECT * FROM investments");
      database.exec("DROP TABLE investments");
      database.exec("ALTER TABLE investments_new RENAME TO investments");
      // Recreate indexes that were on the original table
      database.exec("CREATE INDEX IF NOT EXISTS idx_investments_type ON investments(investment_type_id)");
      database.exec("CREATE INDEX IF NOT EXISTS idx_investments_currency ON investments(currencies_id)");
      database.exec("COMMIT");
    } catch (err) {
      database.exec("ROLLBACK");
      throw err;
    } finally {
      database.exec("PRAGMA foreign_keys = ON");
    }
  }

  // Migration 2: Add benchmarks table (v0.2.0)
  // Check if the benchmarks table exists
  const benchmarksTable = database.query("SELECT name FROM sqlite_master WHERE type='table' AND name='benchmarks'").get();

  if (!benchmarksTable) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS benchmarks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        currencies_id INTEGER NOT NULL,
        benchmark_type TEXT NOT NULL CHECK(benchmark_type IN ('index', 'price')),
        description TEXT NOT NULL CHECK(length(description) <= 60),
        benchmark_url TEXT CHECK(benchmark_url IS NULL OR length(benchmark_url) <= 255),
        selector TEXT CHECK(selector IS NULL OR length(selector) <= 255),
        FOREIGN KEY (currencies_id) REFERENCES currencies(id)
      )
    `);
    database.exec("CREATE INDEX IF NOT EXISTS idx_benchmarks_type ON benchmarks(benchmark_type)");
    database.exec("CREATE INDEX IF NOT EXISTS idx_benchmarks_currency ON benchmarks(currencies_id)");
  }

  // Migration 3: Add prices table (v0.2.0)
  const pricesTable = database.query("SELECT name FROM sqlite_master WHERE type='table' AND name='prices'").get();

  if (!pricesTable) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        investment_id INTEGER NOT NULL,
        price_date TEXT NOT NULL,
        price INTEGER NOT NULL,
        FOREIGN KEY (investment_id) REFERENCES investments(id),
        UNIQUE(investment_id, price_date)
      )
    `);
    database.exec("CREATE INDEX IF NOT EXISTS idx_prices_lookup ON prices(investment_id, price_date DESC)");
  }

  // Migration 4: Add benchmark_data table (v0.2.0)
  const benchmarkDataTable = database.query("SELECT name FROM sqlite_master WHERE type='table' AND name='benchmark_data'").get();

  if (!benchmarkDataTable) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS benchmark_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        benchmark_id INTEGER NOT NULL,
        benchmark_date TEXT NOT NULL,
        value INTEGER NOT NULL,
        FOREIGN KEY (benchmark_id) REFERENCES benchmarks(id),
        UNIQUE(benchmark_id, benchmark_date)
      )
    `);
    database.exec("CREATE INDEX IF NOT EXISTS idx_benchmark_data_lookup ON benchmark_data(benchmark_id, benchmark_date DESC)");
  }

  // Migration 5: Add fetch_history table (v0.2.0, renamed from scraping_history in v0.18.0)
  // Check for both old and new table names to handle databases at any migration level.
  const fetchHistoryTable = database.query("SELECT name FROM sqlite_master WHERE type='table' AND name='fetch_history'").get();
  const legacyScrapingHistoryTable = database.query("SELECT name FROM sqlite_master WHERE type='table' AND name='scraping_history'").get();

  if (!fetchHistoryTable && !legacyScrapingHistoryTable) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS fetch_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fetch_type TEXT NOT NULL CHECK(fetch_type IN ('currency', 'investment', 'benchmark')),
        reference_id INTEGER NOT NULL,
        fetch_datetime TEXT NOT NULL,
        started_by INTEGER NOT NULL DEFAULT 0,
        attempt_number INTEGER NOT NULL DEFAULT 1,
        success INTEGER NOT NULL DEFAULT 0,
        error_code TEXT,
        error_message TEXT
      )
    `);
    database.exec("CREATE INDEX IF NOT EXISTS idx_fetch_history_datetime ON fetch_history(fetch_datetime DESC)");
    database.exec("CREATE INDEX IF NOT EXISTS idx_fetch_history_type_ref ON fetch_history(fetch_type, reference_id)");
  }

  // Migration 6: Add morningstar_id column to investments (v0.3.0)
  // Stores the Morningstar SecId for historic price lookups (e.g. "F00000LK2Q").
  // Populated automatically during historic data backfill.
  const investmentsCols = database.query("PRAGMA table_info(investments)").all();
  const hasMorningstarId = investmentsCols.some(function (col) {
    return col.name === "morningstar_id";
  });

  if (!hasMorningstarId) {
    database.exec("ALTER TABLE investments ADD COLUMN morningstar_id TEXT");
  }

  // Migration 7: Add yahoo_ticker column to benchmarks (v0.3.0)
  // Stores the Yahoo Finance symbol for historic benchmark lookups (e.g. "^FTSE").
  // Populated automatically during historic data backfill.
  const benchmarksCols = database.query("PRAGMA table_info(benchmarks)").all();
  const hasYahooTicker = benchmarksCols.some(function (col) {
    return col.name === "yahoo_ticker";
  });

  if (!hasYahooTicker) {
    database.exec("ALTER TABLE benchmarks ADD COLUMN yahoo_ticker TEXT");
  }

  // Migration 8: Add public_id column to investments (v0.4.0)
  // Stores an ISIN code (e.g. "GB00B4PQW151") for mutual funds, or an
  // exchange:ticker code (e.g. "LSE:AZN") for shares and investment trusts.
  // Used to auto-generate FT Markets pricing URLs without manual URL entry.
  const hasPublicId = investmentsCols.some(function (col) {
    return col.name === "public_id";
  });

  if (!hasPublicId) {
    database.exec("ALTER TABLE investments ADD COLUMN public_id TEXT");
  }

  // Migration 9: Remove test_investments and test_prices tables (no longer needed —
  // test/live database switching makes the scraper testing sandbox redundant).
  const testInvestmentsTable = database.query("SELECT name FROM sqlite_master WHERE type='table' AND name='test_investments'").get();

  if (testInvestmentsTable) {
    database.exec("DROP INDEX IF EXISTS idx_test_prices_lookup");
    database.exec("DROP TABLE IF EXISTS test_prices");
    database.exec("DROP TABLE IF EXISTS test_investments");
  }

  // Migration 10: Add accounts, holdings, cash_transactions and holding_movements tables (v0.6.0)
  // Portfolio hierarchy: users → accounts → holdings, with future transaction tracking.
  const accountsTable = database.query("SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'").get();

  if (!accountsTable) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        account_type TEXT NOT NULL CHECK(account_type IN ('trading', 'isa', 'sipp')),
        account_ref TEXT NOT NULL CHECK(length(account_ref) <= 15),
        cash_balance INTEGER NOT NULL DEFAULT 0,
        warn_cash INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE(user_id, account_type)
      )
    `);
    database.exec("CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id)");

    database.exec(`
      CREATE TABLE IF NOT EXISTS holdings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        investment_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 0,
        average_cost INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (account_id) REFERENCES accounts(id),
        FOREIGN KEY (investment_id) REFERENCES investments(id),
        UNIQUE(account_id, investment_id)
      )
    `);
    database.exec("CREATE INDEX IF NOT EXISTS idx_holdings_account ON holdings(account_id)");
    database.exec("CREATE INDEX IF NOT EXISTS idx_holdings_investment ON holdings(investment_id)");

    database.exec(`
      CREATE TABLE IF NOT EXISTS cash_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        transaction_type TEXT NOT NULL CHECK(transaction_type IN ('deposit', 'withdrawal', 'drawdown', 'adjustment')),
        transaction_date TEXT NOT NULL,
        amount INTEGER NOT NULL,
        notes TEXT CHECK(notes IS NULL OR length(notes) <= 255),
        FOREIGN KEY (account_id) REFERENCES accounts(id)
      )
    `);
    database.exec("CREATE INDEX IF NOT EXISTS idx_cash_transactions_account ON cash_transactions(account_id, transaction_date DESC)");

    database.exec(`
      CREATE TABLE IF NOT EXISTS holding_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        holding_id INTEGER NOT NULL,
        movement_type TEXT NOT NULL CHECK(movement_type IN ('buy', 'sell', 'adjustment')),
        movement_date TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        movement_value INTEGER NOT NULL,
        notes TEXT CHECK(notes IS NULL OR length(notes) <= 255),
        FOREIGN KEY (holding_id) REFERENCES holdings(id)
      )
    `);
    database.exec("CREATE INDEX IF NOT EXISTS idx_holding_movements_holding ON holding_movements(holding_id, movement_date DESC)");

    // Migrate existing user account references into accounts rows.
    // For each user with a trading_ref, isa_ref, or sipp_ref, create the
    // corresponding account row with zero cash balance.
    const users = database.query("SELECT id, trading_ref, isa_ref, sipp_ref FROM users").all();
    const insertAccount = database.query("INSERT INTO accounts (user_id, account_type, account_ref, cash_balance, warn_cash) VALUES (?, ?, ?, 0, 0)");

    for (const user of users) {
      if (user.trading_ref) {
        insertAccount.run(user.id, "trading", user.trading_ref);
      }
      if (user.isa_ref) {
        insertAccount.run(user.id, "isa", user.isa_ref);
      }
      if (user.sipp_ref) {
        insertAccount.run(user.id, "sipp", user.sipp_ref);
      }
    }
  }

  // Migration 12: Add book_cost and deductible_costs columns to holding_movements (v0.8.0)
  // These columns record the cost basis and transaction costs for buy/sell movements.
  const hasBookCost = database.query("SELECT COUNT(*) AS cnt FROM pragma_table_info('holding_movements') WHERE name='book_cost'").get();

  if (hasBookCost.cnt === 0) {
    database.exec("ALTER TABLE holding_movements ADD COLUMN book_cost INTEGER NOT NULL DEFAULT 0");
    database.exec("ALTER TABLE holding_movements ADD COLUMN deductible_costs INTEGER NOT NULL DEFAULT 0");
  }

  // Migration 11: Add drawdown_schedules table (v0.7.0)
  // Recurring SIPP pension withdrawal schedules, processed on app startup.
  const drawdownSchedulesTable = database.query("SELECT name FROM sqlite_master WHERE type='table' AND name='drawdown_schedules'").get();

  if (!drawdownSchedulesTable) {
    database.exec(`
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
      )
    `);
    database.exec("CREATE INDEX IF NOT EXISTS idx_drawdown_schedules_account ON drawdown_schedules(account_id)");
  }

  // Migration 13: Expand cash_transactions CHECK constraint to allow 'buy', 'sell' types (v0.8.0)
  // Buy/sell movements now auto-create matching cash_transaction records for audit trail.
  // SQLite doesn't support ALTER CHECK, so we must recreate the table.
  const ctTableInfo = database.query("SELECT sql FROM sqlite_master WHERE type='table' AND name='cash_transactions'").get();

  if (ctTableInfo && ctTableInfo.sql && !ctTableInfo.sql.includes("'buy'")) {
    database.exec("PRAGMA foreign_keys = OFF");
    database.exec("BEGIN TRANSACTION");
    try {
      database.exec(`
        CREATE TABLE cash_transactions_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id INTEGER NOT NULL,
          transaction_type TEXT NOT NULL CHECK(transaction_type IN ('deposit', 'withdrawal', 'drawdown', 'adjustment', 'buy', 'sell')),
          transaction_date TEXT NOT NULL,
          amount INTEGER NOT NULL,
          notes TEXT CHECK(notes IS NULL OR length(notes) <= 255),
          FOREIGN KEY (account_id) REFERENCES accounts(id)
        )
      `);
      database.exec("INSERT INTO cash_transactions_new SELECT * FROM cash_transactions");
      database.exec("DROP TABLE cash_transactions");
      database.exec("ALTER TABLE cash_transactions_new RENAME TO cash_transactions");
      database.exec("CREATE INDEX IF NOT EXISTS idx_cash_transactions_account ON cash_transactions(account_id, transaction_date DESC)");
      database.exec("COMMIT");
    } catch (err) {
      database.exec("ROLLBACK");
      throw err;
    } finally {
      database.exec("PRAGMA foreign_keys = ON");
    }
  }

  // Migration 14: Add holding_movement_id FK column to cash_transactions (v0.8.0)
  // Links buy/sell cash transactions to their originating holding movement.
  const ctCols = database.query("PRAGMA table_info(cash_transactions)").all();
  const hasHoldingMovementId = ctCols.some(function (col) {
    return col.name === "holding_movement_id";
  });

  if (!hasHoldingMovementId) {
    database.exec("ALTER TABLE cash_transactions ADD COLUMN holding_movement_id INTEGER REFERENCES holding_movements(id)");
  }

  // Migration 15: Add revised_avg_cost column to holding_movements (v0.8.0)
  // Records the new average cost after a buy, for historical display in transactions.
  const hmCols = database.query("PRAGMA table_info(holding_movements)").all();
  const hasRevisedAvgCost = hmCols.some(function (col) {
    return col.name === "revised_avg_cost";
  });

  if (!hasRevisedAvgCost) {
    database.exec("ALTER TABLE holding_movements ADD COLUMN revised_avg_cost INTEGER NOT NULL DEFAULT 0");
  }

  // Migration 16: Add docs_search FTS5 table and metadata table (v0.11.0)
  // Full-text search index for the documentation subsystem.
  try {
    database.query("SELECT * FROM docs_search LIMIT 0").all();
  } catch (e) {
    database.exec("CREATE VIRTUAL TABLE IF NOT EXISTS docs_search USING fts5(" + "category UNINDEXED, slug UNINDEXED, published UNINDEXED, lapse_date UNINDEXED, " + "title, description, h1_content, h2_content, h3_content, h4_h6_content, " + "bold_content, link_text, blockquote_content, body_text, code_content, " + "tokenize='porter unicode61'" + ")");
  }

  database.exec("CREATE TABLE IF NOT EXISTS docs_search_meta (" + "key TEXT PRIMARY KEY, value TEXT" + ")");

  // Migration 17: Add custom_dictionary table (v0.11.0)
  // User-maintained dictionary of words that CSpell should treat as correct.
  // Words are added via the docs editor right-click context menu.
  const customDictTable = database.query("SELECT name FROM sqlite_master WHERE type='table' AND name='custom_dictionary'").get();

  if (!customDictTable) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS custom_dictionary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        word TEXT NOT NULL UNIQUE,
        added_date TEXT NOT NULL
      )
    `);
  }

  // Migration 18: Add auto_fetch column to investments (v0.12.0, renamed from auto_scrape in v0.18.0)
  // Allows excluding investments from automatic price fetching.
  // Default 1 (auto-fetch enabled). Set to 0 for manual-only pricing.
  const invCols18 = database.query("PRAGMA table_info(investments)").all();
  const hasAutoFetch = invCols18.some(function (col) {
    return col.name === "auto_fetch";
  });
  const hasLegacyAutoScrape = invCols18.some(function (col) {
    return col.name === "auto_scrape";
  });

  if (!hasAutoFetch && !hasLegacyAutoScrape) {
    database.exec("ALTER TABLE investments ADD COLUMN auto_fetch INTEGER NOT NULL DEFAULT 1");
  }

  // Migration 19: Add max_attempts column to fetch_history (v0.13.0, table renamed in v0.18.0)
  // Records how many attempts were available for a fetch run, so history
  // shows "succeeded on attempt 2 of 3" or "failed after 3 of 3 attempts".
  // Check whichever table name exists (old or new)
  const historyTableName19 = database.query("SELECT name FROM sqlite_master WHERE type='table' AND name='fetch_history'").get() ? "fetch_history" : "scraping_history";
  const shCols19 = database.query("PRAGMA table_info(" + historyTableName19 + ")").all();
  const hasMaxAttempts = shCols19.some(function (col) {
    return col.name === "max_attempts";
  });

  if (!hasMaxAttempts) {
    database.exec("ALTER TABLE " + historyTableName19 + " ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 1");
  }

  // Migration 20: Clear all cached morningstar_id values (v0.14.0)
  // Previous ticker lookups did not filter by exchange, so cached IDs may
  // point to the wrong exchange listing (e.g. a European AMZN instead of
  // NASDAQ). Clearing forces re-resolution with exchange-aware lookups.
  // Uses a one-time flag: once cleared, the migration is a no-op.
  const hasMorningstarIds = database.query(
    "SELECT COUNT(*) AS cnt FROM investments WHERE morningstar_id IS NOT NULL"
  ).get();
  // Check if this migration has already run by looking for the marker column.
  // We add a trivial column 'ms_id_cleared' to track this one-time reset.
  const investmentsCols20 = database.query("PRAGMA table_info(investments)").all();
  const hasMsIdCleared = investmentsCols20.some(function (col) {
    return col.name === "ms_id_cleared";
  });

  if (!hasMsIdCleared && hasMorningstarIds.cnt > 0) {
    database.exec("UPDATE investments SET morningstar_id = NULL");
    database.exec("ALTER TABLE investments ADD COLUMN ms_id_cleared INTEGER NOT NULL DEFAULT 1");
  } else if (!hasMsIdCleared) {
    // No rows to clear, but still add the marker so this doesn't re-run
    database.exec("ALTER TABLE investments ADD COLUMN ms_id_cleared INTEGER NOT NULL DEFAULT 1");
  }

  // Migration 21: Add other_assets and other_assets_history tables, plus Joint user (v0.15.0)
  // Tracks non-portfolio financial assets (pensions, property, savings, alternative assets).
  const otherAssetsTable = database.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='other_assets'"
  ).get();

  if (!otherAssetsTable) {
    // Insert the Joint user row if it doesn't already exist
    const jointUser = database.query(
      "SELECT id FROM users WHERE first_name = 'Joint' AND last_name = 'Household'"
    ).get();
    if (!jointUser) {
      database.exec(
        "INSERT INTO users (initials, first_name, last_name, provider) VALUES ('JNT', 'Joint', 'Household', '-')"
      );
    }

    database.exec(`
      CREATE TABLE IF NOT EXISTS other_assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        description TEXT NOT NULL CHECK(length(description) <= 40),
        category TEXT NOT NULL CHECK(category IN ('pension', 'property', 'savings', 'alternative')),
        value_type TEXT NOT NULL CHECK(value_type IN ('recurring', 'value')),
        frequency TEXT CHECK(frequency IS NULL OR frequency IN ('weekly', 'fortnightly', '4_weeks', 'monthly', 'quarterly', '6_monthly', 'annually')),
        value INTEGER NOT NULL DEFAULT 0,
        notes TEXT CHECK(notes IS NULL OR length(notes) <= 60),
        executor_reference TEXT CHECK(executor_reference IS NULL OR length(executor_reference) <= 80),
        last_updated TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    database.exec(`
      CREATE TABLE IF NOT EXISTS other_assets_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        other_asset_id INTEGER NOT NULL,
        change_date TEXT NOT NULL,
        revised_value INTEGER NOT NULL,
        revised_notes TEXT CHECK(revised_notes IS NULL OR length(revised_notes) <= 80),
        revised_executor_reference TEXT CHECK(revised_executor_reference IS NULL OR length(revised_executor_reference) <= 80),
        FOREIGN KEY (other_asset_id) REFERENCES other_assets(id) ON DELETE CASCADE
      )
    `);

    database.exec("CREATE INDEX IF NOT EXISTS idx_other_assets_user ON other_assets(user_id)");
    database.exec("CREATE INDEX IF NOT EXISTS idx_other_assets_category ON other_assets(category)");
    database.exec("CREATE INDEX IF NOT EXISTS idx_other_assets_history_asset ON other_assets_history(other_asset_id, change_date DESC)");
  }

  // Migration 22: Add report_params table (v0.16.0)
  // Stores key-value token mappings used for report template substitution.
  // Tokens like "USER1" in user-reports.json are replaced with the
  // corresponding value from this table when reports are loaded.
  const reportParamsTable = database.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='report_params'"
  ).get();

  if (!reportParamsTable) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS report_params (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        param_key TEXT NOT NULL UNIQUE CHECK(length(param_key) <= 30),
        param_value TEXT NOT NULL CHECK(length(param_value) <= 100)
      )
    `);
  }

  // Migration 23: Add scheduler_log table (v0.17.0)
  // Timestamped log entries from the scheduled fetcher for diagnostics.
  const schedulerLogTable = database.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='scheduler_log'"
  ).get();

  if (!schedulerLogTable) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS scheduler_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        log_datetime TEXT NOT NULL,
        level TEXT NOT NULL DEFAULT 'info' CHECK(level IN ('info', 'warn', 'error')),
        message TEXT NOT NULL
      )
    `);
    database.exec(
      "CREATE INDEX IF NOT EXISTS idx_scheduler_log_datetime ON scheduler_log(log_datetime DESC)"
    );
  }

  // Migration 24: Rename scraping_history → fetch_history, auto_scrape → auto_fetch (v0.18.0)
  // Renames the table, columns, and indexes to use "fetch" vocabulary.
  const oldScrapingTable = database.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='scraping_history'"
  ).get();

  if (oldScrapingTable) {
    database.exec("ALTER TABLE scraping_history RENAME TO fetch_history");
    database.exec("ALTER TABLE fetch_history RENAME COLUMN scrape_type TO fetch_type");
    database.exec("ALTER TABLE fetch_history RENAME COLUMN scrape_datetime TO fetch_datetime");
    database.exec("DROP INDEX IF EXISTS idx_scraping_history_datetime");
    database.exec("DROP INDEX IF EXISTS idx_scraping_history_type_ref");
    database.exec("CREATE INDEX IF NOT EXISTS idx_fetch_history_datetime ON fetch_history(fetch_datetime DESC)");
    database.exec("CREATE INDEX IF NOT EXISTS idx_fetch_history_type_ref ON fetch_history(fetch_type, reference_id)");
  }

  const oldAutoScrapeCol = database.query("PRAGMA table_info(investments)").all().some(function (col) {
    return col.name === "auto_scrape";
  });

  if (oldAutoScrapeCol) {
    database.exec("ALTER TABLE investments RENAME COLUMN auto_scrape TO auto_fetch");
  }

  // Migration 26: Add balance_after to cash_transactions (v0.19.0)
  // Stores the running account balance after each transaction, enabling
  // historic cash balance lookups via getCashBalanceAtDate().
  const cashTxCols26 = database.query("PRAGMA table_info(cash_transactions)").all();
  const hasBalanceAfter = cashTxCols26.some(function (col) {
    return col.name === "balance_after";
  });

  if (!hasBalanceAfter) {
    database.exec("ALTER TABLE cash_transactions ADD COLUMN balance_after INTEGER");

    // Backfill: for each account, walk backwards from the current balance
    const accountRows = database.query("SELECT id, cash_balance FROM accounts").all();
    for (const acct of accountRows) {
      // Get all transactions for this account ordered newest-first
      const txns = database.query(
        "SELECT id, transaction_type, amount, notes FROM cash_transactions WHERE account_id = ? ORDER BY transaction_date DESC, id DESC"
      ).all(acct.id);

      if (txns.length === 0) continue;

      // Start from the known current balance and walk backwards
      let runningBalance = acct.cash_balance;
      for (let i = 0; i < txns.length; i++) {
        const txn = txns[i];
        // Set this transaction's balance_after to the running balance
        database.run(
          "UPDATE cash_transactions SET balance_after = ? WHERE id = ?",
          [runningBalance, txn.id]
        );

        // Subtract this transaction's effect to get the balance before it
        // Deposits, sells, and credit adjustments ADD to balance; everything else SUBTRACTS
        const isCreditAdj = txn.transaction_type === "adjustment" && txn.notes && txn.notes.startsWith("[Credit]");
        const addsToBalance = txn.transaction_type === "deposit" || txn.transaction_type === "sell" || isCreditAdj;
        if (addsToBalance) {
          runningBalance -= txn.amount;
        } else {
          runningBalance += txn.amount;
        }
      }
    }
  }

  // Migration 25: Add SCD2 temporal columns to holdings (effective_from, effective_to)
  // Enables historic portfolio composition tracking — each row represents a holding
  // state for a date range. The UNIQUE constraint changes from (account_id, investment_id)
  // to (account_id, investment_id, effective_from).
  const holdingsCols25 = database.query("PRAGMA table_info(holdings)").all();
  const hasEffectiveFrom = holdingsCols25.some(function (col) {
    return col.name === "effective_from";
  });

  if (!hasEffectiveFrom) {
    database.exec("PRAGMA foreign_keys = OFF");
    database.exec("BEGIN TRANSACTION");
    try {
      database.exec(`
        CREATE TABLE holdings_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id INTEGER NOT NULL,
          investment_id INTEGER NOT NULL,
          quantity INTEGER NOT NULL DEFAULT 0,
          average_cost INTEGER NOT NULL DEFAULT 0,
          effective_from TEXT NOT NULL,
          effective_to TEXT,
          FOREIGN KEY (account_id) REFERENCES accounts(id),
          FOREIGN KEY (investment_id) REFERENCES investments(id),
          UNIQUE(account_id, investment_id, effective_from)
        )
      `);

      // Backfill effective_from from earliest movement date, or today if none
      database.exec(`
        INSERT INTO holdings_new (id, account_id, investment_id, quantity, average_cost, effective_from, effective_to)
        SELECT
          h.id, h.account_id, h.investment_id, h.quantity, h.average_cost,
          COALESCE(
            (SELECT MIN(movement_date) FROM holding_movements WHERE holding_id = h.id),
            date('now')
          ),
          NULL
        FROM holdings h
      `);

      database.exec("DROP TABLE holdings");
      database.exec("ALTER TABLE holdings_new RENAME TO holdings");
      database.exec("CREATE INDEX IF NOT EXISTS idx_holdings_account ON holdings(account_id)");
      database.exec("CREATE INDEX IF NOT EXISTS idx_holdings_investment ON holdings(investment_id)");
      database.exec("COMMIT");
    } catch (err) {
      database.exec("ROLLBACK");
      throw err;
    } finally {
      database.exec("PRAGMA foreign_keys = ON");
    }
  }
}

/**
 * @description Create the database file, run the schema SQL to create all
 * tables and indexes, then run the seed SQL to insert initial data
 * (investment types and GBP currency). Ensures the data/ directory exists.
 * If the database already exists, this is a no-op and returns false.
 * @returns {boolean} True if the database was created, false if it already existed
 */
export function createDatabase() {
  if (databaseExists()) {
    return false;
  }

  // Ensure the data/ directory exists
  const dbPath = getResolvedDbPath();
  const dbDir = dirname(dbPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true, mode: 0o700 });
    // Disable btrfs copy-on-write on new directories so SQLite files
    // created inside will inherit the no-CoW attribute
    disableCopyOnWrite(dbDir);
  } else {
    // Ensure existing directory has restrictive permissions
    chmodSync(dbDir, 0o700);
  }

  // Create the database file and configure it
  db = new Database(dbPath);

  // Restrict database file to owner read/write only
  chmodSync(dbPath, 0o600);

  // Btrfs copy-on-write conflicts with SQLite WAL mode
  if (isBtrfs(dbDir)) {
    db.exec("PRAGMA journal_mode = DELETE");
    console.log("[DB] Btrfs detected — using DELETE journal mode");
  } else {
    db.exec("PRAGMA journal_mode = WAL");
  }

  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");

  // Read and execute the schema SQL
  const schemaPath = resolve("src/server/db/schema.sql");
  const schemaSql = readFileSync(schemaPath, "utf-8");
  db.exec(schemaSql);

  // Read and execute the seed SQL
  const seedPath = resolve("src/server/db/seed.sql");
  const seedSql = readFileSync(seedPath, "utf-8");
  db.exec(seedSql);

  // Run migrations so that a freshly created database has the same schema
  // as an existing database that has been migrated over time.
  runMigrations(db);

  return true;
}

/**
 * @description Close the database connection and reset the singleton.
 * Safe to call even if the database is not open.
 */
/**
 * @description Run a WAL checkpoint to flush the write-ahead log back into
 * the main database file. Call this between scraping batches to keep the
 * WAL file small and avoid "disk I/O error" on subsequent database access.
 * Best-effort — errors are logged but not thrown.
 */
export function checkpointDatabase() {
  if (db) {
    try {
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch (err) {
      console.warn("[DB] WAL checkpoint failed:", err.message);
    }
  }
}

export function closeDatabase() {
  if (db) {
    try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch (_) { /* best effort */ }
    db.close();
    db = null;
  }
}

/**
 * @description Get the resolved path to the database file.
 * Useful for backup/restore operations.
 * @returns {string} The absolute path to the database file
 */
export function getDatabasePath() {
  return getResolvedDbPath();
}

/**
 * @description Reset the cached database path so it will be re-evaluated
 * on next access. Used by test mode to switch between live and test
 * reference databases after changing process.env.DB_PATH.
 * Does not close or reopen the database — call closeDatabase() first.
 */
export function resetDatabasePath() {
  resolvedDbPath = null;
}

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { DB_PATH } from "../../shared/constants.js";

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

  db = new Database(getResolvedDbPath());
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

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

  // Migration 5: Add scraping_history table (v0.2.0)
  const scrapingHistoryTable = database.query("SELECT name FROM sqlite_master WHERE type='table' AND name='scraping_history'").get();

  if (!scrapingHistoryTable) {
    database.exec(`
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
      )
    `);
    database.exec("CREATE INDEX IF NOT EXISTS idx_scraping_history_datetime ON scraping_history(scrape_datetime DESC)");
    database.exec("CREATE INDEX IF NOT EXISTS idx_scraping_history_type_ref ON scraping_history(scrape_type, reference_id)");
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

  // Migration 9: Add test_investments and test_prices tables (v0.4.0)
  // Scraper testing sandbox — allows users to test scraper configurations
  // without affecting live portfolio data.
  const testInvestmentsTable = database.query("SELECT name FROM sqlite_master WHERE type='table' AND name='test_investments'").get();

  if (!testInvestmentsTable) {
    database.exec(`
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
      )
    `);

    database.exec(`
      CREATE TABLE IF NOT EXISTS test_prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        test_investment_id INTEGER NOT NULL,
        price_date TEXT NOT NULL,
        price_time TEXT NOT NULL DEFAULT '00:00:00',
        price INTEGER NOT NULL,
        FOREIGN KEY (test_investment_id) REFERENCES test_investments(id) ON DELETE CASCADE,
        UNIQUE(test_investment_id, price_date)
      )
    `);

    database.exec("CREATE INDEX IF NOT EXISTS idx_test_prices_lookup ON test_prices(test_investment_id, price_date DESC)");
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
    mkdirSync(dbDir, { recursive: true });
  }

  // Create the database file and configure it
  db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  // Read and execute the schema SQL
  const schemaPath = resolve("src/server/db/schema.sql");
  const schemaSql = readFileSync(schemaPath, "utf-8");
  db.exec(schemaSql);

  // Read and execute the seed SQL
  const seedPath = resolve("src/server/db/seed.sql");
  const seedSql = readFileSync(seedPath, "utf-8");
  db.exec(seedSql);

  return true;
}

/**
 * @description Close the database connection and reset the singleton.
 * Safe to call even if the database is not open.
 */
export function closeDatabase() {
  if (db) {
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

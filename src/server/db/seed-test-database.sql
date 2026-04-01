-- ============================================================================
-- Test Database Seed Data
-- ============================================================================
-- Creates all reference data for the test database: currencies, investments,
-- benchmarks, users, accounts, holdings, and opening cash transactions.
--
-- Prerequisites:
--   - Database created via createDatabase() (schema.sql + seed.sql applied)
--   - Migrations have run (investment_types, GBP currency already exist)
--
-- Investment types (from seed.sql):
--   id=1 SHARE, id=2 MUTUAL, id=3 TRUST, id=4 SAVINGS, id=5 OTHER
--
-- Usage: Called by seed-test-database.js script
-- ============================================================================

-- ============================================================================
-- CURRENCIES
-- GBP (id=1) already exists from seed.sql
-- ============================================================================

INSERT INTO currencies (code, description) VALUES
    ('USD', 'US Dollar'),
    ('EUR', 'Euro');

-- ============================================================================
-- INVESTMENTS — GBP Mutual Funds (FT Markets via ISIN)
-- auto_fetch defaults to 1; selector NULL = use site config from settings
-- ============================================================================

INSERT INTO investments (currencies_id, investment_type_id, description, public_id) VALUES
    (1, 2, 'Fundsmith Equity I Acc', 'GB00B41YBW71'),
    (1, 2, 'Vanguard LifeStrategy 80% Equity Acc', 'GB00B4PQW151'),
    (1, 2, 'Vanguard FTSE Global All Cap Index', 'GB00BD3RZ582'),
    (1, 2, 'Fidelity Index World P Acc', 'GB00BJS8SJ34'),
    (1, 2, 'L&G Global Technology Index C Acc', 'GB00BJLP1W53'),
    (1, 2, 'Rathbone Global Opportunities S Acc', 'GB00BH0P2M97'),
    (1, 2, 'Baillie Gifford American B Acc', 'GB0006061963'),
    (1, 2, 'Jupiter Gold & Silver L Acc', 'IE00BYVJRB33');

-- ============================================================================
-- INVESTMENTS — GBP Shares (FT Markets via ticker)
-- ============================================================================

INSERT INTO investments (currencies_id, investment_type_id, description, public_id) VALUES
    (1, 1, 'Rolls-Royce Holdings PLC', 'LSE:RR.'),
    (1, 1, 'BAE Systems PLC', 'LSE:BA.'),
    (1, 1, 'AstraZeneca PLC', 'LSE:AZN'),
    (1, 1, 'Shell PLC', 'LSE:SHEL'),
    (1, 1, 'Raspberry Pi Holdings PLC', 'LSE:RPI'),
    (1, 1, 'Barclays PLC', 'LSE:BARC'),
    (1, 1, 'Legal & General Group PLC', 'LSE:LGEN');

-- ============================================================================
-- INVESTMENTS — GBP Investment Trusts (FT Markets via ticker)
-- ============================================================================

INSERT INTO investments (currencies_id, investment_type_id, description, public_id) VALUES
    (1, 3, 'Polar Capital Technology Trust', 'LSE:PCT');

-- ============================================================================
-- INVESTMENTS — USD Shares (FT Markets via ticker)
-- ============================================================================

INSERT INTO investments (currencies_id, investment_type_id, description, public_id) VALUES
    (2, 1, 'NVIDIA Corp', 'NSQ:NVDA'),
    (2, 1, 'Microsoft Corp', 'NSQ:MSFT'),
    (2, 1, 'Alphabet Inc Class C', 'NSQ:GOOG'),
    (2, 1, 'Amazon.com Inc', 'NSQ:AMZN'),
    (2, 1, 'Berkshire Hathaway Class B', 'NYQ:BRK.B');

-- ============================================================================
-- INVESTMENTS — EUR Shares (FT Markets via ticker)
-- ============================================================================

INSERT INTO investments (currencies_id, investment_type_id, description, public_id) VALUES
    (3, 1, 'ASML Holding NV', 'AEX:ASML');

-- ============================================================================
-- INVESTMENT MORNINGSTAR IDs
-- Pre-resolved Morningstar security identifiers (secId|universe) so the
-- fetch-server sync can map prices without hitting the Morningstar API.
-- ============================================================================

UPDATE investments SET morningstar_id = 'F00000LK2Q|FOEUR$$ALL_3521' WHERE public_id = 'GB00B41YBW71';
UPDATE investments SET morningstar_id = 'F00000MLUQ|FOEUR$$ALL_3521' WHERE public_id = 'GB00B4PQW151';
UPDATE investments SET morningstar_id = 'F00000XXVV|FOEUR$$ALL_3521' WHERE public_id = 'GB00BD3RZ582';
UPDATE investments SET morningstar_id = 'F00000SRPN|FOEUR$$ALL_3521' WHERE public_id = 'GB00BJS8SJ34';
UPDATE investments SET morningstar_id = 'F00001275X|FOEUR$$ALL_3521' WHERE public_id = 'GB00BJLP1W53';
UPDATE investments SET morningstar_id = 'F000011RP0|FOEUR$$ALL_3521' WHERE public_id = 'GB00BH0P2M97';
UPDATE investments SET morningstar_id = 'F0GBR0506U|FOEUR$$ALL_3521' WHERE public_id = 'GB0006061963';
UPDATE investments SET morningstar_id = 'F00000WWH3|FOGBR$$ALL' WHERE public_id = 'IE00BYVJRB33';
UPDATE investments SET morningstar_id = '0P00007OU0|E0EXG$XLON_3520' WHERE public_id = 'LSE:RR.';
UPDATE investments SET morningstar_id = '0P000094GI|E0EXG$XLON_3520' WHERE public_id = 'LSE:BA.';
UPDATE investments SET morningstar_id = '0P00007NYP|E0EXG$XLON_3520' WHERE public_id = 'LSE:AZN';
UPDATE investments SET morningstar_id = '0P00007OU3|E0EXG$XLON_3520' WHERE public_id = 'LSE:SHEL';
UPDATE investments SET morningstar_id = '0P0001T3HZ|E0EXG$XLON_3520' WHERE public_id = 'LSE:RPI';
UPDATE investments SET morningstar_id = '0P00007NZP|E0EXG$XLON_3520' WHERE public_id = 'LSE:BARC';
UPDATE investments SET morningstar_id = '0P00007OJS|E0EXG$XLON_3520' WHERE public_id = 'LSE:LGEN';
UPDATE investments SET morningstar_id = 'E0GBR00VIE|CEEXG$XLON_3519' WHERE public_id = 'LSE:PCT';
UPDATE investments SET morningstar_id = '0P000003RE|E0EXG$XNASDAQ_3520' WHERE public_id = 'NSQ:NVDA';
UPDATE investments SET morningstar_id = '0P000003MH|E0EXG$XNASDAQ_3520' WHERE public_id = 'NSQ:MSFT';
UPDATE investments SET morningstar_id = '0P00012BBI|E0EXG$XNASDAQ_3520' WHERE public_id = 'NSQ:GOOG';
UPDATE investments SET morningstar_id = '0P000000B7|E0EXG$XNASDAQ_3520' WHERE public_id = 'NSQ:AMZN';
UPDATE investments SET morningstar_id = '0P000000RD|E0EXG$XNYSE_3520' WHERE public_id = 'NYQ:BRK.B';
UPDATE investments SET morningstar_id = '0P0000ALDL|E0EXG$XEURONEXT_3520' WHERE public_id = 'AEX:ASML';

-- ============================================================================
-- BENCHMARKS
-- All use FT Markets with auto-detected selectors from site config.
-- yahoo_ticker pre-resolved for fetch-server sync and historic backfill.
-- ============================================================================

INSERT INTO benchmarks (currencies_id, benchmark_type, description, benchmark_url, selector, yahoo_ticker) VALUES
    (1, 'index', 'FTSE 100',
     'https://www.google.com/finance/quote/UKX:INDEXFTSE', NULL, '^FTSE'),
    (1, 'index', 'FTSE 250',
     'https://www.google.com/finance/quote/MCX:INDEXFTSE', NULL, '^FTMC'),
     (1, 'index', 'FTSE All Share',
      'https://www.google.com/finance/quote/ASX:INDEXFTSE', NULL, '^FTAS'),
    (2, 'index', 'S&P 500',
     'https://www.google.com/finance/quote/INX:INDEXSP', NULL, '^GSPC'),
    (2, 'index', 'Dow Jones',
     'https://www.google.com/finance/quote/DJI:INDEXDJX', NULL, '^DJI'),
     (2, 'index', 'Nasdaq',
      'https://www.google.com/finance/quote/IXIC:INDEXNASDAQ', NULL, '^IXIC');

-- ============================================================================
-- USERS
-- Joint (id=1) already exists from seed.sql.
-- Two family members, both with Interactive Investor (ii) accounts.
-- NI numbers and UTRs are fictitious test data.
-- User IDs: Joint=1, Ben=2, Alexis=3
-- ============================================================================

INSERT INTO users (initials, first_name, last_name, ni_number, utr, provider, trading_ref, isa_ref, sipp_ref) VALUES
    ('BW', 'Ben',    'Wilson', 'YP439593D', '1023143571', 'ii', '3366524', '3366527', '3366521'),
    ('AW', 'Alexis', 'Wilson', 'XP275366T', '1044722194', 'ii', '3633173', '3633174', '3633175');

-- ============================================================================
-- ACCOUNTS
-- Each user has trading, ISA and SIPP accounts.
-- cash_balance and warn_cash are stored as GBP × 10000.
-- ============================================================================

INSERT INTO accounts (user_id, account_type, account_ref, cash_balance, warn_cash) VALUES
    (2, 'sipp',    '3366521', 48500000, 20000000),
    (2, 'isa',     '3366527',  9857500,  1500000),
    (2, 'trading', '3366524', 17500000,  1500000),
    (3, 'sipp',    '3633175', 36540000, 16000000),
    (3, 'trading', '3633173',  2140000,  1500000),
    (3, 'isa',     '3633174',  7880000,  1500000);

-- ============================================================================
-- HOLDINGS
-- Links accounts to investments. quantity and average_cost are × 10000.
-- Investment IDs are sequential from id=1 (first INSERT block above).
--
-- Investment ID reference (from INSERT order above):
--   1  = Fundsmith Equity I Acc
--   2  = Vanguard LifeStrategy 80% Equity Acc
--   3  = Vanguard FTSE Global All Cap Index
--   4  = Fidelity Index World P Acc
--   5  = L&G Global Technology Index C Acc
--   6  = Rathbone Global Opportunities S Acc
--   7  = Baillie Gifford American B Acc
--   8  = Jupiter Gold & Silver L Acc
--   9  = Rolls-Royce Holdings PLC
--  10  = BAE Systems PLC
--  11  = AstraZeneca PLC
--  12  = Shell PLC
--  13  = Raspberry Pi Holdings PLC
--  14  = Barclays PLC
--  15  = Legal & General Group PLC
--  16  = Polar Capital Technology Trust
--  17  = NVIDIA Corp
--  18  = Microsoft Corp
--  19  = Alphabet Inc Class C
--  20  = Amazon.com Inc
--  21  = Berkshire Hathaway Class B
--  22  = ASML Holding NV
-- ============================================================================

-- Ben SIPP (account 1): VG Global All Cap, VG LifeStrategy, Rathbone, BG American
INSERT INTO holdings (account_id, investment_id, quantity, average_cost, effective_from)
SELECT 1,  3,   6250000,  372600, date('now', '-36 months') UNION ALL
SELECT 1,  2,   3500000,  294500, date('now', '-36 months') UNION ALL
SELECT 1,  6,   13750000,   19100, date('now', '-36 months') UNION ALL
SELECT 1,  7,  27500000,  132700, date('now', '-36 months');

-- Ben ISA (account 2): Fidelity Index World, Jupiter Gold & Silver, Polar Capital Tech
INSERT INTO holdings (account_id, investment_id, quantity, average_cost, effective_from)
SELECT 2,  4,  13750000,  31500, date('now', '-36 months') UNION ALL
SELECT 2,  8,   4550000, 357200, date('now', '-36 months') UNION ALL
SELECT 2, 16,  59000000,  49200, date('now', '-36 months');

-- Ben Trading (account 3): Alphabet, NVIDIA, Microsoft
INSERT INTO holdings (account_id, investment_id, quantity, average_cost, effective_from)
SELECT 3, 19,  1800000,  649870, date('now', '-36 months') UNION ALL
SELECT 3, 17,  1050000,  150990, date('now', '-36 months') UNION ALL
SELECT 3, 18, 1250000, 1045100, date('now', '-36 months');

-- Alexis SIPP (account 4): VG LifeStrategy, L&G Tech, Fidelity Index World
INSERT INTO holdings (account_id, investment_id, quantity, average_cost, effective_from)
SELECT 4,  2,   4150000,  163500, date('now', '-36 months') UNION ALL
SELECT 4,  5, 132400000,   16480, date('now', '-36 months') UNION ALL
SELECT 4,  4, 114550000,   31100, date('now', '-36 months');

-- Alexis Trading (account 5): Polar Capital Tech, Amazon, BG American
INSERT INTO holdings (account_id, investment_id, quantity, average_cost, effective_from)
SELECT 5, 16, 75650000,  35100, date('now', '-36 months') UNION ALL
SELECT 5, 20,   5150000, 359280, date('now', '-36 months') UNION ALL
SELECT 5,  7,  36000000, 118500, date('now', '-36 months');

-- Alexis ISA (account 6): Jupiter Gold & Silver, Rathbone, VG Global All Cap
INSERT INTO holdings (account_id, investment_id, quantity, average_cost, effective_from)
SELECT 6,  8,   4170000, 363700, date('now', '-36 months') UNION ALL
SELECT 6,  6, 65000000,  19300, date('now', '-36 months') UNION ALL
SELECT 6,  3,   4900000, 352800, date('now', '-36 months');

-- ============================================================================
-- CASH TRANSACTIONS — Opening balance deposits
-- ============================================================================

INSERT INTO cash_transactions (account_id, transaction_type, transaction_date, amount, notes, balance_after) VALUES
    (1, 'adjustment', '2026-03-02', 48500000, 'Opening balance', 48500000),
    (2, 'adjustment', '2026-03-02',  9857500, 'Opening balance',  9857500),
    (3, 'adjustment', '2026-03-02', 17500000, 'Opening balance', 17500000),
    (4, 'adjustment', '2026-03-02', 36540000, 'Opening balance', 36540000),
    (5, 'adjustment', '2026-03-02',  2140000, 'Opening balance',  2140000),
    (6, 'adjustment', '2026-03-02',  7880000, 'Opening balance',  7880000);

-- ============================================================================
-- OTHER ASSETS
-- Non-portfolio financial assets: pensions, property, savings, alternatives.
-- User IDs: Joint=1, Ben=2, Alexis=3
-- value is stored as GBP × 10000.
-- ============================================================================

INSERT INTO other_assets (user_id, description, category, value_type, frequency, value, notes, executor_reference, last_updated) VALUES
    (3, 'State Pension',           'pension', 'recurring', '4_weeks',    8450000, NULL, NULL, '2026-05-01'),
    (2, 'State Pension',           'pension', 'recurring', '4_weeks',    9740000, NULL, NULL, '2026-05-01'),
    (3, 'NHS Pension',             'pension', 'recurring', 'monthly',   10240000, NULL, NULL, '2026-03-01'),
    (2, 'Scottish Widows Annuity', 'pension', 'recurring', 'monthly',    6000000, 'Fixed, 50% spouse', 'Policy SW/2013-45671', '2026-01-01'),
    (3, 'SIPP Income',            'pension', 'recurring', 'annually',  30000000, NULL, NULL, '2026-01-01'),
    (2, 'SIPP Income',            'pension', 'recurring', 'annually',  50000000, NULL, NULL, '2026-01-01'),
    (1, '12 Primrose Av',         'property', 'value', NULL, 4450000000, NULL, NULL, '2024-01-01'),
    (1, 'Cars',                   'property', 'value', NULL,  250000000, NULL, NULL, '2026-01-01'),
    (2, 'Barclays Saving A/c',    'savings', 'value', NULL,   37500000, NULL, NULL, '2026-03-01'),
    (3, 'Premium Bonds',          'savings', 'value', NULL,   25000000, NULL, NULL, '2010-12-01');

-- ============================================================================
-- REPORT PARAMS
-- Token mappings for report template substitution in user-reports.json.
-- ============================================================================
INSERT INTO report_params (param_key, param_value) VALUES
    ('USER1', 'BW'),
    ('USER2', 'AW');

-- ============================================================================
-- GLOBAL EVENTS
-- Sample entries
-- ============================================================================
INSERT INTO global_events (event_date, description) VALUES
    ('2025-04-01', 'US Tarrifs start'),
    ('2026-03-01', 'Iran conflict');

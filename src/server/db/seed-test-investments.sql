-- Seed data for test_investments table (v0.4.0 Phase B)
-- Combines Top 50 UK Funds (ISIN-based FT Markets testing) with live portfolio
-- investments across multiple pricing sources.
--
-- This script performs a clean reset of all test-related data:
--   1. Deletes scraping_history entries from test investment scrapes (started_by = 3)
--   2. Deletes all test_prices (cascade would handle this, but explicit is clearer)
--   3. Deletes all test_investments
--   4. Re-inserts the standard test data set
--   5. Copies current live investments into test_investments
--
-- Prerequisites:
--   - Database must have test_investments table (migration 9)
--   - currencies table must have GBP (id=1) and USD (id=2)
--   - investment_types must have MUTUAL (id=2), SHARE (id=1), TRUST (id=3)
--
-- Usage: bun scripts/seed-test-investments.js

-- ============================================================================
-- CLEANUP: Remove all test-related data for a clean slate
-- ============================================================================

-- Remove scraping history from test investment scrapes (started_by = 3)
DELETE FROM scraping_history WHERE started_by = 3;

-- Remove all test prices (also handled by CASCADE on test_investments delete,
-- but explicit delete is clearer and avoids relying on cascade order)
DELETE FROM test_prices;

-- Remove all test investments
DELETE FROM test_investments;

-- ============================================================================
-- SECTION 1: Top 50 UK Retail Funds 2025 — FT Markets (Funds) via ISIN
-- Tests auto-URL generation from public_id for mutual funds.
-- ISINs manually verified against FT Markets tearsheet pages.
-- ============================================================================

INSERT INTO test_investments (currencies_id, investment_type_id, description, public_id, source_site, notes) VALUES
(1, 2, 'Vanguard LifeStrategy 80% Equity Acc', 'GB00B4PQW151', 'FT Markets (Funds)', 'Top 50 UK fund #1'),
(1, 2, 'Vanguard FTSE Global All Cap Index', 'GB00BD3RZ582', 'FT Markets (Funds)', 'Top 50 UK fund #2'),
(1, 2, 'HSBC FTSE 250 Index Acc', 'GB00BV8VN686', 'FT Markets (Funds)', 'Top 50 UK fund #3'),
(1, 2, 'Vanguard LifeStrategy 100% Equity Acc', 'GB00B41XG308', 'FT Markets (Funds)', 'Top 50 UK fund #4'),
(1, 2, 'Fidelity Index World Class P Acc', 'GB00BJS8SJ34', 'FT Markets (Funds)', 'Top 50 UK fund #5'),
(1, 2, 'Royal London Short Term Money Market Y Acc', 'GB00B8XYYQ86', 'FT Markets (Funds)', 'Top 50 UK fund #6'),
(1, 2, 'Artemis Global Income Class I Acc', 'GB00B5ZX1M70', 'FT Markets (Funds)', 'Top 50 UK fund #7'),
(1, 2, 'L&G Global Technology Index Trust C Acc', 'GB00BJLP1W53', 'FT Markets (Funds)', 'Top 50 UK fund #8'),
(1, 2, 'Fundsmith Equity Class I Acc', 'GB00B41YBW71', 'FT Markets (Funds)', 'Top 50 UK fund #9'),
(1, 2, 'Vanguard LifeStrategy 60% Equity Acc', 'GB00B3TYHH97', 'FT Markets (Funds)', 'Top 50 UK fund #10'),
(1, 2, 'Fidelity Special Situations Class W Acc', 'GB00B88V3X40', 'FT Markets (Funds)', 'Top 50 UK fund #11'),
(1, 2, 'Fidelity Global Technology Class W Acc', 'LU1033663649', 'FT Markets (Funds)', 'Top 50 UK fund #12 — LU domicile'),
(1, 2, 'Legal & General UK Index Class C Acc', 'GB00BG0QPJ30', 'FT Markets (Funds)', 'Top 50 UK fund #13'),
(1, 2, 'Fidelity Index US Class P Acc', 'GB00BJS8SH10', 'FT Markets (Funds)', 'Top 50 UK fund #14'),
(1, 2, 'UBS S&P 500 Index Class C Acc', 'GB00BMN91T34', 'FT Markets (Funds)', 'Top 50 UK fund #15'),
(1, 2, 'Fidelity Cash Class W Acc', 'GB00BD1RHT82', 'FT Markets (Funds)', 'Top 50 UK fund #16'),
(1, 2, 'Vanguard FTSE 100 Index Unit Trust Acc', 'GB00BD3RZ368', 'FT Markets (Funds)', 'Top 50 UK fund #17'),
(1, 2, 'Artemis SmartGARP European Equity I Acc', 'GB00B2PLJD73', 'FT Markets (Funds)', 'Top 50 UK fund #18'),
(1, 2, 'Jupiter Gold & Silver Fund Class L Acc', 'IE00BYVJRB33', 'FT Markets (Funds)', 'Top 50 UK fund #19 — IE domicile'),
(1, 2, 'WS Blue Whale Growth Class I Acc', 'GB00BD6PG563', 'FT Markets (Funds)', 'Top 50 UK fund #20'),
(1, 2, 'AJ Bell Adventurous Class I Acc', 'GB00BYW8VG25', 'FT Markets (Funds)', 'Top 50 UK fund #21'),
(1, 2, 'AJ Bell Moderately Adventurous Class I Acc', 'GB00BYW8VL77', 'FT Markets (Funds)', 'Top 50 UK fund #22'),
(1, 2, 'AJ Bell Balanced Class I Acc', 'GB00BYW8RX12', 'FT Markets (Funds)', 'Top 50 UK fund #23'),
(1, 2, 'AJ Bell Global Growth Class I Acc', 'GB00BD833W40', 'FT Markets (Funds)', 'Top 50 UK fund #24'),
(1, 2, 'Vanguard Sterling Short-Term Money Mkt A Acc', 'GB00BFYDWM59', 'FT Markets (Funds)', 'Top 50 UK fund #25'),
(1, 2, 'Artemis US Smaller Companies Class I Acc', 'GB00BMMV5766', 'FT Markets (Funds)', 'Top 50 UK fund #26'),
(1, 2, 'Baillie Gifford Monthly Income Class B Acc', 'GB00BFXY2964', 'FT Markets (Funds)', 'Top 50 UK fund #27'),
(1, 2, 'Invesco Tactical Bond Class Z Acc', 'GB00B8N45T82', 'FT Markets (Funds)', 'Top 50 UK fund #28'),
(1, 2, 'L&G Future World ESG Tilted Dev Index', 'GB00BYWQWW93', 'FT Markets (Funds)', 'Top 50 UK fund #29'),
(1, 2, 'Troy Trojan Global Income Class O Acc', 'GB00BD82KP33', 'FT Markets (Funds)', 'Top 50 UK fund #30'),
(1, 2, 'M&G Global Emerging Markets Class I Acc', 'GB00B3FFXX47', 'FT Markets (Funds)', 'Top 50 UK fund #31'),
(1, 2, 'M&G Asian Class I Acc', 'GB00B6SQYF47', 'FT Markets (Funds)', 'Top 50 UK fund #32'),
(1, 2, 'Schroder Asian Alpha Plus Class L Acc', 'GB00BDD27J12', 'FT Markets (Funds)', 'Top 50 UK fund #33'),
(1, 2, 'FSSA Asia Focus Class B Acc', 'GB00BWNGXJ86', 'FT Markets (Funds)', 'Top 50 UK fund #34'),
(1, 2, 'Invesco Global Emerging Markets Class Z Acc', 'GB00B8N46731', 'FT Markets (Funds)', 'Top 50 UK fund #35'),
(1, 2, 'Rathbone Ethical Bond Class S Acc', 'GB00BDD0RN99', 'FT Markets (Funds)', 'Top 50 UK fund #36'),
(1, 2, 'Polar Capital Biotechnology Class I Inc', 'IE00B42P0H75', 'FT Markets (Funds)', 'Top 50 UK fund #37 — IE domicile'),
(1, 2, 'Liontrust Sustainable Future UK Growth', 'GB0030028764', 'FT Markets (Funds)', 'Top 50 UK fund #38'),
(1, 2, 'Rathbone Global Opportunities Class S Acc', 'GB00BH0P2M97', 'FT Markets (Funds)', 'Top 50 UK fund #39'),
(1, 2, 'Baillie Gifford American Class B Acc', 'GB0006061963', 'FT Markets (Funds)', 'Top 50 UK fund #40'),
(1, 2, 'Fidelity European Class W Acc', 'GB00BFRT3504', 'FT Markets (Funds)', 'Top 50 UK fund #41'),
(1, 2, 'BNY Mellon Global Income Class U Acc', 'GB00BLG2W994', 'FT Markets (Funds)', 'Top 50 UK fund #42'),
(1, 2, 'JP Morgan Global Equity Income ETF', 'IE0003UVYC20', 'FT Markets (Funds)', 'Top 50 UK fund #43 — IE domicile'),
(1, 2, 'Stewart Inv Asia Pacific Leaders B Acc', 'GB0033874768', 'FT Markets (Funds)', 'Top 50 UK fund #44'),
(1, 2, 'Schroder Global Recovery Class L Acc', 'GB00BYRJXP30', 'FT Markets (Funds)', 'Top 50 UK fund #45'),
(1, 2, 'Man Income Fund Class C Acc', 'GB00B0117C28', 'FT Markets (Funds)', 'Top 50 UK fund #46'),
(1, 2, 'Baillie Gifford Global Discovery B Acc', 'GB0006059330', 'FT Markets (Funds)', 'Top 50 UK fund #47'),
(1, 2, 'First Sentier Global Listed Infra B Acc', 'GB00B24HJL45', 'FT Markets (Funds)', 'Top 50 UK fund #48'),
(1, 2, 'Polar Capital Global Technology I Inc GBP', 'IE00B42W4J83', 'FT Markets (Funds)', 'Top 50 UK fund #49 — IE domicile'),
(1, 2, 'L&G Cash Trust Class I Inc', 'GB00BJKGG240', 'FT Markets (Funds)', 'Top 50 UK fund #50');

-- ============================================================================
-- SECTION 2: Live portfolio funds — Fidelity UK source
-- Tests the existing Fidelity scraping configuration
-- ============================================================================

INSERT INTO test_investments (currencies_id, investment_type_id, description, public_id, investment_url, selector, source_site, notes) VALUES
(1, 2, 'Fundsmith Equity I Acc (Fidelity)', 'GB00B41YBW71', 'https://www.fidelity.co.uk/factsheet-data/factsheet/GB00B41YBW71-fundsmith-equity-fund-i-class-acc/performance', NULL, 'Fidelity UK', 'Live fund — compare with FT Markets ISIN result'),
(1, 2, 'Rathbone Global Opps I Acc (Fidelity)', 'GB00B7FQLN12', 'https://www.fidelity.co.uk/factsheet-data/factsheet/GB00B7FQLN12-rathbone-global-opportunities-inst-acc/performance', NULL, 'Fidelity UK', 'Live fund — compare with FT Markets ISIN result'),
(1, 2, 'Stewart Inv APAC Leaders (Fidelity)', 'GB0033874768', 'https://www.fidelity.co.uk/factsheet-data/factsheet/GB0033874768-stewart-inv-asia-pacific-leaders-b-acc/key-statistics', NULL, 'Fidelity UK', 'Live fund — compare with FT Markets ISIN result'),
(1, 2, 'WS Lindsell Train UK Equity Acc (Fid)', 'GB00B18B9X76', 'https://www.fidelity.co.uk/factsheet-data/factsheet/GB00B18B9X76-ws-lindsell-train-uk-equity-fund-acc/key-statistics', NULL, 'Fidelity UK', 'Live fund — compare with FT Markets ISIN result'),
(1, 2, 'CT European Select Z Acc (Fidelity)', 'GB00B8BC5H23', 'https://www.fidelity.co.uk/factsheet-data/factsheet/GB00B8BC5H23-ct-european-select-rdr-z-acc/key-statistics', NULL, 'Fidelity UK', 'Live fund'),
(1, 2, 'Jupiter European I Acc (Fidelity)', 'GB00B5STJW84', 'https://www.fidelity.co.uk/factsheet-data/factsheet/GB00B5STJW84-jupiter-european-fund-i-class-acc/key-statistics', NULL, 'Fidelity UK', 'Live fund');

-- ============================================================================
-- SECTION 3: Live portfolio shares — LSE source
-- Tests London Stock Exchange scraping for GBP shares and trusts
-- ============================================================================

INSERT INTO test_investments (currencies_id, investment_type_id, description, public_id, investment_url, selector, source_site, notes) VALUES
(1, 1, 'Polar Capital Technology Ord (LSE)', 'LSE:PCT', 'https://www.londonstockexchange.com/stock/PCT/polar-capital-technology-trust-plc/company-page', NULL, 'London Stock Exchange (Stocks)', 'Live share — compare with FT Markets ticker result'),
(1, 1, 'Raspberry Pi Holdings (LSE)', 'LSE:RPI', 'https://www.londonstockexchange.com/stock/RPI/raspberry-pi-holdings-plc/company-page', NULL, 'London Stock Exchange (Stocks)', 'Live share — compare with FT Markets ticker result'),
(1, 3, 'Smithson Investment Trust (LSE)', 'LSE:SSON', 'https://www.londonstockexchange.com/stock/SSON/smithson-investment-trust-plc/company-page', NULL, 'London Stock Exchange (Stocks)', 'Live trust — compare with FT Markets ticker result');

-- ============================================================================
-- SECTION 4: Live portfolio shares — FT Markets (Equities) via ticker
-- Tests auto-URL generation from public_id for equities
-- ============================================================================

INSERT INTO test_investments (currencies_id, investment_type_id, description, public_id, source_site, notes) VALUES
(1, 1, 'Polar Capital Technology (FT Markets)', 'LSE:PCT', 'FT Markets (Equities)', 'Same as LSE source — compare prices'),
(1, 1, 'Raspberry Pi Holdings (FT Markets)', 'LSE:RPI', 'FT Markets (Equities)', 'Same as LSE source — compare prices'),
(1, 3, 'Smithson Investment Trust (FT Markets)', 'LSE:SSON', 'FT Markets (Equities)', 'Same as LSE source — compare prices');

-- ============================================================================
-- SECTION 5: Live US shares — Fidelity UK source (USD)
-- Tests Fidelity scraping for USD-denominated shares
-- ============================================================================

INSERT INTO test_investments (currencies_id, investment_type_id, description, public_id, investment_url, selector, source_site, notes) VALUES
(2, 1, 'Amazon (Fidelity)', NULL, 'https://www.fidelity.co.uk/factsheet-data/factsheet/US0231351067USD-amazon-com-inc/price-chart', NULL, 'Fidelity UK', 'Live USD share — Fidelity equity factsheet'),
(2, 1, 'Google GOOG (Fidelity)', NULL, 'https://www.fidelity.co.uk/factsheet-data/factsheet/US02079K1079-alphabet-inc/key-statistics', NULL, 'Fidelity UK', 'Live USD share — Fidelity equity factsheet'),
(2, 1, 'Microsoft (Fidelity)', NULL, 'https://www.fidelity.co.uk/factsheet-data/factsheet/US5949181045USD-microsoft-corp/price-chart', NULL, 'Fidelity UK', 'Live USD share — Fidelity equity factsheet'),
(2, 1, 'Nvidia (Fidelity)', NULL, 'https://www.fidelity.co.uk/factsheet-data/factsheet/US67066G1040USD-nvidia-corp/price-chart', NULL, 'Fidelity UK', 'Live USD share — Fidelity equity factsheet');



-- ============================================================================
-- SECTION 7: Google Finance source — tests Google Finance scraping
-- ============================================================================

INSERT INTO test_investments (currencies_id, investment_type_id, description, investment_url, selector, source_site, notes) VALUES
(1, 1, 'Polar Capital Technology (Google)', 'https://www.google.com/finance/quote/PCT:LON', '.fxKbKc', 'Google Finance', 'Google Finance for LSE-listed trusts — compare with LSE/FT');

-- ============================================================================
-- SECTION 8: Copy of current live investments
-- Mirrors the live investments table so every real portfolio investment
-- can also be tested in the sandbox. Source site set to 'Live Portfolio'
-- to distinguish from the hard-coded test entries above.
-- ============================================================================

INSERT INTO test_investments (currencies_id, investment_type_id, description, public_id, investment_url, selector, source_site, notes)
SELECT
  i.currencies_id,
  i.investment_type_id,
  i.description,
  i.public_id,
  i.investment_url,
  i.selector,
  'Live Portfolio',
  'Copied from live investments table'
FROM investments i;

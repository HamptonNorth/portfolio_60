-- ============================================================================
-- Test Database — Historic Holding Changes
-- ============================================================================
-- Adds SCD2 history to the seeded holdings to simulate portfolio changes
-- over the past 36 months. Run AFTER seed-test-database.sql and Fetch All.
--
-- For each change:
--   1. Close the existing active row (set effective_to)
--   2. Insert a new row with the updated values
--
-- Quantities and average costs are stored as × 10000.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Alexis ISA (account 6), Jupiter Gold & Silver (inv 8) — Buy 200 at 24m ago
-- Original: qty=417, avg_cost=36.37
-- New:      qty=617, avg_cost=38.78
-- ----------------------------------------------------------------------------
UPDATE holdings SET effective_to = date('now', '-24 months')
  WHERE account_id = 6 AND investment_id = 8 AND effective_to IS NULL;

INSERT INTO holdings (account_id, investment_id, quantity, average_cost, effective_from)
  SELECT 6, 8, 6170000, 387800, date('now', '-24 months');

-- ----------------------------------------------------------------------------
-- Alexis ISA (account 6), VG Global All Cap (inv 3) — Sell, qty reduces to 200 at 24m ago
-- Original: qty=490, avg_cost=35.28
-- New:      qty=200, avg_cost=36.40
-- ----------------------------------------------------------------------------
UPDATE holdings SET effective_to = date('now', '-24 months')
  WHERE account_id = 6 AND investment_id = 3 AND effective_to IS NULL;

INSERT INTO holdings (account_id, investment_id, quantity, average_cost, effective_from)
  SELECT 6, 3, 2000000, 364000, date('now', '-24 months');

-- ----------------------------------------------------------------------------
-- Alexis ISA (account 6), Raspberry Pi Holdings (inv 13) — New holding, buy 50 at 6m ago
-- No existing row to close — this is a brand new holding in this account
-- ----------------------------------------------------------------------------
INSERT INTO holdings (account_id, investment_id, quantity, average_cost, effective_from)
  SELECT 6, 13, 500000, 39800, date('now', '-6 months');

-- ----------------------------------------------------------------------------
-- Alexis Trading (account 5), Polar Capital Tech (inv 16) — Sell 3000 at 12m ago
-- Original: qty=7565, avg_cost=3.51
-- New:      qty=4565, avg_cost=286.50
-- ----------------------------------------------------------------------------
UPDATE holdings SET effective_to = date('now', '-12 months')
  WHERE account_id = 5 AND investment_id = 16 AND effective_to IS NULL;

INSERT INTO holdings (account_id, investment_id, quantity, average_cost, effective_from)
  SELECT 5, 16, 45650000, 2865000, date('now', '-12 months');

-- ----------------------------------------------------------------------------
-- Alexis Trading (account 5), VG LifeStrategy 80% (inv 2) — New holding, buy 600 at 12m ago
-- No existing row to close — this is a brand new holding in this account
-- ----------------------------------------------------------------------------
INSERT INTO holdings (account_id, investment_id, quantity, average_cost, effective_from)
  SELECT 5, 2, 6000000, 294100, date('now', '-12 months');

# Plan v0.8.0 — Buy and Sell Transactions

## Overview

Add the ability to buy and sell holdings from the portfolio detail view. A buy uses cash from the account to increase a holding's quantity and recalculates the average cost. A sell reduces the holding quantity and returns cash to the account. Both record a movement in the `holding_movements` table.

---

## Clarifications (Resolved)

1. **Deductible costs on Buy**: Full Total Consideration is deducted from cash. Deductible costs are excluded from the average cost calculation only. **Confirmed.**
2. **Deductible costs on Sell**: Sells also have a deductible costs field (commission on shares; usually zero for mutual funds). The deductible costs field appears on both Buy and Sell forms. For a sell, `book_cost` = Sell Qty × Average Cost. For a buy, `book_cost` = Total Consideration - Deductible Costs.
3. **Sell — Average Cost**: Does **not** change on a sell (only recalculated on buys). **Confirmed.**
4. **Zero quantity after sell**: Holding row **remains** with qty=0. Code must guard against multiply/divide-by-zero errors throughout (average cost display, book cost calculation, etc.).
5. **Partial sell validation**: Sell quantity must be ≤ current holding quantity. Total Consideration on a sell has no upper bound. **Confirmed.**
6. **Context menu positioning**: 3-dot action menu appears in the **detail view only** (not the holdings setup view).
7. **Holding Movements history**: No history section in this phase. A future "Statement" report will show starting position, all buys/sells/adjustments, and resulting current position.

---

## Scope of Changes

### 1. Database Migration (Migration 12)

**File**: `src/server/db/connection.js`

Add `book_cost` and `deductible_costs` columns to `holding_movements` table:

```sql
ALTER TABLE holding_movements ADD COLUMN book_cost INTEGER NOT NULL DEFAULT 0;
ALTER TABLE holding_movements ADD COLUMN deductible_costs INTEGER NOT NULL DEFAULT 0;
```

- Both stored as INTEGER × 10000 (same scale as all monetary fields)
- `book_cost`: For a **buy** = Total Consideration - Deductible Costs (amount added to cost basis). For a **sell** = Sell Quantity × Average Cost (cost basis being disposed of).
- `deductible_costs`: Commission, stamp duty, etc. Applies to both buys and sells. Usually zero for mutual fund sells.
- DEFAULT 0 ensures any pre-existing rows (there shouldn't be any) don't break

Also update `schema.sql` to include both new columns.

### 2. Database Layer — Holding Movements

**New file**: `src/server/db/holding-movements-db.js`

Functions:

#### `createBuyMovement(data)`
Atomic transaction (BEGIN/COMMIT/ROLLBACK):
1. Read current holding: get `quantity` and `average_cost` (scaled values)
2. Read current account: get `cash_balance` (scaled)
3. Validate: `total_consideration` ≤ cash balance (scaled comparison)
4. Calculate new average cost:
   - `oldBookCost = oldQuantity_scaled × oldAvgCost_scaled / SCALE` (careful with integer arithmetic)
   - `addedBookCost = scaledConsideration - scaledDeductibleCosts`
   - `newQuantity_scaled = oldQuantity_scaled + scaledBuyQuantity`
   - `newAvgCost_scaled = (oldBookCost + addedBookCost) / (newQuantity_scaled / SCALE)`
5. INSERT into `holding_movements` (movement_type='buy', quantity, movement_value=total_consideration, book_cost=addedBookCost, notes)
6. UPDATE `holdings` SET quantity = newQuantity, average_cost = newAvgCost
7. UPDATE `accounts` SET cash_balance = cash_balance - scaledConsideration

Parameters:
- `holding_id` (integer)
- `movement_date` (ISO-8601 string)
- `quantity` (decimal, unscaled)
- `total_consideration` (decimal GBP, unscaled)
- `deductible_costs` (decimal GBP, unscaled, default 0)
- `notes` (optional string)

Returns: the created movement record.

#### `createSellMovement(data)`
Atomic transaction:
1. Read current holding: get `quantity` and `average_cost` (scaled)
2. Validate: sell quantity ≤ holding quantity
3. Calculate `book_cost` = sell_quantity × average_cost (the cost basis being removed)
4. INSERT into `holding_movements` (movement_type='sell', quantity, movement_value=total_consideration, book_cost, deductible_costs, notes)
5. UPDATE `holdings` SET quantity = quantity - scaledSellQuantity (average_cost unchanged)
6. UPDATE `accounts` SET cash_balance = cash_balance + scaledConsideration
7. Guard: if new quantity is zero, ensure no divide-by-zero in any subsequent display logic

Parameters:
- `holding_id` (integer)
- `movement_date` (ISO-8601 string)
- `quantity` (decimal, unscaled)
- `total_consideration` (decimal GBP, unscaled)
- `deductible_costs` (decimal GBP, unscaled, default 0 — commission on shares, usually zero for mutual funds)
- `notes` (optional string)

Returns: the created movement record.

#### `getMovementsByHoldingId(holdingId, limit)`
Fetch movements for a holding, newest first. Returns unscaled values.

#### `getMovementById(id)`
Fetch a single movement by ID.

#### `deleteMovement(id)`
Reverse a movement (undo buy or undo sell). Atomic transaction:
- For a buy: subtract quantity from holding, reverse average cost, add consideration back to cash
- For a sell: add quantity back to holding, subtract consideration from cash
- Average cost reversal on buy-delete is complex — need to recalculate from remaining movements or store enough to reverse. **Simpler approach**: disallow deletion of buy movements if there have been subsequent movements. Or: store the pre-movement average cost in the movement row so it can be restored.

**Decision**: For v0.8.0, **do not implement delete** of holding movements. Movements are permanent records from contract notes. If needed in future, an "adjustment" movement type can correct errors. This keeps the implementation simpler and avoids the complex average-cost reversal problem.

### 3. Server Validation

**File**: `src/server/validation.js`

Add `validateHoldingMovement(data)`:
- `movement_type` required, must be 'buy' or 'sell'
- `movement_date` required, ISO-8601 format
- `quantity` required, must be positive number
- `total_consideration` required, must be positive number
- `deductible_costs` optional, must be non-negative number (applies to both buy and sell)
- `notes` optional, max 255 chars

### 4. API Routes — Holding Movements

**New file**: `src/server/routes/holding-movements-routes.js`

Endpoints:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/holdings/:holdingId/movements` | Create a buy or sell movement |
| GET | `/api/holdings/:holdingId/movements` | List movements for a holding |
| GET | `/api/holding-movements/:id` | Get a single movement |

The POST endpoint:
1. Parse body: `{ movement_type, movement_date, quantity, total_consideration, deductible_costs, notes }`
2. Validate with `validateHoldingMovement()`
3. Verify the holding exists and load its account
4. For **buy**: verify total_consideration ≤ account cash_balance
5. For **sell**: verify quantity ≤ holding quantity
6. Call `createBuyMovement()` or `createSellMovement()`
7. Return the created movement + updated holding + updated cash balance

### 5. Server Router Registration

**File**: `src/server/index.js`

Add routing for holding movements:
- Under the existing `/api/holdings` section, add a check for `/movements` sub-path
- Add standalone `/api/holding-movements` path

### 6. UI — Context Menu (3-Dot Action Menu)

**File**: `src/ui/pages/portfolio.html`

Add a single shared context menu element (hidden by default):

```html
<div id="holding-action-menu" class="hidden absolute bg-white border border-brand-200 rounded-lg shadow-lg z-50 py-1">
    <button id="action-buy-btn" class="w-full text-left px-4 py-2 text-base hover:bg-brand-50 text-brand-700">Buy</button>
    <button id="action-sell-btn" class="w-full text-left px-4 py-2 text-base hover:bg-brand-50 text-brand-700">Sell</button>
</div>
```

### 7. UI — Buy/Sell Form Modal

**File**: `src/ui/pages/portfolio.html`

Add a single modal form that adapts for Buy or Sell:

```html
<div id="movement-form-container" class="hidden fixed inset-0 bg-black/30 flex items-center justify-center z-50">
    <div class="bg-white rounded-lg shadow-lg p-6 w-full max-w-lg mx-4">
        <h3 id="movement-form-title" class="text-xl font-semibold text-brand-800 mb-4">Buy</h3>
        <div id="movement-form-holding-info" class="mb-4 text-base text-brand-600"></div>
        <form id="movement-form" class="space-y-4">
            <input type="hidden" id="movement-holding-id" />
            <input type="hidden" id="movement-type" />

            <!-- Date -->
            <div>
                <label class="block text-sm font-medium text-brand-700 mb-1">Date *</label>
                <input type="date" id="movement-date" required class="w-full px-3 py-2 border ..." />
            </div>

            <!-- Quantity -->
            <div>
                <label class="block text-sm font-medium text-brand-700 mb-1">Quantity *</label>
                <input type="number" id="movement-quantity" step="any" min="0.0001" required class="..." />
                <p id="movement-qty-info" class="text-sm text-brand-500 mt-1"></p>
            </div>

            <!-- Total Consideration (GBP) -->
            <div>
                <label class="block text-sm font-medium text-brand-700 mb-1">Total Consideration (GBP) *</label>
                <input type="number" id="movement-consideration" step="0.01" min="0.01" required class="..." />
                <p id="movement-cash-info" class="text-sm text-brand-500 mt-1"></p>
            </div>

            <!-- Deductible Costs (both Buy and Sell) -->
            <div id="movement-deductible-row">
                <label class="block text-sm font-medium text-brand-700 mb-1">Deductible Costs (GBP)</label>
                <input type="number" id="movement-deductible" step="0.01" min="0" value="0" class="..." />
                <p id="movement-deductible-hint" class="text-sm text-brand-400 mt-1">e.g. stamp duty, commission</p>
            </div>

            <!-- Book Cost display (Sell only, read-only) — shown after quantity entered -->
            <div id="movement-bookcost-row" class="hidden">
                <label class="block text-sm font-medium text-brand-700 mb-1">Total Book Cost</label>
                <p id="movement-bookcost-display" class="text-lg font-mono font-semibold text-brand-800"></p>
                <p class="text-sm text-brand-400 mt-1">Sell Quantity × Average Cost</p>
            </div>

            <!-- Notes -->
            <div>
                <label class="block text-sm font-medium text-brand-700 mb-1">Notes</label>
                <input type="text" id="movement-notes" maxlength="255" class="..." />
            </div>

            <div id="movement-form-errors"></div>

            <div class="flex justify-end gap-3 pt-2">
                <button type="button" id="movement-cancel-btn" class="...">Cancel</button>
                <button type="submit" id="movement-submit-btn" class="...">Confirm Buy</button>
            </div>
        </form>
    </div>
</div>
```

### 8. UI — JavaScript Logic

**File**: `src/ui/js/portfolio.js`

Add the following functions:

#### State variables
```javascript
let activeActionMenu = null;  // { holdingId, accountId, element }
```

#### Context menu
- `showActionMenu(holdingId, buttonElement)` — position and show the 3-dot menu next to the clicked button
- `hideActionMenu()` — hide the menu
- Click-outside listener to close the menu
- Wire up Buy/Sell buttons in the menu

#### Buy form
- `showBuyForm(holdingId)` — populate the modal with holding info, current cash balance, show deductible costs field, hide book cost display
- On quantity or consideration change: show remaining cash info
- Validation: consideration ≤ cash balance (client-side pre-check)

#### Sell form
- `showSellForm(holdingId)` — populate the modal with holding info, current quantity, show deductible costs field AND book cost display
- Deductible costs hint changes to "e.g. commission — usually zero for mutual funds"
- On quantity change: auto-calculate and display book cost (sell qty × avg cost)
- Validation: quantity ≤ current holding quantity (client-side pre-check)
- Guard: if holding quantity is zero, disable the Sell option in the context menu

#### Submit handler
- `handleMovementSubmit(event)` — POST to `/api/holdings/:holdingId/movements`, handle errors, refresh the detail view on success

#### Rendering update
- Modify `renderDetailHoldings()` to add a first column with a 3-dot action button (`⋮`) per holding row

### 9. Detail View Refresh After Movement

After a successful buy or sell:
1. Re-fetch the portfolio summary for the current user (to get updated quantities, values, cash)
2. Re-render the detail holdings table
3. Update the cash balance display
4. Show a success message
5. Close the modal

### 10. Tests

**New file**: `tests/unit/holding-movements-db.test.js` (port 1445)

Test cases:
- Buy: creates movement, updates holding quantity and average cost, deducts cash
- Buy: fails if consideration > cash balance
- Buy: average cost calculation with deductible costs
- Buy: deductible costs stored in movement record
- Sell: creates movement, reduces holding quantity, adds cash (average cost unchanged)
- Sell: fails if sell quantity > holding quantity
- Sell: book cost recorded correctly (sell qty × avg cost)
- Sell: deductible costs stored in movement record
- Sell: full quantity sell leaves holding with qty=0 (no divide-by-zero)
- Get movements by holding ID (ordered by date desc)
- Get movement by ID

**New file**: `tests/unit/holding-movements-routes.test.js` (port 1446)

Test cases:
- POST buy movement: success, returns updated data
- POST buy movement: validation errors (missing fields, bad date, negative values)
- POST buy movement: insufficient cash (400 error)
- POST sell movement: success
- POST sell movement: insufficient quantity (400 error)
- GET movements list for a holding
- GET single movement

---

## File Change Summary

| File | Action | Description |
|------|--------|-------------|
| `src/server/db/connection.js` | Edit | Add Migration 12: `book_cost` column |
| `src/server/db/schema.sql` | Edit | Add `book_cost` column to `holding_movements` |
| `src/server/db/holding-movements-db.js` | **New** | DB layer for buy/sell movements |
| `src/server/validation.js` | Edit | Add `validateHoldingMovement()` |
| `src/server/routes/holding-movements-routes.js` | **New** | API routes for movements |
| `src/server/index.js` | Edit | Register movement routes |
| `src/ui/pages/portfolio.html` | Edit | Add context menu, movement form modal |
| `src/ui/js/portfolio.js` | Edit | Add buy/sell UI logic, modify detail table |
| `tests/unit/holding-movements-db.test.js` | **New** | DB layer tests |
| `tests/unit/holding-movements-routes.test.js` | **New** | API route tests |

---

## Implementation Order

1. Migration 12 + schema.sql update (add `book_cost` column)
2. `holding-movements-db.js` (DB layer with `createBuyMovement`, `createSellMovement`, getters)
3. `validation.js` update (add `validateHoldingMovement`)
4. `holding-movements-routes.js` (API routes)
5. `index.js` update (register routes)
6. DB layer tests (`holding-movements-db.test.js`)
7. Route tests (`holding-movements-routes.test.js`)
8. `portfolio.html` updates (context menu + movement form modal)
9. `portfolio.js` updates (action menu logic, buy/sell forms, submit handler, detail table column)
10. Manual testing pause

---

## Average Cost Calculation — Worked Example

**Buy scenario**: Existing holding of 100 shares at avg cost 5.00

- Old Book Cost = 100 × 5.00 = 500.00
- Buy 50 shares, Total Consideration = 300.00, Deductible Costs = 10.00
- Added Book Cost = 300.00 - 10.00 = 290.00
- New Quantity = 150
- New Avg Cost = (500.00 + 290.00) / 150 = 5.2667

In scaled integers (×10000):
- Old qty = 1,000,000; Old avg = 50,000
- Old book cost (scaled²) = 1,000,000 × 50,000 = 50,000,000,000 → needs careful arithmetic
- Better approach: work in unscaled decimals for the calculation, then scale the result

**Implementation note**: Unscale the holding values, perform the average cost calculation in decimal, then scale back. This avoids integer overflow with large values.

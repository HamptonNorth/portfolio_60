# PLAN v0.9.0 — Stock Splits & Fee Adjustments

## Background

Providers (ii, HL etc.) charge fees for management, trades, currency handling etc. This means the Cash Balance on an account held in say ii will be lower/differ from the cash balance held in Portfolio 60 due to these fees. Periodically the user will compare the cash balances (ii to Portfolio 60) and adjust the Portfolio 60 figure so it matches. Probably best done quarterly.

Adjustments are also needed for corporate actions.

### Summary of Data Adjustments

| Corporate Action | Quantity Adjustment | Price/Basis Adjustment | ID/Symbol Change |
| --- | --- | --- | --- |
| Stock Split | Yes (Increase/Decrease) | Yes (Inverse of Split) | No |
| Merger | Yes (Replacement) | Yes (Reallocation) | Yes |
| Spin-off | Yes (New Position) | Yes (Cost Apportionment) | New ID Added |
| Dividend | Only if Reinvested | Yes (Ex-Date Drop) | No |
| Name Change | No | No | Yes |

Stock Splits and Re-invested dividends will be handled by adjustments. Mergers, spin-offs, and name changes are out of scope for v0.9.0.

---

## Phase 1 — Stock Splits

### Overview

For stock splits the quantity and average cost change such that the total book cost remains constant.

**Example:** quantity = 35, avg cost = 248.0000, book cost = 8,680. After a 1:100 split: quantity = 3,500, avg cost = 2.4800, book cost still = 8,680.

The Edit Holding modal already allows changing quantity and avg cost price. The enhancement adds a "Stock split" checkbox that, when ticked, locks Avg Cost Price and Book Cost Value fields and reveals date and notes inputs. The user changes only the quantity and the avg cost is recalculated as the inverse (preserving book cost). Both forward splits (qty increases, e.g. 35 → 3,500) and reverse/consolidation splits (qty decreases, e.g. 1,000 → 10) are supported.

Each split writes a `holding_movements` record with `movement_type = 'adjustment'`. The 'adjustment' type already exists in the CHECK constraint — no database migration is required.

### Step 1.1 — Backend: createSplitMovement() DB function

**File:** `src/server/db/holding-movements-db.js`

Add new function `createSplitMovement(data)`:
- **Input:** `{ holding_id, movement_date, new_quantity, notes }` (notes is optional)
- **Logic:**
  1. Read the current holding (quantity, average_cost).
  2. Calculate current book cost: `oldQuantity * oldAvgCost`.
  3. Calculate new average cost: `bookCost / newQuantity`.
  4. Within a database transaction:
     a. Update holding: set `quantity = new_quantity`, `average_cost = newAvgCost`.
     b. Insert into `holding_movements`:
        - `movement_type = 'adjustment'`
        - `quantity = new_quantity` (scaled)
        - `movement_value = 0` (no cash involved)
        - `book_cost = bookCost` (unchanged)
        - `revised_avg_cost = newAvgCost` (scaled)
        - `deductible_costs = 0`
        - `notes` from input (e.g. "Stock split 1:100")
  5. Return the created movement record.
- **Validations:**
  - `new_quantity` must be > 0.
  - `new_quantity` must differ from current quantity (otherwise no split occurred).
  - Both forward splits (new_quantity > old) and reverse splits (new_quantity < old) are valid.

### Step 1.2 — Backend: API route for split adjustments

**File:** `src/server/routes/holding-movements-routes.js`

Extend the existing POST `/api/holdings/:holdingId/movements` handler to support `movement_type = 'adjustment'`:

- When `body.movement_type === 'adjustment'`:
  - Validate: `new_quantity` is present and > 0.
  - Validate: `movement_date` is present and valid ISO date.
  - Call `createSplitMovement(data)`.
  - Return 201 with `{ movement, holding, account }` (same pattern as buy/sell).

**File:** `src/server/routes/holding-movements-routes.js` (validation function)

- Update `validateHoldingMovement()` to accept 'adjustment' as a valid movement_type.
- When type is 'adjustment', require `new_quantity` and `movement_date`; do not require `total_consideration`.

### Step 1.3 — Frontend: Edit Holding modal — Stock Split checkbox, date, and notes

**File:** `src/ui/pages/portfolio.html`

In the Edit Holding modal, add:

1. A "Stock split" checkbox on the button row (where the delete button is):
```html
<label class="flex items-center gap-2 text-sm text-brand-700">
  <input type="checkbox" id="holding-split-check" class="...">
  Stock split
</label>
```

2. A split-details section (hidden by default, shown when checkbox ticked) between the cost fields and the buttons:
```html
<div id="holding-split-details" class="hidden">
  <div class="flex gap-4">
    <div>
      <label>Split Date *</label>
      <input type="date" id="holding-split-date" required>
    </div>
    <div>
      <label>Notes</label>
      <input type="text" id="holding-split-notes" maxlength="255" placeholder="e.g. Stock split 1:100">
    </div>
  </div>
</div>
```

### Step 1.4 — Frontend: Stock Split checkbox behaviour

**File:** `src/ui/js/portfolio.js`

Add event listener on `#holding-split-check`:

- **When checked:**
  - Disable (grey out) `#holding-avg-cost` and `#holding-book-cost` inputs.
  - Show `#holding-split-details` (date and notes fields).
  - Pre-fill `#holding-split-date` with today's date.
  - Store current quantity as `splitOriginalQuantity` (used to detect change).
  - Store current book cost value for inverse calculation.
  - Add an `input` listener on `#holding-quantity` that recalculates avg cost = bookCost / newQuantity in real-time (display-only, shown in the disabled field).

- **When unchecked:**
  - Re-enable `#holding-avg-cost` and `#holding-book-cost` inputs.
  - Hide `#holding-split-details`.
  - Remove the live-recalculation listener.
  - Restore original values if quantity was changed but not saved.

- **Only visible when editing** (not when adding a new holding). Hide/show with the same logic that controls the Delete button visibility.

### Step 1.5 — Frontend: Modified Save handler for splits

**File:** `src/ui/js/portfolio.js`

Modify `handleHoldingSubmit()`:

- If `#holding-split-check` is checked:
  - Validate: split date is filled in.
  - Instead of PUT to `/api/holdings/:id`, POST to `/api/holdings/:holdingId/movements` with:
    ```json
    {
      "movement_type": "adjustment",
      "movement_date": "<user-entered date>",
      "new_quantity": <entered quantity>,
      "notes": "<user-entered notes or null>"
    }
    ```
  - On success, refresh holdings list and show "Stock split recorded successfully".
  - Uncheck the split checkbox, hide split fields, and re-enable cost fields.
- If unchecked, existing save behaviour unchanged.

### Step 1.6 — Frontend: Display adjustment movements in transaction history

**File:** `src/ui/js/portfolio.js`

When rendering holding movements in the transaction list, handle `movement_type === 'adjustment'`:
- Display as "Adjustment" in the type column.
- Show the new quantity and revised avg cost.
- No cash amount (value = 0).

### Step 1.7 — Tests

**File:** `tests/unit/holding-movements-db.test.js` (or new file)

- Test `createSplitMovement()`:
  - Forward split: verify holding quantity increases and avg cost decreases proportionally.
  - Reverse split: verify holding quantity decreases and avg cost increases proportionally.
  - Verify book cost remains constant (oldQty * oldAvg === newQty * newAvg).
  - Verify movement record created with type 'adjustment'.
  - Verify cash balance is NOT affected.
  - Edge case: new quantity same as old quantity — should reject.
  - Edge case: new quantity = 0 — should reject.

**File:** `tests/unit/holding-movements-routes.test.js` (or extend existing)

- Test POST with `movement_type: 'adjustment'`:
  - Returns 201 with correct movement and updated holding.
  - Returns 400 for missing/invalid new_quantity.
  - Returns 400 for missing movement_date.

### PAUSE: Manual Testing — Stock Splits

1. Open an account with an existing holding (e.g. quantity=35, avg cost=248.00).
2. Click Edit on the holding.
3. Tick "Stock split" checkbox — verify avg cost and book cost fields disable; date and notes fields appear.
4. Change quantity from 35 to 3500.
5. Verify avg cost live-updates to 2.48 and book cost stays at 8,680.00.
6. Enter a date and notes (e.g. "1:100 stock split").
7. Click Save — verify holding updates, success message shown.
8. Check transaction history — verify adjustment movement recorded with date and notes.
9. Verify cash balance is unchanged.
10. Test a reverse split: edit the holding, tick stock split, change quantity from 3500 to 350 — verify avg cost updates to 24.80.
11. Run `bun test` — all tests pass.

---

## Phase 2 — Fee Adjustments

### Overview

Fee adjustments allow the user to deduct provider charges from the account cash balance. The UI mirrors the Withdraw modal but creates a `cash_transaction` with `transaction_type = 'adjustment'` (already a valid type in the schema).

A new "Fees" button is added alongside the existing Deposit and Withdraw buttons. Fees normally reduce the cash balance (debits), but the amount field also accepts the rare case of a provider refund/correction that increases the balance (credit). A direction toggle (debit/credit) controls this.

### Step 2.1 — Frontend: Add Fees button to cash balance bars

**File:** `src/ui/pages/portfolio.html`

In both cash balance bar locations (holdings view and detail view), add a third button after Withdraw:

**Holdings view (alongside `#deposit-btn` and `#withdraw-btn`):**
```html
<button id="fees-btn" class="bg-red-600 hover:bg-red-700 text-white font-medium px-4 py-2 rounded-lg transition-colors">Fees</button>
```

**Detail view (alongside `#detail-deposit-btn` and `#detail-withdraw-btn`):**
```html
<button id="detail-fees-btn" class="bg-red-600 hover:bg-red-700 text-white font-medium px-4 py-2 rounded-lg transition-colors">Fees</button>
```

### Step 2.2 — Frontend: Add direction toggle to cash transaction form

**File:** `src/ui/pages/portfolio.html`

Add a direction selector inside the cash transaction form (hidden by default, shown only for fees):
```html
<div id="cash-tx-direction-row" class="hidden">
  <label class="text-sm font-medium text-brand-700">Direction</label>
  <select id="cash-tx-direction">
    <option value="debit" selected>Debit (reduce balance)</option>
    <option value="credit">Credit (increase balance)</option>
  </select>
</div>
```

### Step 2.3 — Frontend: showFeesForm() function

**File:** `src/ui/js/portfolio.js`

Add `showFeesForm()` function (pattern follows `showWithdrawForm()`):
- Set title to "Fees adjustment".
- Set `cash-tx-type` hidden field to `"adjustment"`.
- Show available balance.
- Show direction toggle (`#cash-tx-direction-row`), defaulting to "debit".
- Set submit button to red with text "Record Fees".
- Reset form and pre-fill date with today.
- Focus on amount field.

Update `showDepositForm()` and `showWithdrawForm()` to hide the direction toggle.

### Step 2.4 — Frontend: Wire up Fees button event listeners

**File:** `src/ui/js/portfolio.js`

Add event listeners for `#fees-btn` and `#detail-fees-btn` → call `showFeesForm()`.

### Step 2.5 — Frontend: Update handleCashTxSubmit() for fees

**File:** `src/ui/js/portfolio.js`

Modify `handleCashTxSubmit()`:
- When `transaction_type === 'adjustment'`:
  - Read `#cash-tx-direction` value.
  - If direction is 'debit': balance check (amount must not exceed cash balance). Send amount as-is to the API.
  - If direction is 'credit': no balance check needed. Send a flag or negative amount convention to the API so the backend knows to credit.
- Add success message: "Fees adjustment recorded successfully".

### Step 2.6 — Backend: Verify/add adjustment type handling

**File:** `src/server/db/cash-transactions-db.js`

Verify that the existing `createCashTransaction()` function handles `transaction_type = 'adjustment'`:
- If direction is debit: subtract amount from cash balance (same as 'withdrawal').
- If direction is credit: add amount to cash balance (same as 'deposit').
- If not already handled, add the logic.

**File:** `src/server/routes/cash-transactions-routes.js`

Verify the POST handler accepts 'adjustment' type. If the validation function restricts to only 'deposit'/'withdrawal', update it to also allow 'adjustment'. Support an optional `direction` field ('debit' or 'credit', defaulting to 'debit').

### Step 2.7 — Frontend: Display adjustment in transaction history

**File:** `src/ui/js/portfolio.js`

When rendering cash transactions, handle `transaction_type === 'adjustment'`:
- Display type as "Adjustment" in the type column.
- Show as debit (negative) or credit (positive) based on direction.

### Step 2.8 — Tests

**File:** `tests/unit/cash-transactions-db.test.js` (or extend existing)

- Test creating a cash transaction with `transaction_type: 'adjustment'`:
  - Debit: verify cash balance decreases by the fee amount.
  - Credit: verify cash balance increases by the refund amount.
  - Verify transaction record created with type 'adjustment'.
  - Debit: verify amount > cash balance is rejected.

**File:** `tests/unit/cash-transactions-routes.test.js` (or extend existing)

- Test POST with `transaction_type: 'adjustment'`:
  - Returns 201 and correct transaction record (debit).
  - Returns 201 and correct transaction record (credit).
  - Returns 400 if debit amount exceeds balance.

### PAUSE: Manual Testing — Fee Adjustments

1. Open an account with a positive cash balance (e.g. 2,220).
2. Verify new "Fees" button appears next to Deposit and Withdraw (both views).
3. Click Fees — verify modal opens with title "Fees adjustment", direction toggle (defaulting to Debit), red button "Record Fees", available balance shown.
4. Enter a fee amount (e.g. 45.50), a date, and optional notes (e.g. "Q4 2025 management fee").
5. Click Record Fees — verify cash balance decreases by 45.50.
6. Check transaction history — verify adjustment row shown with correct amount and notes.
7. Try entering a fee that exceeds the balance (debit) — verify rejection.
8. Change direction to Credit, enter a small refund amount — verify cash balance increases.
9. Run `bun test` — all tests pass.

---

## Files Changed Summary

| File | Phase | Change |
| --- | --- | --- |
| `src/server/db/holding-movements-db.js` | 1 | Add `createSplitMovement()` |
| `src/server/routes/holding-movements-routes.js` | 1 | Handle 'adjustment' in POST, update validation |
| `src/ui/pages/portfolio.html` | 1, 2 | Stock split checkbox + date/notes fields; Fees buttons; direction toggle |
| `src/ui/js/portfolio.js` | 1, 2 | Split checkbox logic, modified save; showFeesForm(), direction handling |
| `src/server/db/cash-transactions-db.js` | 2 | Verify/add 'adjustment' debit/credit handling |
| `src/server/routes/cash-transactions-routes.js` | 2 | Verify 'adjustment' type accepted, direction support |
| `tests/unit/holding-movements-db.test.js` | 1 | Split movement tests |
| `tests/unit/holding-movements-routes.test.js` | 1 | Split API tests |
| `tests/unit/cash-transactions-*.test.js` | 2 | Adjustment transaction tests (debit + credit) |

**Note:** No database migration is required. Both `holding_movements.movement_type` and `cash_transactions.transaction_type` already include 'adjustment' in their CHECK constraints.

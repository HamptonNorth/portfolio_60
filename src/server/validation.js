import { getAllowedProviderCodes } from "./routes/config-routes.js";
import { validatePublicId as validatePublicIdFormat } from "../shared/public-id-utils.js";

/**
 * @description Shared validation helpers for Portfolio 60 API routes.
 * All validators return an error message string if invalid, or null if valid.
 */

/**
 * @description Validate that a field is present and non-empty.
 * @param {*} value - The value to check
 * @param {string} fieldName - Human-readable field name for the error message
 * @returns {string|null} Error message or null if valid
 */
export function validateRequired(value, fieldName) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return `${fieldName} is required`;
  }
  return null;
}

/**
 * @description Validate that a string does not exceed a maximum length.
 * Skips validation if the value is null/undefined (use validateRequired for that).
 * @param {*} value - The value to check
 * @param {number} maxLength - Maximum allowed length
 * @param {string} fieldName - Human-readable field name for the error message
 * @returns {string|null} Error message or null if valid
 */
export function validateMaxLength(value, maxLength, fieldName) {
  if (value === undefined || value === null) {
    return null;
  }
  if (String(value).length > maxLength) {
    return `${fieldName} must be ${maxLength} characters or fewer`;
  }
  return null;
}

/**
 * @description Validate user data for create or update operations.
 * Returns an array of error messages (empty if all valid).
 * @param {Object} data - The user data to validate
 * @returns {string[]} Array of validation error messages
 */
export function validateUser(data) {
  const errors = [];

  // Required fields
  const requiredChecks = [validateRequired(data.initials, "Initials"), validateRequired(data.first_name, "First name"), validateRequired(data.last_name, "Last name"), validateRequired(data.provider, "Provider")];

  for (const error of requiredChecks) {
    if (error) errors.push(error);
  }

  // Provider must be from the allowed list
  if (data.provider && String(data.provider).trim() !== "") {
    const allowed = getAllowedProviderCodes();
    if (!allowed.includes(data.provider.toLowerCase())) {
      errors.push("Provider must be one of: " + allowed.join(", "));
    }
  }

  // Max length checks
  const lengthChecks = [
    validateMaxLength(data.initials, 5, "Initials"),
    validateMaxLength(data.first_name, 30, "First name"),
    validateMaxLength(data.last_name, 30, "Last name"),
    validateMaxLength(data.ni_number, 9, "NI number"),
    validateMaxLength(data.utr, 15, "UTR"),
    validateMaxLength(data.provider, 5, "Provider"),
    validateMaxLength(data.trading_ref, 15, "Trading reference"),
    validateMaxLength(data.isa_ref, 15, "ISA reference"),
    validateMaxLength(data.sipp_ref, 15, "SIPP reference"),
  ];

  for (const error of lengthChecks) {
    if (error) errors.push(error);
  }

  return errors;
}

/**
 * @description Validate investment data for create or update operations.
 * Returns an array of error messages (empty if all valid).
 * @param {Object} data - The investment data to validate
 * @returns {string[]} Array of validation error messages
 */
export function validateInvestment(data) {
  const errors = [];

  // Required fields
  const requiredChecks = [validateRequired(data.currencies_id, "Currency"), validateRequired(data.investment_type_id, "Investment type"), validateRequired(data.description, "Description")];

  for (const error of requiredChecks) {
    if (error) errors.push(error);
  }

  // currencies_id and investment_type_id must be positive integers
  if (data.currencies_id !== undefined && data.currencies_id !== null) {
    const currencyId = Number(data.currencies_id);
    if (!Number.isInteger(currencyId) || currencyId <= 0) {
      errors.push("Currency must be a valid selection");
    }
  }

  if (data.investment_type_id !== undefined && data.investment_type_id !== null) {
    const typeId = Number(data.investment_type_id);
    if (!Number.isInteger(typeId) || typeId <= 0) {
      errors.push("Investment type must be a valid selection");
    }
  }

  // Max length checks
  const lengthChecks = [validateMaxLength(data.description, 60, "Description"), validateMaxLength(data.public_id, 20, "Public ID"), validateMaxLength(data.investment_url, 255, "Investment URL"), validateMaxLength(data.selector, 255, "CSS selector")];

  for (const error of lengthChecks) {
    if (error) errors.push(error);
  }

  // Public ID format validation (optional field — only validate if provided)
  if (data.public_id && String(data.public_id).trim() !== "") {
    const publicIdResult = validatePublicIdFormat(data.public_id);
    if (!publicIdResult.valid) {
      errors.push(publicIdResult.error);
    }
  }

  return errors;
}

/**
 * @description Validate test investment data for create or update operations.
 * Same as validateInvestment but with additional source_site and notes fields.
 * Returns an array of error messages (empty if all valid).
 * @param {Object} data - The test investment data to validate
 * @returns {string[]} Array of validation error messages
 */
export function validateTestInvestment(data) {
  const errors = [];

  // Required fields
  const requiredChecks = [validateRequired(data.currencies_id, "Currency"), validateRequired(data.investment_type_id, "Investment type"), validateRequired(data.description, "Description")];

  for (const error of requiredChecks) {
    if (error) errors.push(error);
  }

  // currencies_id and investment_type_id must be positive integers
  if (data.currencies_id !== undefined && data.currencies_id !== null) {
    const currencyId = Number(data.currencies_id);
    if (!Number.isInteger(currencyId) || currencyId <= 0) {
      errors.push("Currency must be a valid selection");
    }
  }

  if (data.investment_type_id !== undefined && data.investment_type_id !== null) {
    const typeId = Number(data.investment_type_id);
    if (!Number.isInteger(typeId) || typeId <= 0) {
      errors.push("Investment type must be a valid selection");
    }
  }

  // Max length checks
  const lengthChecks = [validateMaxLength(data.description, 60, "Description"), validateMaxLength(data.public_id, 20, "Public ID"), validateMaxLength(data.investment_url, 255, "Investment URL"), validateMaxLength(data.selector, 255, "CSS selector"), validateMaxLength(data.source_site, 60, "Source site"), validateMaxLength(data.notes, 255, "Notes")];

  for (const error of lengthChecks) {
    if (error) errors.push(error);
  }

  // Public ID format validation (optional field — only validate if provided)
  if (data.public_id && String(data.public_id).trim() !== "") {
    const publicIdResult = validatePublicIdFormat(data.public_id);
    if (!publicIdResult.valid) {
      errors.push(publicIdResult.error);
    }
  }

  return errors;
}

/**
 * @description Validate currency data for create or update operations.
 * Returns an array of error messages (empty if all valid).
 * @param {Object} data - The currency data to validate
 * @returns {string[]} Array of validation error messages
 */
export function validateCurrency(data) {
  const errors = [];

  const requiredChecks = [validateRequired(data.code, "Code"), validateRequired(data.description, "Description")];

  for (const error of requiredChecks) {
    if (error) errors.push(error);
  }

  // Code must be exactly 3 characters
  if (data.code !== undefined && data.code !== null && String(data.code).trim() !== "") {
    if (String(data.code).trim().length !== 3) {
      errors.push("Code must be exactly 3 characters");
    }
  }

  const lengthChecks = [validateMaxLength(data.description, 30, "Description")];

  for (const error of lengthChecks) {
    if (error) errors.push(error);
  }

  return errors;
}

/**
 * @description Validate global event data for create or update operations.
 * Returns an array of error messages (empty if all valid).
 * @param {Object} data - The global event data to validate
 * @returns {string[]} Array of validation error messages
 */
export function validateGlobalEvent(data) {
  const errors = [];

  const requiredChecks = [validateRequired(data.event_date, "Event date"), validateRequired(data.description, "Description")];

  for (const error of requiredChecks) {
    if (error) errors.push(error);
  }

  // Date must be ISO-8601 format (YYYY-MM-DD)
  if (data.event_date !== undefined && data.event_date !== null && String(data.event_date).trim() !== "") {
    const dateStr = String(data.event_date).trim();
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(dateStr)) {
      errors.push("Event date must be in YYYY-MM-DD format");
    } else {
      // Check it's a valid calendar date
      const parsed = new Date(dateStr + "T00:00:00");
      if (isNaN(parsed.getTime())) {
        errors.push("Event date is not a valid date");
      }
    }
  }

  const lengthChecks = [validateMaxLength(data.description, 255, "Description")];

  for (const error of lengthChecks) {
    if (error) errors.push(error);
  }

  return errors;
}

/**
 * @description Validate account data for create or update operations.
 * Returns an array of error messages (empty if all valid).
 * @param {Object} data - The account data to validate
 * @returns {string[]} Array of validation error messages
 */
export function validateAccount(data) {
  const errors = [];

  // Required fields
  const requiredChecks = [validateRequired(data.account_type, "Account type"), validateRequired(data.account_ref, "Account reference")];

  for (const error of requiredChecks) {
    if (error) errors.push(error);
  }

  // account_type must be one of the allowed values
  if (data.account_type !== undefined && data.account_type !== null) {
    const accountType = String(data.account_type).trim();
    if (accountType !== "" && accountType !== "trading" && accountType !== "isa" && accountType !== "sipp") {
      errors.push("Account type must be one of: trading, isa, sipp");
    }
  }

  // Max length checks
  const lengthChecks = [validateMaxLength(data.account_ref, 15, "Account reference")];

  for (const error of lengthChecks) {
    if (error) errors.push(error);
  }

  // cash_balance must be a non-negative number if provided
  if (data.cash_balance !== undefined && data.cash_balance !== null) {
    const cashBalance = Number(data.cash_balance);
    if (isNaN(cashBalance) || cashBalance < 0) {
      errors.push("Cash balance must be a non-negative number");
    }
  }

  // warn_cash must be a non-negative number if provided
  if (data.warn_cash !== undefined && data.warn_cash !== null) {
    const warnCash = Number(data.warn_cash);
    if (isNaN(warnCash) || warnCash < 0) {
      errors.push("Warning threshold must be a non-negative number");
    }
  }

  return errors;
}

/**
 * @description Validate holding data for create or update operations.
 * Returns an array of error messages (empty if all valid).
 * @param {Object} data - The holding data to validate
 * @returns {string[]} Array of validation error messages
 */
export function validateHolding(data) {
  const errors = [];

  // investment_id required for create (not needed for update)
  if (data.investment_id !== undefined && data.investment_id !== null) {
    const investmentId = Number(data.investment_id);
    if (!Number.isInteger(investmentId) || investmentId <= 0) {
      errors.push("Investment must be a valid selection");
    }
  }

  // quantity must be a non-negative number
  if (data.quantity !== undefined && data.quantity !== null) {
    const quantity = Number(data.quantity);
    if (isNaN(quantity) || quantity < 0) {
      errors.push("Quantity must be a non-negative number");
    }
  }

  // average_cost must be a non-negative number
  if (data.average_cost !== undefined && data.average_cost !== null) {
    const averageCost = Number(data.average_cost);
    if (isNaN(averageCost) || averageCost < 0) {
      errors.push("Average cost must be a non-negative number");
    }
  }

  return errors;
}

/**
 * @description Validate cash transaction data for create operations.
 * Returns an array of error messages (empty if all valid).
 * @param {Object} data - The cash transaction data to validate
 * @returns {string[]} Array of validation error messages
 */
export function validateCashTransaction(data) {
  const errors = [];

  // Required fields
  const requiredChecks = [validateRequired(data.transaction_type, "Transaction type"), validateRequired(data.transaction_date, "Transaction date"), validateRequired(data.amount, "Amount")];

  for (const error of requiredChecks) {
    if (error) errors.push(error);
  }

  // transaction_type must be 'deposit' or 'withdrawal' (drawdowns/adjustments are system-created)
  if (data.transaction_type !== undefined && data.transaction_type !== null) {
    const txType = String(data.transaction_type).trim();
    if (txType !== "" && txType !== "deposit" && txType !== "withdrawal") {
      errors.push("Transaction type must be either 'deposit' or 'withdrawal'");
    }
  }

  // transaction_date must be ISO-8601 format (YYYY-MM-DD)
  if (data.transaction_date !== undefined && data.transaction_date !== null && String(data.transaction_date).trim() !== "") {
    const dateStr = String(data.transaction_date).trim();
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(dateStr)) {
      errors.push("Transaction date must be in YYYY-MM-DD format");
    } else {
      const parsed = new Date(dateStr + "T00:00:00");
      if (isNaN(parsed.getTime())) {
        errors.push("Transaction date is not a valid date");
      }
    }
  }

  // amount must be a positive number
  if (data.amount !== undefined && data.amount !== null) {
    const amount = Number(data.amount);
    if (isNaN(amount) || amount <= 0) {
      errors.push("Amount must be greater than zero");
    }
  }

  // notes is optional, max 255 chars
  const lengthChecks = [validateMaxLength(data.notes, 255, "Notes")];

  for (const error of lengthChecks) {
    if (error) errors.push(error);
  }

  return errors;
}

/**
 * @description Validate drawdown schedule data for create or update operations.
 * Returns an array of error messages (empty if all valid).
 * @param {Object} data - The drawdown schedule data to validate
 * @returns {string[]} Array of validation error messages
 */
export function validateDrawdownSchedule(data) {
  const errors = [];

  // Required fields
  const requiredChecks = [validateRequired(data.frequency, "Frequency"), validateRequired(data.trigger_day, "Trigger day"), validateRequired(data.from_date, "From date"), validateRequired(data.to_date, "To date"), validateRequired(data.amount, "Amount")];

  for (const error of requiredChecks) {
    if (error) errors.push(error);
  }

  // frequency must be one of the allowed values
  if (data.frequency !== undefined && data.frequency !== null) {
    const freq = String(data.frequency).trim();
    if (freq !== "" && freq !== "monthly" && freq !== "quarterly" && freq !== "annually") {
      errors.push("Frequency must be one of: monthly, quarterly, annually");
    }
  }

  // trigger_day must be an integer between 1 and 28
  if (data.trigger_day !== undefined && data.trigger_day !== null) {
    const day = Number(data.trigger_day);
    if (!Number.isInteger(day) || day < 1 || day > 28) {
      errors.push("Trigger day must be between 1 and 28");
    }
  }

  // from_date must be ISO-8601 format (YYYY-MM-DD)
  if (data.from_date !== undefined && data.from_date !== null && String(data.from_date).trim() !== "") {
    const dateStr = String(data.from_date).trim();
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(dateStr)) {
      errors.push("From date must be in YYYY-MM-DD format");
    } else {
      const parsed = new Date(dateStr + "T00:00:00");
      if (isNaN(parsed.getTime())) {
        errors.push("From date is not a valid date");
      }
    }
  }

  // to_date must be ISO-8601 format (YYYY-MM-DD)
  if (data.to_date !== undefined && data.to_date !== null && String(data.to_date).trim() !== "") {
    const dateStr = String(data.to_date).trim();
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(dateStr)) {
      errors.push("To date must be in YYYY-MM-DD format");
    } else {
      const parsed = new Date(dateStr + "T00:00:00");
      if (isNaN(parsed.getTime())) {
        errors.push("To date is not a valid date");
      }
    }
  }

  // to_date must be after from_date
  if (data.from_date && data.to_date) {
    const fromStr = String(data.from_date).trim();
    const toStr = String(data.to_date).trim();
    if (fromStr >= toStr) {
      errors.push("To date must be after from date");
    }
  }

  // amount must be a positive number
  if (data.amount !== undefined && data.amount !== null) {
    const amount = Number(data.amount);
    if (isNaN(amount) || amount <= 0) {
      errors.push("Amount must be greater than zero");
    }
  }

  // notes is optional, max 255 chars
  const lengthChecks = [validateMaxLength(data.notes, 255, "Notes")];

  for (const error of lengthChecks) {
    if (error) errors.push(error);
  }

  return errors;
}

/**
 * @description Validate benchmark data for create or update operations.
 * Returns an array of error messages (empty if all valid).
 * Note: The check that index benchmarks must use GBP currency is done at the route
 * level where we have access to the database to look up the GBP currency ID.
 * @param {Object} data - The benchmark data to validate
 * @returns {string[]} Array of validation error messages
 */
export function validateBenchmark(data) {
  const errors = [];

  // Required fields
  const requiredChecks = [validateRequired(data.currencies_id, "Currency"), validateRequired(data.benchmark_type, "Benchmark type"), validateRequired(data.description, "Description")];

  for (const error of requiredChecks) {
    if (error) errors.push(error);
  }

  // currencies_id must be a positive integer
  if (data.currencies_id !== undefined && data.currencies_id !== null) {
    const currencyId = Number(data.currencies_id);
    if (!Number.isInteger(currencyId) || currencyId <= 0) {
      errors.push("Currency must be a valid selection");
    }
  }

  // benchmark_type must be 'index' or 'price'
  if (data.benchmark_type !== undefined && data.benchmark_type !== null) {
    const benchmarkType = String(data.benchmark_type).trim();
    if (benchmarkType !== "" && benchmarkType !== "index" && benchmarkType !== "price") {
      errors.push("Benchmark type must be either 'index' or 'price'");
    }
  }

  // Max length checks
  const lengthChecks = [validateMaxLength(data.description, 60, "Description"), validateMaxLength(data.benchmark_url, 255, "Benchmark URL"), validateMaxLength(data.selector, 255, "CSS selector")];

  for (const error of lengthChecks) {
    if (error) errors.push(error);
  }

  return errors;
}

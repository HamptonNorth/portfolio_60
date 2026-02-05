import { getAllowedProviderCodes } from "./routes/config-routes.js";

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
  const lengthChecks = [validateMaxLength(data.description, 60, "Description"), validateMaxLength(data.investment_url, 255, "Investment URL"), validateMaxLength(data.selector, 255, "CSS selector")];

  for (const error of lengthChecks) {
    if (error) errors.push(error);
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

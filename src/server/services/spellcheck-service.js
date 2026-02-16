/**
 * @description CSpell-based spellcheck service for the docs editor.
 * Validates markdown content using the cspell-lib library with en-GB
 * dictionaries, merging user-maintained custom words from the database.
 */

import { DocumentValidator, createTextDocument, loadConfig } from "cspell-lib";
import { resolve } from "node:path";

/** @type {string} Path to the .cspell.json config file in the project root */
const CONFIG_PATH = resolve(".cspell.json");

/** @type {import("@cspell/cspell-types").CSpellUserSettings|null} Cached config */
let cachedConfig = null;

/**
 * @description Load the CSpell configuration from .cspell.json. The result
 * is cached after the first call to avoid re-reading the file on every
 * spellcheck request.
 * @returns {Promise<import("@cspell/cspell-types").CSpellUserSettings>}
 */
async function getConfig() {
  if (!cachedConfig) {
    cachedConfig = await loadConfig(CONFIG_PATH);
  }
  return cachedConfig;
}

/**
 * @description Spellcheck markdown content using CSpell with en-GB language.
 * Custom words from the database are merged into the CSpell word list so
 * they are not flagged as errors.
 * @param {string} text - The markdown content to check
 * @param {string[]} customWords - Additional words to treat as correct
 * @returns {Promise<Array<{word: string, offset: number, length: number}>>}
 *   Array of spelling issues with the misspelt word, its character offset
 *   in the document, and the word length.
 */
export async function spellCheckContent(text, customWords) {
  var config = await getConfig();

  var allWords = [...(config.words || [])];
  if (customWords && customWords.length > 0) {
    allWords.push(...customWords);
  }

  var doc = createTextDocument({
    uri: "file:///editor.md",
    languageId: "markdown",
    content: text,
  });

  var validator = new DocumentValidator(
    doc,
    { configFile: CONFIG_PATH, noConfigSearch: true },
    { ...config, words: allWords }
  );

  await validator.prepare();

  var issues = [...validator.checkDocument()];

  return issues.map(function (issue) {
    return {
      word: issue.text,
      offset: issue.offset,
      length: issue.text.length,
    };
  });
}

/**
 * @description Get all custom dictionary words from the database.
 * @param {import("bun:sqlite").Database} db - The database connection
 * @returns {string[]} Array of custom words
 */
export function getCustomDictionary(db) {
  var rows = db.query("SELECT word FROM custom_dictionary ORDER BY word").all();
  return rows.map(function (row) {
    return row.word;
  });
}

/**
 * @description Add a word to the custom dictionary. Uses INSERT OR IGNORE
 * so duplicate words are silently skipped.
 * @param {import("bun:sqlite").Database} db - The database connection
 * @param {string} word - The word to add (stored lowercase)
 */
export function addCustomWord(db, word) {
  var today = new Date().toISOString().slice(0, 10);
  db.query("INSERT OR IGNORE INTO custom_dictionary (word, added_date) VALUES (?, ?)").run(
    word.toLowerCase(),
    today
  );
}

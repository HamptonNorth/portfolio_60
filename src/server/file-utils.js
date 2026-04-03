import { existsSync, copyFileSync } from "node:fs";
import { dirname, basename, join } from "node:path";

/**
 * @description Create a timestamped backup of a JSON file before overwriting.
 * The backup is written to the same directory as the original file with a
 * timestamp suffix: filename-backup-yyyy-mm-dd-hh-mm.json.
 * @param {string} filePath - Absolute path to the file to back up
 */
export function backupJsonFile(filePath) {
  if (!existsSync(filePath)) return;
  const dir = dirname(filePath);
  const base = basename(filePath, ".json");
  const now = new Date();
  const pad = function (n) { return String(n).padStart(2, "0"); };
  const timestamp = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) + "-" + pad(now.getHours()) + "-" + pad(now.getMinutes());
  const backupName = base + "-backup-" + timestamp + ".json";
  const backupPath = join(dir, backupName);
  copyFileSync(filePath, backupPath);
}

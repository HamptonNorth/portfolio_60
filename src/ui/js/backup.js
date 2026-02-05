/**
 * @description Backup & Restore page logic for Portfolio 60.
 * Handles creating backups, listing existing backups, restoring, and deleting.
 */

/**
 * @description The filename currently pending a restore confirmation.
 * @type {string}
 */
let pendingRestoreFilename = "";

/**
 * @description The filename currently pending a delete confirmation.
 * @type {string}
 */
let pendingDeleteFilename = "";

/**
 * @description Format a file size in bytes to a human-readable string.
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted size (e.g. "68.0 KB", "1.2 MB")
 */
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

/**
 * @description Format an ISO-8601 date/time string for display in UK format.
 * @param {string} isoStr - ISO-8601 date string (e.g. "2026-02-05T14:32:00.000Z")
 * @returns {string} Formatted date and time (e.g. "5 Feb 2026 14:32")
 */
function formatBackupDate(isoStr) {
  const date = new Date(isoStr);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return day + " " + month + " " + year + " " + hours + ":" + minutes;
}

/**
 * @description Load and display the list of existing backups.
 */
async function loadBackups() {
  const container = document.getElementById("backups-list");

  const result = await apiRequest("/api/backup");

  if (!result.ok) {
    container.innerHTML = '<div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3">' +
      '<p class="text-base font-semibold">Failed to load backups</p>' +
      '<p class="text-sm mt-1">' + escapeHtml(result.detail || result.error) + '</p></div>';
    return;
  }

  const backups = result.data.backups;

  if (backups.length === 0) {
    container.innerHTML = '<p class="text-brand-500">No backups found. Click "Backup Now" to create one.</p>';
    return;
  }

  let html = '<div class="overflow-x-auto">';
  html += '<table class="w-full max-w-4xl text-left border-collapse">';
  html += '<thead>';
  html += '<tr class="border-b-2 border-brand-200">';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Filename</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Date</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700 text-right">Size</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700"></th>';
  html += '</tr>';
  html += '</thead>';
  html += '<tbody>';

  for (let i = 0; i < backups.length; i++) {
    const b = backups[i];
    const rowClass = i % 2 === 0 ? "bg-white" : "bg-brand-50";

    html += '<tr class="' + rowClass + ' border-b border-brand-100">';
    html += '<td class="py-3 px-3 text-base font-mono">' + escapeHtml(b.filename) + '</td>';
    html += '<td class="py-3 px-3 text-base">' + escapeHtml(formatBackupDate(b.modified)) + '</td>';
    html += '<td class="py-3 px-3 text-base text-right">' + formatFileSize(b.size) + '</td>';
    html += '<td class="py-3 px-3 text-base">';
    html += '<button class="text-sm text-brand-500 hover:text-brand-700 transition-colors mr-4" onclick="showRestoreDialog(\'' + escapeHtml(b.filename) + '\')">Restore</button>';
    html += '<button class="text-sm text-brand-400 hover:text-error transition-colors" onclick="showDeleteDialog(\'' + escapeHtml(b.filename) + '\')">Delete</button>';
    html += '</td>';
    html += '</tr>';
  }

  html += '</tbody></table></div>';
  html += '<p class="text-sm text-brand-400 mt-2">' + backups.length + ' backup' + (backups.length === 1 ? '' : 's') + '</p>';

  container.innerHTML = html;
}

/**
 * @description Create a new backup and refresh the backups list.
 */
async function createBackup() {
  const btn = document.getElementById("backup-btn");
  btn.disabled = true;
  btn.textContent = "Backing up...";

  const result = await apiRequest("/api/backup", { method: "POST" });

  btn.disabled = false;
  btn.textContent = "Backup Now";

  if (!result.ok) {
    showError("page-messages", "Backup failed", result.detail || result.error);
    return;
  }

  showSuccess("page-messages", result.data.message + " (" + formatFileSize(result.data.size) + ")");
  await loadBackups();
}

/**
 * @description Show the restore confirmation dialog for a specific backup.
 * @param {string} filename - The backup filename to restore
 */
function showRestoreDialog(filename) {
  pendingRestoreFilename = filename;
  document.getElementById("restore-filename").textContent = filename;
  document.getElementById("restore-dialog").classList.remove("hidden");
}

/**
 * @description Hide the restore confirmation dialog.
 */
function hideRestoreDialog() {
  document.getElementById("restore-dialog").classList.add("hidden");
  pendingRestoreFilename = "";
}

/**
 * @description Execute the restore after confirmation.
 */
async function confirmRestore() {
  if (!pendingRestoreFilename) return;

  const filename = pendingRestoreFilename;
  hideRestoreDialog();

  const result = await apiRequest("/api/backup/restore/" + encodeURIComponent(filename), {
    method: "POST",
  });

  if (!result.ok) {
    showError("page-messages", "Restore failed", result.detail || result.error);
    return;
  }

  showSuccess("page-messages", result.data.message);
  await loadBackups();
}

/**
 * @description Show the delete confirmation dialog for a specific backup.
 * @param {string} filename - The backup filename to delete
 */
function showDeleteDialog(filename) {
  pendingDeleteFilename = filename;
  document.getElementById("delete-filename").textContent = filename;
  document.getElementById("delete-dialog").classList.remove("hidden");
}

/**
 * @description Hide the delete confirmation dialog.
 */
function hideDeleteDialog() {
  document.getElementById("delete-dialog").classList.add("hidden");
  pendingDeleteFilename = "";
}

/**
 * @description Execute the delete after confirmation.
 */
async function confirmDelete() {
  if (!pendingDeleteFilename) return;

  const filename = pendingDeleteFilename;
  hideDeleteDialog();

  const result = await apiRequest("/api/backup/" + encodeURIComponent(filename), {
    method: "DELETE",
  });

  if (!result.ok) {
    showError("page-messages", "Delete failed", result.detail || result.error);
    return;
  }

  showSuccess("page-messages", result.data.message);
  await loadBackups();
}

// Initialise the page
document.addEventListener("DOMContentLoaded", async function () {
  await loadBackups();

  document.getElementById("backup-btn").addEventListener("click", createBackup);
  document.getElementById("restore-cancel-btn").addEventListener("click", hideRestoreDialog);
  document.getElementById("restore-confirm-btn").addEventListener("click", confirmRestore);
  document.getElementById("delete-cancel-btn").addEventListener("click", hideDeleteDialog);
  document.getElementById("delete-confirm-btn").addEventListener("click", confirmDelete);
});

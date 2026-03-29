/**
 * @description Lists Manager page — provides CRUD UI for managing spreadsheet
 * links and PDF document uploads. Spreadsheets are stored as share links that
 * the server wraps into iframe HTML. PDFs are uploaded to docs/lists/.
 */

/** @type {Array<{title: string, spreadsheet: string, iframe: string, range: string}>} */
var spreadsheetItems = [];

/** @type {Array<{title: string, filename: string}>} */
var documentItems = [];

// ─── Data loading ────────────────────────────────────────────────────────────

/**
 * @description Load all lists data from the server and render both sections.
 */
async function loadLists() {
  var result = await apiRequest("/api/config/lists");
  if (!result.ok) {
    showError("page-messages", result.error || "Failed to load lists", result.detail || "");
    return;
  }
  spreadsheetItems = result.data.items || [];
  documentItems = result.data.documents || [];
  renderSpreadsheets();
  renderDocuments();
}

// ─── Spreadsheet rendering ───────────────────────────────────────────────────

/**
 * @description Extract the src URL from an iframe HTML string.
 * Used to show the share link back to the user when editing.
 * @param {string} iframeHtml - The full iframe HTML tag
 * @returns {string} The src URL, or empty string if not found
 */
function extractSrcFromIframe(iframeHtml) {
  var match = iframeHtml.match(/src="([^"]+)"/);
  if (!match) {
    match = iframeHtml.match(/src='([^']+)'/);
  }
  return match ? match[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"') : "";
}

/**
 * @description Render the spreadsheets table showing all configured spreadsheet links.
 */
function renderSpreadsheets() {
  var container = document.getElementById("spreadsheets-list");
  if (!container) return;

  if (spreadsheetItems.length === 0) {
    container.innerHTML = '<p class="text-brand-500 text-sm">No spreadsheets configured. Click "Add Spreadsheet" to add one.</p>';
    return;
  }

  var html = '<table class="w-full text-sm">';
  html += '<thead><tr class="border-b border-brand-200 text-left">';
  html += '<th class="py-2 pr-4 font-medium text-brand-700">Title</th>';
  html += '<th class="py-2 pr-4 font-medium text-brand-700">Type</th>';
  html += '<th class="py-2 text-right font-medium text-brand-700">Actions</th>';
  html += '</tr></thead><tbody>';

  for (var i = 0; i < spreadsheetItems.length; i++) {
    var item = spreadsheetItems[i];
    var typeLabel = item.spreadsheet === "microsoft" ? "Microsoft Excel" : "Google Sheets";
    html += '<tr class="border-b border-brand-100">';
    html += '<td class="py-3 pr-4">' + escapeHtml(item.title) + '</td>';
    html += '<td class="py-3 pr-4 text-brand-600">' + escapeHtml(typeLabel) + '</td>';
    html += '<td class="py-3 text-right">';
    html += '<button class="text-brand-600 hover:text-brand-800 mr-3" onclick="editSpreadsheet(' + i + ')">Edit</button>';
    html += '<button class="text-red-600 hover:text-red-800" onclick="confirmDeleteSpreadsheet(' + i + ')">Delete</button>';
    html += '</td></tr>';
  }

  html += '</tbody></table>';
  container.innerHTML = html;
}

// ─── Document rendering ──────────────────────────────────────────────────────

/**
 * @description Render the documents table showing all uploaded PDFs.
 */
function renderDocuments() {
  var container = document.getElementById("documents-list");
  if (!container) return;

  if (documentItems.length === 0) {
    container.innerHTML = '<p class="text-brand-500 text-sm">No documents uploaded. Click "Add Document" to upload a PDF.</p>';
    return;
  }

  var html = '<table class="w-full text-sm">';
  html += '<thead><tr class="border-b border-brand-200 text-left">';
  html += '<th class="py-2 pr-4 font-medium text-brand-700">Title</th>';
  html += '<th class="py-2 pr-4 font-medium text-brand-700">Filename</th>';
  html += '<th class="py-2 text-right font-medium text-brand-700">Actions</th>';
  html += '</tr></thead><tbody>';

  for (var i = 0; i < documentItems.length; i++) {
    var doc = documentItems[i];
    html += '<tr class="border-b border-brand-100">';
    html += '<td class="py-3 pr-4">' + escapeHtml(doc.title) + '</td>';
    html += '<td class="py-3 pr-4 text-brand-600">';
    html += '<a href="/docs/lists/' + encodeURIComponent(doc.filename) + '" target="_blank" class="hover:underline">' + escapeHtml(doc.filename) + '</a>';
    html += '</td>';
    html += '<td class="py-3 text-right">';
    html += '<button class="text-brand-600 hover:text-brand-800 mr-3" onclick="editDocument(' + i + ')">Edit Title</button>';
    html += '<button class="text-red-600 hover:text-red-800" onclick="confirmDeleteDocument(' + i + ')">Delete</button>';
    html += '</td></tr>';
  }

  html += '</tbody></table>';
  container.innerHTML = html;
}

// ─── Spreadsheet modal ──────────────────────────────────────────────────────

/**
 * @description Show the spreadsheet add/edit modal.
 * @param {number|null} editIndex - Index of item to edit, or null for new
 */
function showSpreadsheetModal(editIndex) {
  var isEdit = editIndex !== null && editIndex >= 0;
  var item = isEdit ? spreadsheetItems[editIndex] : null;

  var title = item ? item.title : "";
  var type = item ? item.spreadsheet : "google";
  var shareLink = item ? extractSrcFromIframe(item.iframe) : "";
  var range = item ? (item.range || "") : "";

  var overlay = document.createElement("div");
  overlay.id = "lists-modal-overlay";
  overlay.className = "fixed inset-0 bg-black/40 flex items-center justify-center z-50";

  var modalHtml = '<div class="bg-white rounded-lg shadow-xl border border-brand-200 w-full max-w-lg mx-4 p-6">';
  modalHtml += '<h3 class="text-lg font-semibold text-brand-800 mb-4">' + (isEdit ? "Edit Spreadsheet" : "Add Spreadsheet") + '</h3>';

  modalHtml += '<div class="space-y-4">';

  // Title
  modalHtml += '<div>';
  modalHtml += '<label class="block text-sm font-medium text-brand-700 mb-1" for="ss-title">Title</label>';
  modalHtml += '<input id="ss-title" type="text" class="w-full border border-brand-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" value="' + escapeHtml(title) + '" placeholder="e.g. Historic Valuations" />';
  modalHtml += '</div>';

  // Type
  modalHtml += '<div>';
  modalHtml += '<label class="block text-sm font-medium text-brand-700 mb-1" for="ss-type">Type</label>';
  modalHtml += '<select id="ss-type" class="w-full border border-brand-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400">';
  modalHtml += '<option value="google"' + (type === "google" ? ' selected' : '') + '>Google Sheets</option>';
  modalHtml += '<option value="microsoft"' + (type === "microsoft" ? ' selected' : '') + '>Microsoft Excel</option>';
  modalHtml += '</select>';
  modalHtml += '</div>';

  // Share link
  modalHtml += '<div>';
  modalHtml += '<label class="block text-sm font-medium text-brand-700 mb-1" for="ss-link">Share Link</label>';
  modalHtml += '<input id="ss-link" type="url" class="w-full border border-brand-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" value="' + escapeHtml(shareLink) + '" placeholder="Paste the share link from your spreadsheet" />';
  modalHtml += '<p class="text-xs text-brand-500 mt-1">Paste the full share URL from Google Sheets or Microsoft Excel Online.</p>';
  modalHtml += '</div>';

  // Range (optional)
  modalHtml += '<div>';
  modalHtml += '<label class="block text-sm font-medium text-brand-700 mb-1" for="ss-range">Range (optional)</label>';
  modalHtml += '<input id="ss-range" type="text" class="w-full border border-brand-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" value="' + escapeHtml(range) + '" placeholder="e.g. A2:F14 (Google) or MyTable (Excel)" />';
  modalHtml += '<p class="text-xs text-brand-500 mt-1">Google Sheets: cell range (e.g. A2:F14). Excel: named range defined in the workbook.</p>';
  modalHtml += '</div>';

  modalHtml += '</div>';

  // Modal messages
  modalHtml += '<div id="ss-modal-messages" class="mt-3"></div>';

  // Buttons
  modalHtml += '<div class="flex justify-end gap-3 mt-6">';
  modalHtml += '<button id="ss-cancel" class="px-4 py-2 border border-brand-300 rounded-md text-sm text-brand-700 hover:bg-brand-50 transition-colors">Cancel</button>';
  modalHtml += '<button id="ss-save" class="px-4 py-2 bg-brand-600 text-white rounded-md text-sm hover:bg-brand-700 transition-colors">' + (isEdit ? "Save Changes" : "Add") + '</button>';
  modalHtml += '</div>';

  modalHtml += '</div>';
  overlay.innerHTML = modalHtml;
  document.body.appendChild(overlay);

  // Focus the title input
  var titleInput = document.getElementById("ss-title");
  if (titleInput) titleInput.focus();

  // Close on overlay click
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) closeModal();
  });

  // Cancel button
  document.getElementById("ss-cancel").addEventListener("click", closeModal);

  // Save button
  document.getElementById("ss-save").addEventListener("click", function () {
    saveSpreadsheet(editIndex);
  });
}

/**
 * @description Save a spreadsheet entry (add or update).
 * @param {number|null} editIndex - Index to update, or null for new entry
 */
async function saveSpreadsheet(editIndex) {
  var title = document.getElementById("ss-title").value.trim();
  var spreadsheet = document.getElementById("ss-type").value;
  var shareLink = document.getElementById("ss-link").value.trim();
  var range = document.getElementById("ss-range").value.trim();

  if (!title) {
    showError("ss-modal-messages", "Title is required");
    return;
  }
  if (!shareLink) {
    showError("ss-modal-messages", "Share link is required");
    return;
  }

  var isEdit = editIndex !== null && editIndex >= 0;
  var url = isEdit
    ? "/api/config/lists/spreadsheet/" + editIndex
    : "/api/config/lists/spreadsheet";
  var method = isEdit ? "PUT" : "POST";

  var result = await apiRequest(url, {
    method: method,
    body: { title: title, spreadsheet: spreadsheet, shareLink: shareLink, range: range },
  });

  if (!result.ok) {
    showError("ss-modal-messages", result.error || "Failed to save", result.detail || "");
    return;
  }

  closeModal();
  showSuccess("page-messages", isEdit ? "Spreadsheet updated" : "Spreadsheet added");
  loadLists();
}

/**
 * @description Open the spreadsheet modal for editing an existing entry.
 * @param {number} index - The spreadsheet index to edit
 */
function editSpreadsheet(index) {
  showSpreadsheetModal(index);
}

/**
 * @description Show a confirmation dialog before deleting a spreadsheet.
 * @param {number} index - The spreadsheet index to delete
 */
function confirmDeleteSpreadsheet(index) {
  var item = spreadsheetItems[index];
  if (!item) return;

  showConfirmDialog(
    "Delete Spreadsheet",
    'Are you sure you want to delete "' + escapeHtml(item.title) + '"?',
    function () { deleteSpreadsheet(index); }
  );
}

/**
 * @description Delete a spreadsheet entry by index.
 * @param {number} index - The spreadsheet index to delete
 */
async function deleteSpreadsheet(index) {
  var result = await apiRequest("/api/config/lists/spreadsheet/" + index, { method: "DELETE" });
  if (!result.ok) {
    showError("page-messages", result.error || "Failed to delete", result.detail || "");
    return;
  }
  showSuccess("page-messages", "Spreadsheet deleted");
  loadLists();
}

// ─── Document modal ─────────────────────────────────────────────────────────

/**
 * @description Show the document upload modal with drag-and-drop support.
 */
function showDocumentUploadModal() {
  var overlay = document.createElement("div");
  overlay.id = "lists-modal-overlay";
  overlay.className = "fixed inset-0 bg-black/40 flex items-center justify-center z-50";

  var modalHtml = '<div class="bg-white rounded-lg shadow-xl border border-brand-200 w-full max-w-lg mx-4 p-6">';
  modalHtml += '<h3 class="text-lg font-semibold text-brand-800 mb-4">Add Document</h3>';

  modalHtml += '<div class="space-y-4">';

  // Title
  modalHtml += '<div>';
  modalHtml += '<label class="block text-sm font-medium text-brand-700 mb-1" for="doc-title">Title</label>';
  modalHtml += '<input id="doc-title" type="text" class="w-full border border-brand-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" placeholder="e.g. Tax Summary 2025" />';
  modalHtml += '</div>';

  // File drop zone
  modalHtml += '<div>';
  modalHtml += '<label class="block text-sm font-medium text-brand-700 mb-1">PDF File</label>';
  modalHtml += '<div id="doc-dropzone" class="border-2 border-dashed border-brand-300 rounded-lg p-8 text-center cursor-pointer hover:border-brand-400 transition-colors">';
  modalHtml += '<p class="text-sm text-brand-600 mb-1">Drag and drop a PDF here, or click to select</p>';
  modalHtml += '<p class="text-xs text-brand-400">Maximum file size: 20 MB</p>';
  modalHtml += '</div>';
  modalHtml += '<input id="doc-file-input" type="file" accept=".pdf" class="hidden" />';
  modalHtml += '<p id="doc-file-name" class="text-sm text-brand-600 mt-2 hidden"></p>';
  modalHtml += '</div>';

  modalHtml += '</div>';

  // Modal messages
  modalHtml += '<div id="doc-modal-messages" class="mt-3"></div>';

  // Buttons
  modalHtml += '<div class="flex justify-end gap-3 mt-6">';
  modalHtml += '<button id="doc-cancel" class="px-4 py-2 border border-brand-300 rounded-md text-sm text-brand-700 hover:bg-brand-50 transition-colors">Cancel</button>';
  modalHtml += '<button id="doc-save" class="px-4 py-2 bg-brand-600 text-white rounded-md text-sm hover:bg-brand-700 transition-colors">Upload</button>';
  modalHtml += '</div>';

  modalHtml += '</div>';
  overlay.innerHTML = modalHtml;
  document.body.appendChild(overlay);

  // Focus the title input
  var titleInput = document.getElementById("doc-title");
  if (titleInput) titleInput.focus();

  // Store selected file reference
  var selectedFile = null;

  var dropzone = document.getElementById("doc-dropzone");
  var fileInput = document.getElementById("doc-file-input");
  var fileNameDisplay = document.getElementById("doc-file-name");

  /**
   * @description Update the file name display after a file is selected.
   * @param {File} file - The selected PDF file
   */
  function setSelectedFile(file) {
    selectedFile = file;
    fileNameDisplay.textContent = "Selected: " + file.name + " (" + formatFileSize(file.size) + ")";
    fileNameDisplay.classList.remove("hidden");
    dropzone.classList.add("border-green-400", "bg-green-50");
    dropzone.classList.remove("border-brand-300");
  }

  // Click to open file picker
  dropzone.addEventListener("click", function () {
    fileInput.click();
  });

  fileInput.addEventListener("change", function () {
    if (fileInput.files && fileInput.files[0]) {
      setSelectedFile(fileInput.files[0]);
    }
  });

  // Drag and drop handlers
  dropzone.addEventListener("dragover", function (e) {
    e.preventDefault();
    dropzone.classList.add("border-brand-500", "bg-brand-50");
  });

  dropzone.addEventListener("dragleave", function () {
    dropzone.classList.remove("border-brand-500", "bg-brand-50");
  });

  dropzone.addEventListener("drop", function (e) {
    e.preventDefault();
    dropzone.classList.remove("border-brand-500", "bg-brand-50");
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      var file = e.dataTransfer.files[0];
      if (file.name.toLowerCase().endsWith(".pdf")) {
        setSelectedFile(file);
      } else {
        showError("doc-modal-messages", "Only PDF files are allowed");
      }
    }
  });

  // Close on overlay click
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) closeModal();
  });

  document.getElementById("doc-cancel").addEventListener("click", closeModal);

  document.getElementById("doc-save").addEventListener("click", async function () {
    var title = document.getElementById("doc-title").value.trim();
    if (!title) {
      showError("doc-modal-messages", "Title is required");
      return;
    }
    if (!selectedFile) {
      showError("doc-modal-messages", "Please select a PDF file");
      return;
    }

    var formData = new FormData();
    formData.append("title", title);
    formData.append("file", selectedFile);

    // Use fetch directly because apiRequest sets Content-Type to JSON
    try {
      var response = await fetch("/api/config/lists/document", {
        method: "POST",
        body: formData,
      });
      var data = await response.json();

      if (!response.ok) {
        showError("doc-modal-messages", data.error || "Upload failed", data.detail || "");
        return;
      }

      closeModal();
      var msg = "Document uploaded";
      if (data.isDuplicate) {
        msg += " (saved as " + data.filename + " — a file with the original name already existed)";
      }
      showSuccess("page-messages", msg);
      loadLists();
    } catch (err) {
      showError("doc-modal-messages", "Upload failed", err.message);
    }
  });
}

/**
 * @description Show the document title edit modal.
 * @param {number} index - The document index to edit
 */
function showDocumentEditModal(index) {
  var doc = documentItems[index];
  if (!doc) return;

  var overlay = document.createElement("div");
  overlay.id = "lists-modal-overlay";
  overlay.className = "fixed inset-0 bg-black/40 flex items-center justify-center z-50";

  var modalHtml = '<div class="bg-white rounded-lg shadow-xl border border-brand-200 w-full max-w-lg mx-4 p-6">';
  modalHtml += '<h3 class="text-lg font-semibold text-brand-800 mb-4">Edit Document Title</h3>';

  modalHtml += '<div class="space-y-4">';
  modalHtml += '<div>';
  modalHtml += '<label class="block text-sm font-medium text-brand-700 mb-1" for="doc-edit-title">Title</label>';
  modalHtml += '<input id="doc-edit-title" type="text" class="w-full border border-brand-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" value="' + escapeHtml(doc.title) + '" />';
  modalHtml += '</div>';
  modalHtml += '<p class="text-sm text-brand-500">File: ' + escapeHtml(doc.filename) + '</p>';
  modalHtml += '</div>';

  modalHtml += '<div id="doc-edit-messages" class="mt-3"></div>';

  modalHtml += '<div class="flex justify-end gap-3 mt-6">';
  modalHtml += '<button id="doc-edit-cancel" class="px-4 py-2 border border-brand-300 rounded-md text-sm text-brand-700 hover:bg-brand-50 transition-colors">Cancel</button>';
  modalHtml += '<button id="doc-edit-save" class="px-4 py-2 bg-brand-600 text-white rounded-md text-sm hover:bg-brand-700 transition-colors">Save Changes</button>';
  modalHtml += '</div>';

  modalHtml += '</div>';
  overlay.innerHTML = modalHtml;
  document.body.appendChild(overlay);

  var titleInput = document.getElementById("doc-edit-title");
  if (titleInput) titleInput.focus();

  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) closeModal();
  });

  document.getElementById("doc-edit-cancel").addEventListener("click", closeModal);

  document.getElementById("doc-edit-save").addEventListener("click", async function () {
    var title = document.getElementById("doc-edit-title").value.trim();
    if (!title) {
      showError("doc-edit-messages", "Title is required");
      return;
    }

    var result = await apiRequest("/api/config/lists/document/" + index, {
      method: "PUT",
      body: { title: title },
    });

    if (!result.ok) {
      showError("doc-edit-messages", result.error || "Failed to save", result.detail || "");
      return;
    }

    closeModal();
    showSuccess("page-messages", "Document title updated");
    loadLists();
  });
}

/**
 * @description Open the document title edit modal.
 * @param {number} index - The document index to edit
 */
function editDocument(index) {
  showDocumentEditModal(index);
}

/**
 * @description Show a confirmation dialog before deleting a document.
 * @param {number} index - The document index to delete
 */
function confirmDeleteDocument(index) {
  var doc = documentItems[index];
  if (!doc) return;

  showConfirmDialog(
    "Delete Document",
    'Are you sure you want to delete "' + escapeHtml(doc.title) + '"? The PDF file will also be removed.',
    function () { deleteDocument(index); }
  );
}

/**
 * @description Delete a document entry and its file by index.
 * @param {number} index - The document index to delete
 */
async function deleteDocument(index) {
  var result = await apiRequest("/api/config/lists/document/" + index, { method: "DELETE" });
  if (!result.ok) {
    showError("page-messages", result.error || "Failed to delete", result.detail || "");
    return;
  }
  showSuccess("page-messages", "Document deleted");
  loadLists();
}

// ─── Shared utilities ────────────────────────────────────────────────────────

/**
 * @description Close any open modal overlay.
 */
function closeModal() {
  var overlay = document.getElementById("lists-modal-overlay");
  if (overlay) overlay.remove();
}

/**
 * @description Show a simple confirmation dialog with OK/Cancel.
 * @param {string} title - Dialog title
 * @param {string} message - Confirmation message
 * @param {Function} onConfirm - Callback if user confirms
 */
function showConfirmDialog(title, message, onConfirm) {
  var overlay = document.createElement("div");
  overlay.id = "lists-modal-overlay";
  overlay.className = "fixed inset-0 bg-black/40 flex items-center justify-center z-50";

  var html = '<div class="bg-white rounded-lg shadow-xl border border-brand-200 w-full max-w-sm mx-4 p-6">';
  html += '<h3 class="text-lg font-semibold text-brand-800 mb-3">' + title + '</h3>';
  html += '<p class="text-sm text-brand-700 mb-6">' + message + '</p>';
  html += '<div class="flex justify-end gap-3">';
  html += '<button id="confirm-cancel" class="px-4 py-2 border border-brand-300 rounded-md text-sm text-brand-700 hover:bg-brand-50 transition-colors">Cancel</button>';
  html += '<button id="confirm-ok" class="px-4 py-2 bg-red-600 text-white rounded-md text-sm hover:bg-red-700 transition-colors">Delete</button>';
  html += '</div></div>';

  overlay.innerHTML = html;
  document.body.appendChild(overlay);

  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) closeModal();
  });

  document.getElementById("confirm-cancel").addEventListener("click", closeModal);

  document.getElementById("confirm-ok").addEventListener("click", function () {
    closeModal();
    onConfirm();
  });
}

/**
 * @description Format a file size in bytes to a human-readable string.
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted size string (e.g. "2.4 MB")
 */
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

// ─── Initialisation ──────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", function () {
  loadLists();

  document.getElementById("btn-add-spreadsheet").addEventListener("click", function () {
    showSpreadsheetModal(null);
  });

  document.getElementById("btn-add-document").addEventListener("click", function () {
    showDocumentUploadModal();
  });
});

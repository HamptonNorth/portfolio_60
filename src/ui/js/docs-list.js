/**
 * @description Page logic for the docs list view.
 * Displays all markdown pages in a selected category with controls
 * for editing, uploading, publishing, and deleting documents.
 */

/* global apiRequest, showSuccess, showError, escapeHtml */

/** @type {Array} All pages loaded from the API */
var allPages = [];

/** @type {number} Number of pages currently visible (pagination) */
var visibleCount = 15;

/** @type {string} Current category from URL query parameter */
var currentCategory = "";

/** @type {string|null} Slug of the page currently being edited */
var editingSlug = null;

/** @type {string|null} Slug of the page pending deletion */
var deletingSlug = null;

/** @type {Array<{word: string, offset: number, length: number}>} Current spell errors */
var spellErrors = [];

/** @type {boolean} Whether spellcheck is active for this editor session */
var spellActive = false;

/** @type {number|null} Debounce timer for auto-rerun on edit */
var spellDebounceTimer = null;

/** @type {string|null} Word targeted by the right-click context menu */
var contextMenuWord = null;

/**
 * @description Initialise the page on load. Reads the category from the
 * URL query string and loads the page list.
 */
function init() {
  var params = new URLSearchParams(window.location.search);
  currentCategory = params.get("category") || "";

  if (!currentCategory) {
    document.getElementById("pages-container").innerHTML = '<p class="text-brand-500">No category specified. Use the Docs menu to select a category.</p>';
    return;
  }

  // Update heading with category label
  fetchCategoryLabel();
  loadPages();
  setupEventListeners();
}

/**
 * @description Fetch the category label from the docs config and update
 * the page heading.
 */
async function fetchCategoryLabel() {
  try {
    var response = await fetch("/api/docs/config");
    if (!response.ok) return;
    var data = await response.json();
    var catConfig = data.categories[currentCategory];
    if (catConfig && catConfig.label) {
      document.getElementById("page-heading").textContent = catConfig.label;
      document.title = "Portfolio 60 — " + catConfig.label;
    }
  } catch (e) {
    // Fall back to category name
  }
}

/**
 * @description Load pages from the API for the current category.
 */
async function loadPages() {
  try {
    var response = await fetch("/api/docs/list/" + encodeURIComponent(currentCategory));
    if (!response.ok) {
      showError("page-messages", "Failed to load pages");
      return;
    }

    var data = await response.json();
    allPages = data.pages || [];
    visibleCount = 15;
    renderPages();
  } catch (err) {
    showError("page-messages", "Failed to load pages", err.message);
  }
}

/**
 * @description Render the page list cards. Shows up to visibleCount pages
 * with a "Load more" button if there are more.
 */
function renderPages() {
  var container = document.getElementById("pages-container");

  if (allPages.length === 0) {
    container.innerHTML = '<div class="bg-white rounded-lg border border-brand-200 p-8 text-center">' + '<p class="text-brand-500 text-lg mb-2">No documents yet</p>' + '<p class="text-brand-400">Upload a markdown file to get started.</p>' + "</div>";
    document.getElementById("load-more-container").classList.add("hidden");
    return;
  }

  var visible = allPages.slice(0, visibleCount);
  var html = "";

  for (var i = 0; i < visible.length; i++) {
    var page = visible[i];
    var isUnpublished = page.published === "n";
    var isSticky = page.sticky === "true" || page.sticky === true;

    var dateStr = "";
    if (page.created) {
      var d = new Date(page.created);
      if (!isNaN(d)) {
        dateStr = d.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" });
      }
    }

    html += '<div class="bg-white rounded-lg border border-brand-200 p-5 mb-3 hover:shadow-md transition-shadow">';
    html += '<div class="flex items-start justify-between">';
    html += '<div class="flex-1 min-w-0 cursor-pointer" data-nav-slug="' + escapeHtml(page.slug) + '">';

    // Title with badges
    html += '<h3 class="text-lg font-semibold text-brand-800">';
    if (isSticky) {
      html += '<span class="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded mr-2">Pinned</span>';
    }
    if (isUnpublished) {
      html += '<span class="text-xs bg-brand-100 text-brand-500 px-2 py-0.5 rounded mr-2">Draft</span>';
    }
    html += escapeHtml(page.title) + "</h3>";

    // Summary and date
    if (page.summary) {
      html += '<p class="text-brand-500 mt-1">' + escapeHtml(page.summary) + "</p>";
    }
    if (dateStr) {
      html += '<p class="text-sm text-brand-400 mt-1">' + dateStr + "</p>";
    }

    html += "</div>";

    // Action buttons
    html += '<div class="flex gap-2 ml-4 flex-shrink-0">';
    html += '<button class="text-sm text-brand-500 hover:text-brand-700 transition-colors edit-btn" data-slug="' + escapeHtml(page.slug) + '">Edit</button>';
    html += '<button class="text-sm text-brand-400 hover:text-red-600 transition-colors delete-btn" data-slug="' + escapeHtml(page.slug) + '" data-title="' + escapeHtml(page.title) + '">Delete</button>';
    html += "</div>";

    html += "</div></div>";
  }

  container.innerHTML = html;

  // Load more button
  var loadMoreContainer = document.getElementById("load-more-container");
  if (allPages.length > visibleCount) {
    loadMoreContainer.classList.remove("hidden");
  } else {
    loadMoreContainer.classList.add("hidden");
  }

  // Attach click handlers for navigation
  container.querySelectorAll("[data-nav-slug]").forEach(function (el) {
    el.addEventListener("click", function () {
      var slug = el.getAttribute("data-nav-slug");
      window.location.href = "/pages/docs-page.html?category=" + encodeURIComponent(currentCategory) + "&slug=" + encodeURIComponent(slug);
    });
  });

  // Attach edit button handlers
  container.querySelectorAll(".edit-btn").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      openEditor(btn.getAttribute("data-slug"));
    });
  });

  // Attach delete button handlers
  container.querySelectorAll(".delete-btn").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      openDeleteModal(btn.getAttribute("data-slug"), btn.getAttribute("data-title"));
    });
  });
}

/**
 * @description Set up event listeners for upload, editor, and delete modals.
 */
function setupEventListeners() {
  // Upload modal
  document.getElementById("upload-btn").addEventListener("click", openUploadModal);
  document.getElementById("upload-cancel-btn").addEventListener("click", closeUploadModal);
  document.getElementById("upload-modal").addEventListener("click", function (e) {
    if (e.target === this) closeUploadModal();
  });

  // Drag and drop
  var dropZone = document.getElementById("upload-drop-zone");
  dropZone.addEventListener("click", function () {
    document.getElementById("upload-file-input").click();
  });
  dropZone.addEventListener("dragover", function (e) {
    e.preventDefault();
    dropZone.classList.add("border-brand-500", "bg-brand-50");
  });
  dropZone.addEventListener("dragleave", function () {
    dropZone.classList.remove("border-brand-500", "bg-brand-50");
  });
  dropZone.addEventListener("drop", function (e) {
    e.preventDefault();
    dropZone.classList.remove("border-brand-500", "bg-brand-50");
    if (e.dataTransfer.files.length > 0) {
      uploadFile(e.dataTransfer.files[0]);
    }
  });
  document.getElementById("upload-file-input").addEventListener("change", function (e) {
    if (e.target.files.length > 0) {
      uploadFile(e.target.files[0]);
    }
  });

  // Editor modal
  document.getElementById("editor-cancel-btn").addEventListener("click", closeEditor);
  document.getElementById("editor-save-btn").addEventListener("click", saveEditor);
  document.getElementById("editor-modal").addEventListener("click", function (e) {
    if (e.target === this) closeEditor();
  });

  // Media upload in editor
  document.getElementById("editor-media-btn").addEventListener("click", function () {
    document.getElementById("media-file-input").click();
  });
  document.getElementById("media-file-input").addEventListener("change", function (e) {
    if (e.target.files.length > 0) {
      uploadMedia(e.target.files[0]);
    }
  });

  // Delete modal
  document.getElementById("delete-cancel-btn").addEventListener("click", closeDeleteModal);
  document.getElementById("delete-confirm-btn").addEventListener("click", confirmDelete);
  document.getElementById("delete-modal").addEventListener("click", function (e) {
    if (e.target === this) closeDeleteModal();
  });

  // Load more
  document.getElementById("load-more-btn").addEventListener("click", function () {
    visibleCount += 15;
    renderPages();
  });

  // Escape key closes modals
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      closeUploadModal();
      closeEditor();
      closeDeleteModal();
      hideContextMenu();
    }
  });

  // Spellcheck button
  document.getElementById("editor-spell-btn").addEventListener("click", function () {
    spellActive = true;
    runSpellCheck();
  });

  // Auto-rerun spellcheck on edit (debounced)
  document.getElementById("editor-textarea").addEventListener("input", function () {
    if (!spellActive) return;
    clearTimeout(spellDebounceTimer);
    spellDebounceTimer = setTimeout(runSpellCheck, 800);
  });

  // Sync scroll between textarea and highlights overlay
  document.getElementById("editor-textarea").addEventListener("scroll", syncScroll);

  // Right-click context menu on textarea
  document.getElementById("editor-textarea").addEventListener("contextmenu", handleContextMenu);

  // Add to dictionary from context menu
  document.getElementById("spell-add-word-btn").addEventListener("click", addWordToDictionary);

  // Hide context menu on click elsewhere
  document.addEventListener("click", function (e) {
    var menu = document.getElementById("spell-context-menu");
    if (!menu.contains(e.target)) {
      hideContextMenu();
    }
  });
}

// =============================================================================
// Upload
// =============================================================================

/**
 * @description Open the upload modal.
 */
function openUploadModal() {
  document.getElementById("upload-errors").textContent = "";
  document.getElementById("upload-file-input").value = "";
  document.getElementById("upload-modal").classList.remove("hidden");
}

/**
 * @description Close the upload modal.
 */
function closeUploadModal() {
  document.getElementById("upload-modal").classList.add("hidden");
}

/**
 * @description Upload a markdown file to the current category.
 * @param {File} file - The file to upload
 */
async function uploadFile(file) {
  var errorsEl = document.getElementById("upload-errors");
  errorsEl.textContent = "";

  if (!file.name.endsWith(".md")) {
    errorsEl.textContent = "Only .md files are allowed.";
    return;
  }

  var formData = new FormData();
  formData.append("file", file);

  try {
    var response = await fetch("/api/docs/upload/" + encodeURIComponent(currentCategory), {
      method: "POST",
      body: formData,
    });

    var data = await response.json();

    if (!response.ok) {
      errorsEl.textContent = data.error || "Upload failed";
      return;
    }

    closeUploadModal();
    showSuccess("page-messages", data.message || "File uploaded successfully");
    loadPages();
  } catch (err) {
    errorsEl.textContent = "Upload failed: " + err.message;
  }
}

// =============================================================================
// Editor
// =============================================================================

/**
 * @description Open the editor modal with the raw markdown for a page.
 * @param {string} slug - The page slug to edit
 */
async function openEditor(slug) {
  editingSlug = slug;
  var errorsEl = document.getElementById("editor-errors");
  errorsEl.textContent = "";
  document.getElementById("editor-media-result").classList.add("hidden");

  try {
    var response = await fetch("/api/docs/raw/" + encodeURIComponent(currentCategory) + "/" + encodeURIComponent(slug));
    if (!response.ok) {
      showError("page-messages", "Failed to load document for editing");
      return;
    }

    var data = await response.json();
    document.getElementById("editor-title").textContent = "Edit: " + (data.meta.title || slug);
    document.getElementById("editor-textarea").value = data.raw;
    document.getElementById("editor-modal").classList.remove("hidden");
    document.getElementById("editor-textarea").focus();
  } catch (err) {
    showError("page-messages", "Failed to open editor", err.message);
  }
}

/**
 * @description Close the editor modal.
 */
function closeEditor() {
  document.getElementById("editor-modal").classList.add("hidden");
  editingSlug = null;
  resetSpellCheck();
}

/**
 * @description Save the editor content back to the server.
 */
async function saveEditor() {
  if (!editingSlug) return;

  var content = document.getElementById("editor-textarea").value;
  var errorsEl = document.getElementById("editor-errors");
  errorsEl.textContent = "";

  try {
    var response = await fetch("/api/docs/raw/" + encodeURIComponent(currentCategory) + "/" + encodeURIComponent(editingSlug), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: content }),
    });

    var data = await response.json();

    if (!response.ok) {
      errorsEl.textContent = data.error || "Save failed";
      return;
    }

    closeEditor();
    showSuccess("page-messages", "Document saved successfully");
    loadPages();
  } catch (err) {
    errorsEl.textContent = "Save failed: " + err.message;
  }
}

/**
 * @description Upload a media file (image) for use in the current document.
 * @param {File} file - The image file to upload
 */
async function uploadMedia(file) {
  var resultEl = document.getElementById("editor-media-result");
  resultEl.classList.add("hidden");

  var formData = new FormData();
  formData.append("file", file);

  try {
    var response = await fetch("/api/docs/media/" + encodeURIComponent(currentCategory), {
      method: "POST",
      body: formData,
    });

    var data = await response.json();

    if (!response.ok) {
      resultEl.textContent = data.error || "Upload failed";
      resultEl.classList.remove("hidden");
      return;
    }

    // Show the markdown usage snippet so the user can copy it
    resultEl.innerHTML = 'Image uploaded. Markdown: <code class="bg-brand-50 px-2 py-0.5 rounded text-xs font-mono select-all">' + escapeHtml(data.markdownUsage) + "</code>";
    resultEl.classList.remove("hidden");

    // Reset file input
    document.getElementById("media-file-input").value = "";
  } catch (err) {
    resultEl.textContent = "Upload failed: " + err.message;
    resultEl.classList.remove("hidden");
  }
}

// =============================================================================
// Delete
// =============================================================================

/**
 * @description Open the delete confirmation modal.
 * @param {string} slug - The page slug to delete
 * @param {string} title - The page title for the confirmation message
 */
function openDeleteModal(slug, title) {
  deletingSlug = slug;
  document.getElementById("delete-message").textContent = 'Are you sure you want to delete "' + title + '"? This cannot be undone.';
  document.getElementById("delete-modal").classList.remove("hidden");
}

/**
 * @description Close the delete confirmation modal.
 */
function closeDeleteModal() {
  document.getElementById("delete-modal").classList.add("hidden");
  deletingSlug = null;
}

/**
 * @description Confirm and execute the deletion of a page.
 */
async function confirmDelete() {
  if (!deletingSlug) return;

  try {
    var response = await fetch("/api/docs/" + encodeURIComponent(currentCategory) + "/" + encodeURIComponent(deletingSlug), { method: "DELETE" });

    var data = await response.json();

    if (!response.ok) {
      showError("page-messages", data.error || "Delete failed");
      closeDeleteModal();
      return;
    }

    closeDeleteModal();
    showSuccess("page-messages", "Document deleted successfully");
    loadPages();
  } catch (err) {
    showError("page-messages", "Delete failed", err.message);
    closeDeleteModal();
  }
}

// =============================================================================
// Spellcheck
// =============================================================================

/**
 * @description Run a spellcheck on the current editor content by calling
 * the server API. Updates the highlights overlay and error count display.
 */
async function runSpellCheck() {
  var textarea = document.getElementById("editor-textarea");
  var content = textarea.value;

  if (!content.trim()) {
    spellErrors = [];
    updateHighlights();
    updateSpellCount();
    return;
  }

  try {
    var response = await fetch("/api/docs/spellcheck", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: content }),
    });

    if (!response.ok) {
      return;
    }

    var data = await response.json();
    spellErrors = data.errors || [];
    updateHighlights();
    updateSpellCount();
  } catch (err) {
    // Silently fail — spellcheck is non-critical
  }
}

/**
 * @description Update the mirror-div overlay to show red wavy underlines
 * under misspelt words. The overlay text is transparent so only the
 * underline decorations are visible beneath the textarea.
 */
function updateHighlights() {
  var textarea = document.getElementById("editor-textarea");
  var highlights = document.getElementById("editor-highlights");
  var text = textarea.value;

  if (spellErrors.length === 0) {
    // Show plain escaped text to maintain layout synchronisation
    highlights.innerHTML = escapeHtml(text) + "\n";
    syncScroll();
    return;
  }

  // Sort errors by offset so we can process left-to-right
  var sorted = spellErrors.slice().sort(function (a, b) {
    return a.offset - b.offset;
  });

  // Build highlighted HTML by inserting <mark> tags at error positions
  var html = "";
  var lastIndex = 0;

  for (var i = 0; i < sorted.length; i++) {
    var err = sorted[i];
    // Skip overlapping or out-of-range errors
    if (err.offset < lastIndex || err.offset + err.length > text.length) {
      continue;
    }
    // Text before this error
    html += escapeHtml(text.substring(lastIndex, err.offset));
    // The misspelt word wrapped in a mark tag
    html += '<mark class="spell-error">' + escapeHtml(text.substring(err.offset, err.offset + err.length)) + "</mark>";
    lastIndex = err.offset + err.length;
  }

  // Remaining text after last error
  html += escapeHtml(text.substring(lastIndex));
  // Trailing newline ensures the overlay height matches the textarea
  highlights.innerHTML = html + "\n";
  syncScroll();
}

/**
 * @description Update the spell error count display in the editor footer.
 */
function updateSpellCount() {
  var countEl = document.getElementById("editor-spell-count");
  if (spellErrors.length === 0) {
    countEl.textContent = "No errors";
    countEl.classList.remove("hidden", "text-red-500");
    countEl.classList.add("text-green-600");
  } else {
    countEl.textContent = spellErrors.length + (spellErrors.length === 1 ? " error" : " errors");
    countEl.classList.remove("hidden", "text-green-600");
    countEl.classList.add("text-red-500");
  }
}

/**
 * @description Keep the highlights overlay scroll position in sync with
 * the textarea so underlines stay aligned with the text.
 */
function syncScroll() {
  var textarea = document.getElementById("editor-textarea");
  var highlights = document.getElementById("editor-highlights");
  highlights.scrollTop = textarea.scrollTop;
  highlights.scrollLeft = textarea.scrollLeft;
}

/**
 * @description Handle right-click on the textarea. If the cursor is over
 * a misspelt word, show a custom context menu with "Add to dictionary".
 * @param {MouseEvent} e - The contextmenu event
 */
function handleContextMenu(e) {
  if (!spellActive || spellErrors.length === 0) return;

  var textarea = document.getElementById("editor-textarea");
  var cursorPos = textarea.selectionStart;

  // Find if cursor is within a misspelt word
  var matchedError = null;
  for (var i = 0; i < spellErrors.length; i++) {
    var err = spellErrors[i];
    if (cursorPos >= err.offset && cursorPos <= err.offset + err.length) {
      matchedError = err;
      break;
    }
  }

  if (!matchedError) return;

  e.preventDefault();
  contextMenuWord = matchedError.word;

  var menu = document.getElementById("spell-context-menu");
  menu.style.left = e.clientX + "px";
  menu.style.top = e.clientY + "px";
  menu.classList.remove("hidden");
}

/**
 * @description Hide the spellcheck context menu.
 */
function hideContextMenu() {
  document.getElementById("spell-context-menu").classList.add("hidden");
  contextMenuWord = null;
}

/**
 * @description Add the context-menu word to the custom dictionary and
 * re-run spellcheck so the word is no longer flagged.
 */
async function addWordToDictionary() {
  if (!contextMenuWord) return;

  var word = contextMenuWord;
  hideContextMenu();

  try {
    await fetch("/api/docs/dictionary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word: word }),
    });

    // Re-run spellcheck to remove the word from errors
    runSpellCheck();
  } catch (err) {
    // Silently fail
  }
}

/**
 * @description Reset all spellcheck state when the editor is closed.
 */
function resetSpellCheck() {
  spellErrors = [];
  spellActive = false;
  clearTimeout(spellDebounceTimer);
  spellDebounceTimer = null;
  contextMenuWord = null;
  hideContextMenu();

  var highlights = document.getElementById("editor-highlights");
  highlights.innerHTML = "";

  var countEl = document.getElementById("editor-spell-count");
  countEl.classList.add("hidden");
  countEl.classList.remove("text-red-500", "text-green-600");
}

// =============================================================================
// Init
// =============================================================================

document.addEventListener("DOMContentLoaded", init);

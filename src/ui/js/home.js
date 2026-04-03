/**
 * @description Home page logic for Portfolio 60.
 * Checks database status on load and prompts creation if needed.
 */

/**
 * @description Check the database status and display the appropriate UI.
 * If the database does not exist, shows a creation prompt with a button.
 * If it does exist, shows a confirmation message.
 */
async function checkDatabaseStatus() {
  const container = document.getElementById("db-status");
  if (!container) return;

  container.innerHTML =
    '<p class="text-brand-500">Checking database status...</p>';

  const result = await apiRequest("/api/db/status");

  if (!result.ok) {
    container.innerHTML =
      '<div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3">' +
      '<p class="text-base font-semibold">Could not check database status</p>' +
      '<p class="text-sm mt-1">' + escapeHtml(result.detail || result.error) + "</p>" +
      "</div>";
    return;
  }

  if (result.data.exists) {
    container.innerHTML =
      '<div class="bg-green-50 border border-green-300 text-success rounded-lg px-4 py-3 transition-opacity duration-500">' +
      '<p class="text-base">Database is ready.</p>' +
      "</div>";
    // Auto-hide the status message after 3 seconds
    setTimeout(function () {
      const statusDiv = container.firstElementChild;
      if (statusDiv) {
        statusDiv.style.opacity = "0";
        setTimeout(function () { container.innerHTML = ""; }, 500);
      }
    }, 3000);
    loadManualPriceAlert();
  } else {
    container.innerHTML =
      '<div class="bg-amber-50 border border-amber-300 text-warning rounded-lg px-5 py-5">' +
      '<h3 class="text-lg font-semibold mb-2">Database Setup Required</h3>' +
      "<p class=\"text-base mb-4\">No database has been found. Click the button below to create the database with all required tables and seed data.</p>" +
      '<button id="create-db-btn" class="bg-brand-700 hover:bg-brand-800 text-white font-medium px-6 py-2 rounded-lg transition-colors">' +
      "Create Database" +
      "</button>" +
      '<div id="db-create-messages" class="mt-4"></div>' +
      "</div>";

    document.getElementById("create-db-btn").addEventListener("click", handleCreateDatabase);
  }
}

/**
 * @description Handle the "Create Database" button click.
 * Calls the API to create the database and displays the result.
 */
async function handleCreateDatabase() {
  const btn = document.getElementById("create-db-btn");
  const messagesDiv = document.getElementById("db-create-messages");

  // Disable button while creating
  btn.disabled = true;
  btn.textContent = "Creating...";
  btn.classList.add("opacity-50", "cursor-not-allowed");

  const result = await apiRequest("/api/db/create", { method: "POST" });

  if (result.ok) {
    // Show success and refresh the status display
    const tables = result.data.tables.join(", ");
    messagesDiv.innerHTML =
      '<div class="bg-green-50 border border-green-300 text-success rounded-lg px-4 py-3">' +
      '<p class="text-base font-semibold">Database created successfully</p>' +
      '<p class="text-sm mt-1">Tables created: ' + escapeHtml(tables) + "</p>" +
      "</div>";

    // After a short delay, refresh the entire status area
    setTimeout(function () {
      checkDatabaseStatus();
    }, 2000);
  } else {
    messagesDiv.innerHTML =
      '<div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3">' +
      '<p class="text-base font-semibold">' + escapeHtml(result.error) + "</p>" +
      (result.detail ? '<p class="text-sm mt-1">' + escapeHtml(result.detail) + "</p>" : "") +
      "</div>";

    // Re-enable the button
    btn.disabled = false;
    btn.textContent = "Create Database";
    btn.classList.remove("opacity-50", "cursor-not-allowed");
  }
}

/**
 * @description Format the started_by value into a human-readable label for
 * the "How Priced" column.
 * @param {number|null} startedBy - 0=Manual fetch, 1=Scheduled, 2=Manual entry
 * @returns {string} Display label
 */
function formatHowPriced(startedBy) {
  if (startedBy === null || startedBy === undefined) return "Unknown";
  if (startedBy === 0) return "Manual fetch";
  if (startedBy === 1) return "Scheduled";
  if (startedBy === 2) return "Manual entry";
  return "Unknown";
}

/**
 * @description Fetch manually-priced investments and display an alert table
 * on the home page if any exist. Only called when the database is ready.
 */
async function loadManualPriceAlert() {
  const container = document.getElementById("manual-price-alert");
  if (!container) return;

  const result = await apiRequest("/api/investments/manually-priced");

  if (!result.ok || !result.data || result.data.length === 0) {
    container.innerHTML = "";
    return;
  }

  const investments = result.data;

  let html = '<div class="bg-amber-50 border border-amber-300 rounded-lg p-4">';
  html += '<h3 class="text-lg font-semibold text-amber-800 mb-3">Manually-Priced Investments</h3>';
  html += '<p class="text-sm text-amber-700 mb-3">These investments are not included in automatic price fetching. Their prices need to be entered manually via the investment edit form (Setup &gt; Investments).</p>';
  html += '<div class="overflow-x-auto">';
  html += '<table class="w-full text-left border-collapse">';
  html += "<thead>";
  html += '<tr class="border-b-2 border-amber-200">';
  html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">Investment Description</th>';
  html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">Type</th>';
  html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">Currency</th>';
  html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">Public ID</th>';
  html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">Date of Last Price</th>';
  html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">How Priced</th>';
  html += "</tr>";
  html += "</thead><tbody>";

  for (let i = 0; i < investments.length; i++) {
    const inv = investments[i];
    const rowClass = i % 2 === 0 ? "bg-white" : "bg-amber-50/50";
    const howPriced = formatHowPriced(inv.how_priced);
    const lastDate = inv.last_price_date || "No price yet";

    html += '<tr class="' + rowClass + ' border-b border-amber-100">';
    html += '<td class="py-2 px-3 text-base">' + escapeHtml(inv.description) + "</td>";
    html += '<td class="py-2 px-3 text-base">' + escapeHtml(inv.type_description) + "</td>";
    html += '<td class="py-2 px-3 text-base">' + escapeHtml(inv.currency_code) + "</td>";
    html += '<td class="py-2 px-3 text-sm text-brand-500 font-mono">' + escapeHtml(inv.public_id || "\u2014") + "</td>";
    html += '<td class="py-2 px-3 text-base">' + escapeHtml(lastDate) + "</td>";
    html += '<td class="py-2 px-3 text-base">' + escapeHtml(howPriced) + "</td>";
    html += "</tr>";
  }

  html += "</tbody></table></div></div>";
  container.innerHTML = html;
}

// --- Screenshot thumbnails and lightbox ---

/** @type {string[]} List of all thumbnail filenames from the server */
let allThumbnailFiles = [];
/** @type {number} Currently displayed image index in the lightbox */
let lightboxIndex = 0;
/** @type {number} Maximum number of thumbnails to show on the home page */
const MAX_VISIBLE_THUMBNAILS = 2;

/**
 * @description Fetch the list of thumbnail images from the server and render
 * the first two as clickable thumbnails stacked vertically in the right column.
 */
async function loadHomeThumbnails() {
  const container = document.getElementById("home-thumbnails");
  if (!container) return;

  try {
    const response = await fetch("/api/home/thumbnails");
    const files = await response.json();
    if (!Array.isArray(files) || files.length === 0) return;

    allThumbnailFiles = files;

    // Show the container now that we have images
    container.classList.remove("hidden");
    container.classList.add("flex");

    // Render the first MAX_VISIBLE_THUMBNAILS as clickable thumbnails
    const count = Math.min(files.length, MAX_VISIBLE_THUMBNAILS);
    for (let i = 0; i < count; i++) {
      const wrapper = document.createElement("div");
      wrapper.className = "relative cursor-pointer group rounded-lg overflow-hidden border border-brand-200 shadow-sm hover:shadow-md transition-shadow";
      wrapper.dataset.index = String(i);
      wrapper.addEventListener("click", handleThumbnailClick);

      const img = document.createElement("img");
      img.src = "/docs/media/" + files[i];
      img.alt = "Screenshot " + (i + 1);
      img.className = "w-full h-auto";
      img.loading = "lazy";

      const overlay = document.createElement("div");
      overlay.className = "absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center";

      const hint = document.createElement("span");
      hint.className = "text-white text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity text-center px-4";
      hint.innerHTML = "Click to show all " + files.length + " screenshots<br>full size";

      overlay.appendChild(hint);
      wrapper.appendChild(img);
      wrapper.appendChild(overlay);
      container.appendChild(wrapper);
    }
  } catch (_err) {
    // Silently ignore — thumbnails are optional
  }
}

/**
 * @description Handle click on a thumbnail image. Opens the lightbox at the
 * clicked image's index.
 * @param {Event} event - The click event
 */
function handleThumbnailClick(event) {
  const wrapper = event.currentTarget;
  const index = parseInt(wrapper.dataset.index, 10);
  openLightbox(index);
}

/**
 * @description Open the screenshot lightbox at the given image index.
 * @param {number} index - The index into allThumbnailFiles to display
 */
function openLightbox(index) {
  lightboxIndex = index;
  const lightbox = document.getElementById("screenshot-lightbox");
  lightbox.classList.remove("hidden");
  lightbox.classList.add("flex");
  document.body.style.overflow = "hidden";
  updateLightboxImage();
}

/**
 * @description Close the screenshot lightbox and restore page scrolling.
 */
function closeLightbox() {
  const lightbox = document.getElementById("screenshot-lightbox");
  lightbox.classList.add("hidden");
  lightbox.classList.remove("flex");
  document.body.style.overflow = "";
}

/**
 * @description Update the lightbox image and counter to reflect the current index.
 */
function updateLightboxImage() {
  const img = document.getElementById("lightbox-image");
  const counter = document.getElementById("lightbox-counter");
  img.src = "/docs/media/" + allThumbnailFiles[lightboxIndex];
  img.alt = "Screenshot " + (lightboxIndex + 1) + " of " + allThumbnailFiles.length;
  counter.textContent = (lightboxIndex + 1) + " / " + allThumbnailFiles.length;
}

/**
 * @description Navigate to the previous image in the lightbox, wrapping around.
 */
function lightboxPrev() {
  lightboxIndex = (lightboxIndex - 1 + allThumbnailFiles.length) % allThumbnailFiles.length;
  updateLightboxImage();
}

/**
 * @description Navigate to the next image in the lightbox, wrapping around.
 */
function lightboxNext() {
  lightboxIndex = (lightboxIndex + 1) % allThumbnailFiles.length;
  updateLightboxImage();
}

/**
 * @description Set up lightbox event listeners for close, prev, next buttons
 * and keyboard navigation.
 */
function initLightboxControls() {
  document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
  document.getElementById("lightbox-prev").addEventListener("click", lightboxPrev);
  document.getElementById("lightbox-next").addEventListener("click", lightboxNext);

  // Close on backdrop click (clicking outside the image)
  document.getElementById("screenshot-lightbox").addEventListener("click", function (e) {
    if (e.target === this) {
      closeLightbox();
    }
  });

  // Keyboard navigation
  document.addEventListener("keydown", function (e) {
    const lightbox = document.getElementById("screenshot-lightbox");
    if (lightbox.classList.contains("hidden")) return;

    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft") lightboxPrev();
    if (e.key === "ArrowRight") lightboxNext();
  });
}

// Check database status when the page loads
document.addEventListener("DOMContentLoaded", function () {
  checkDatabaseStatus();
  loadHomeThumbnails();
  initLightboxControls();
});

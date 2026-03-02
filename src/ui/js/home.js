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
      '<div class="bg-green-50 border border-green-300 text-success rounded-lg px-4 py-3">' +
      '<p class="text-base">Database is ready.</p>' +
      "</div>";
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
 * @param {number|null} startedBy - 0=Manual scrape, 1=Scheduled, 2=Manual entry, 3=Test
 * @returns {string} Display label
 */
function formatHowPriced(startedBy) {
  if (startedBy === null || startedBy === undefined) return "Unknown";
  if (startedBy === 0) return "Manual scrape";
  if (startedBy === 1) return "Scheduled";
  if (startedBy === 2) return "Manual entry";
  if (startedBy === 3) return "Test";
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

// Check database status when the page loads
document.addEventListener("DOMContentLoaded", function () {
  checkDatabaseStatus();
});

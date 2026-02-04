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

// Check database status when the page loads
document.addEventListener("DOMContentLoaded", function () {
  checkDatabaseStatus();
});

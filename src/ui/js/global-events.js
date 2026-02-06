/**
 * @description Global Events page logic for Portfolio 60.
 * Handles listing, adding, editing, and deleting global events.
 * Events are displayed in reverse chronological order (newest first).
 */

/** @type {number|null} ID of the event pending deletion */
let deleteEventId = null;

/**
 * @description Get today's date in ISO-8601 format (YYYY-MM-DD).
 * @returns {string} Today's date string
 */
function getTodayDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

/**
 * @description Format an ISO-8601 date string (YYYY-MM-DD) for display.
 * Returns a human-readable UK date format (e.g. "5 Feb 2026").
 * @param {string} dateStr - ISO-8601 date string
 * @returns {string} Formatted date string
 */
function formatDisplayDate(dateStr) {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const year = parts[0];
  const monthIndex = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);

  if (monthIndex < 0 || monthIndex > 11) return dateStr;

  return day + " " + months[monthIndex] + " " + year;
}

/**
 * @description Load and display all global events in the table.
 */
async function loadEvents() {
  const container = document.getElementById("events-table-container");

  const result = await apiRequest("/api/global-events");

  if (!result.ok) {
    container.innerHTML = '<div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3">' + '<p class="text-base font-semibold">Failed to load global events</p>' + '<p class="text-sm mt-1">' + escapeHtml(result.detail || result.error) + "</p>" + "</div>";
    return;
  }

  const events = result.data;

  if (events.length === 0) {
    container.innerHTML = '<p class="text-brand-500">No global events yet. Click "Add Event" to create one.</p>';
    return;
  }

  let html = '<div class="overflow-x-auto">';
  html += '<table class="w-full text-left border-collapse">';
  html += "<thead>";
  html += '<tr class="border-b-2 border-brand-200">';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700 w-36">Date</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Description</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700 w-20"></th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700 w-20"></th>';
  html += "</tr>";
  html += "</thead>";
  html += "<tbody>";

  for (let i = 0; i < events.length; i++) {
    const evt = events[i];
    const rowClass = i % 2 === 0 ? "bg-white" : "bg-brand-50";

    html += '<tr data-id="' + evt.id + '" class="' + rowClass + ' border-b border-brand-100 hover:bg-brand-100 transition-colors cursor-pointer" ondblclick="editEvent(' + evt.id + ')">';
    html += '<td class="py-3 px-3 text-base font-medium">' + escapeHtml(formatDisplayDate(evt.event_date)) + "</td>";
    html += '<td class="py-3 px-3 text-base">' + escapeHtml(evt.description) + "</td>";
    html += '<td class="py-3 px-3 text-base">';
    html += '<button class="bg-brand-100 hover:bg-brand-200 text-brand-700 text-sm font-medium px-3 py-1 rounded transition-colors" onclick="editEvent(' + evt.id + ')">Edit</button>';
    html += "</td>";
    html += '<td class="py-3 px-3 text-base">';
    html += '<button class="text-sm text-brand-400 hover:text-red-600 transition-colors" onclick="confirmDeleteEvent(' + evt.id + ", '" + escapeHtml(evt.event_date) + "'" + ')">Delete</button>';
    html += "</td>";
    html += "</tr>";
  }

  html += "</tbody></table></div>";
  container.innerHTML = html;
}

/**
 * @description Highlight a table row by event ID.
 * @param {number} id - The event ID
 */
function highlightRow(id) {
  clearRowHighlight();
  const row = document.querySelector('tr[data-id="' + id + '"]');
  if (row) {
    row.classList.add("!bg-brand-200");
  }
}

/**
 * @description Remove highlight from all table rows.
 */
function clearRowHighlight() {
  const rows = document.querySelectorAll("tr[data-id]");
  rows.forEach(function (row) {
    row.classList.remove("!bg-brand-200");
  });
}

/**
 * @description Show the add event form modal with date defaulting to today.
 */
function showAddForm() {
  clearRowHighlight();
  document.getElementById("form-title").textContent = "Add Event";
  document.getElementById("event-id").value = "";
  document.getElementById("event-form").reset();
  document.getElementById("event_date").value = getTodayDate();
  document.getElementById("form-errors").textContent = "";
  document.getElementById("delete-from-form-btn").classList.add("hidden");
  document.getElementById("event-form-container").classList.remove("hidden");
  // Focus the first field after a brief delay to ensure modal is visible
  setTimeout(function () {
    document.getElementById("event_date").focus();
  }, 50);
}

/**
 * @description Load an event's data into the form for editing.
 * @param {number} id - The event ID to edit
 */
async function editEvent(id) {
  const result = await apiRequest("/api/global-events/" + id);

  if (!result.ok) {
    showError("page-messages", "Failed to load event for editing", result.detail || result.error);
    return;
  }

  const evt = result.data;

  highlightRow(id);

  document.getElementById("form-title").textContent = "Edit Event";
  document.getElementById("event-id").value = evt.id;
  document.getElementById("event_date").value = evt.event_date;
  document.getElementById("description").value = evt.description;
  document.getElementById("form-errors").textContent = "";

  const deleteBtn = document.getElementById("delete-from-form-btn");
  deleteBtn.classList.remove("hidden");
  deleteBtn.onclick = function () {
    confirmDeleteEvent(evt.id, evt.event_date);
  };

  document.getElementById("event-form-container").classList.remove("hidden");
  // Focus the first field after a brief delay to ensure modal is visible
  setTimeout(function () {
    document.getElementById("event_date").focus();
  }, 50);
}

/**
 * @description Hide the form modal.
 */
function hideForm() {
  clearRowHighlight();
  document.getElementById("event-form-container").classList.add("hidden");
}

/**
 * @description Handle form submission for creating or updating an event.
 * @param {Event} event - The form submit event
 */
async function handleFormSubmit(event) {
  event.preventDefault();

  const errorsDiv = document.getElementById("form-errors");
  errorsDiv.textContent = "";

  const eventId = document.getElementById("event-id").value;
  const isEditing = eventId !== "";

  const data = {
    event_date: document.getElementById("event_date").value.trim(),
    description: document.getElementById("description").value.trim(),
  };

  let result;
  if (isEditing) {
    result = await apiRequest("/api/global-events/" + eventId, {
      method: "PUT",
      body: data,
    });
  } else {
    result = await apiRequest("/api/global-events", {
      method: "POST",
      body: data,
    });
  }

  if (result.ok) {
    hideForm();
    await loadEvents();
    showSuccess("page-messages", isEditing ? "Event updated successfully" : "Event added successfully");
  } else {
    errorsDiv.textContent = result.detail || result.error;
  }
}

/**
 * @description Show the delete confirmation dialog.
 * @param {number} id - The event ID to delete
 * @param {string} dateStr - The event date for the confirmation message
 */
function confirmDeleteEvent(id, dateStr) {
  deleteEventId = id;
  document.getElementById("delete-event-date").textContent = formatDisplayDate(dateStr);
  document.getElementById("delete-dialog").classList.remove("hidden");
}

/**
 * @description Hide the delete confirmation dialog.
 */
function hideDeleteDialog() {
  deleteEventId = null;
  document.getElementById("delete-dialog").classList.add("hidden");
}

/**
 * @description Execute the event deletion after confirmation.
 */
async function executeDelete() {
  if (!deleteEventId) return;

  const result = await apiRequest("/api/global-events/" + deleteEventId, {
    method: "DELETE",
  });

  hideDeleteDialog();
  hideForm();

  if (result.ok) {
    await loadEvents();
    showSuccess("page-messages", "Event deleted successfully");
  } else {
    showError("page-messages", "Failed to delete event", result.detail || result.error);
  }
}

// Initialise the page
document.addEventListener("DOMContentLoaded", async function () {
  await loadEvents();

  document.getElementById("add-event-btn").addEventListener("click", showAddForm);
  document.getElementById("cancel-btn").addEventListener("click", hideForm);
  document.getElementById("event-form").addEventListener("submit", handleFormSubmit);
  document.getElementById("delete-cancel-btn").addEventListener("click", hideDeleteDialog);
  document.getElementById("delete-confirm-btn").addEventListener("click", executeDelete);

  // Close modals when clicking on the backdrop (outside the modal content)
  document.getElementById("event-form-container").addEventListener("click", function (event) {
    if (event.target === this) {
      hideForm();
    }
  });

  document.getElementById("delete-dialog").addEventListener("click", function (event) {
    if (event.target === this) {
      hideDeleteDialog();
    }
  });

  // Close modals with Escape key
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      const formContainer = document.getElementById("event-form-container");
      const deleteDialog = document.getElementById("delete-dialog");

      if (!deleteDialog.classList.contains("hidden")) {
        hideDeleteDialog();
      } else if (!formContainer.classList.contains("hidden")) {
        hideForm();
      }
    }
  });
});

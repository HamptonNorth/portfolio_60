/**
 * @description Users page logic for Portfolio 60.
 * Handles listing, adding, editing, and deleting users.
 */

/** @type {number|null} ID of the user pending deletion */
let deleteUserId = null;

/** @type {string} Name of the user pending deletion (for confirmation dialog) */
let deleteUserName = "";

/** @type {Array<{code: string, name: string}>} Cached list of allowed providers */
let providers = [];

/**
 * @description Load the list of allowed providers from the config API
 * and populate the provider dropdown.
 */
async function loadProviders() {
  const result = await apiRequest("/api/config/providers");
  if (result.ok) {
    providers = result.data;
  }
  populateProviderDropdown();
}

/**
 * @description Populate the provider <select> element with options
 * from the loaded providers list.
 * @param {string} [selectedCode=""] - The provider code to pre-select
 */
function populateProviderDropdown(selectedCode) {
  const select = document.getElementById("provider");
  // Keep the first placeholder option, remove the rest
  select.innerHTML = '<option value="">Select provider...</option>';

  for (const provider of providers) {
    const option = document.createElement("option");
    option.value = provider.code;
    option.textContent = provider.name + " (" + provider.code + ")";
    if (selectedCode && provider.code === selectedCode) {
      option.selected = true;
    }
    select.appendChild(option);
  }
}

/**
 * @description Get the display name for a provider code.
 * @param {string} code - The provider code
 * @returns {string} The provider name with code, or just the code if not found
 */
function getProviderDisplayName(code) {
  if (!code) return "";
  const provider = providers.find((p) => p.code === code);
  return provider ? provider.name + " (" + provider.code + ")" : code;
}

/**
 * @description Strip all spaces from an NI number input value.
 * NI numbers are often formatted as "XX XX XX XX X" but should be
 * stored without spaces.
 * @param {HTMLInputElement} input - The NI number input element
 */
function stripNiSpaces(input) {
  const cursorPos = input.selectionStart;
  const before = input.value;
  let cleaned = before.replace(/\s/g, "");
  // Enforce 9-character maximum after stripping spaces
  if (cleaned.length > 9) {
    cleaned = cleaned.substring(0, 9);
  }
  if (cleaned !== before) {
    input.value = cleaned;
    const lengthDiff = before.length - cleaned.length;
    const newPos = Math.max(0, Math.min(cursorPos - lengthDiff, cleaned.length));
    input.setSelectionRange(newPos, newPos);
  }
}

/**
 * @description Load and display all users in the table.
 */
async function loadUsers() {
  const container = document.getElementById("users-table-container");

  const result = await apiRequest("/api/users");

  if (!result.ok) {
    container.innerHTML = '<div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3">' + '<p class="text-base font-semibold">Failed to load users</p>' + '<p class="text-sm mt-1">' + escapeHtml(result.detail || result.error) + "</p>" + "</div>";
    return;
  }

  const users = result.data;

  if (users.length === 0) {
    container.innerHTML = '<p class="text-brand-500">No users yet. Click "Add User" to create one.</p>';
    return;
  }

  let html = '<div class="overflow-x-auto">';
  html += '<table class="w-full text-left border-collapse">';
  html += "<thead>";
  html += '<tr class="border-b-2 border-brand-200">';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Initials</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Name</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Provider</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">NI Number</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">Trading Ref</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">ISA Ref</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700">SIPP Ref</th>';
  html += '<th class="py-3 px-3 text-sm font-semibold text-brand-700"></th>';
  html += "</tr>";
  html += "</thead>";
  html += "<tbody>";

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const rowClass = i % 2 === 0 ? "bg-white" : "bg-brand-50";

    html += '<tr class="' + rowClass + ' border-b border-brand-100 hover:bg-brand-100 transition-colors">';
    html += '<td class="py-3 px-3 text-base">' + escapeHtml(user.initials) + "</td>";
    html += '<td class="py-3 px-3 text-base">' + escapeHtml(user.first_name + " " + user.last_name) + "</td>";
    html += '<td class="py-3 px-3 text-base">' + escapeHtml(getProviderDisplayName(user.provider)) + "</td>";
    html += '<td class="py-3 px-3 text-base">' + escapeHtml(user.ni_number || "") + "</td>";
    html += '<td class="py-3 px-3 text-base">' + escapeHtml(user.trading_ref || "") + "</td>";
    html += '<td class="py-3 px-3 text-base">' + escapeHtml(user.isa_ref || "") + "</td>";
    html += '<td class="py-3 px-3 text-base">' + escapeHtml(user.sipp_ref || "") + "</td>";
    html += '<td class="py-3 px-3 text-base">';
    html += '<button class="bg-brand-100 hover:bg-brand-200 text-brand-700 text-sm font-medium px-3 py-1 rounded transition-colors" onclick="editUser(' + user.id + ')">Edit</button>';
    html += "</td>";
    html += "</tr>";
  }

  html += "</tbody></table></div>";
  container.innerHTML = html;
}

/**
 * @description Show the add user form modal (empty fields).
 */
function showAddForm() {
  document.getElementById("form-title").textContent = "Add User";
  document.getElementById("user-id").value = "";
  document.getElementById("user-form").reset();
  document.getElementById("form-errors").textContent = "";
  document.getElementById("delete-from-form-btn").classList.add("hidden");
  populateProviderDropdown();
  document.getElementById("user-form-container").classList.remove("hidden");
  // Focus the first field after a brief delay to ensure modal is visible
  setTimeout(function () {
    document.getElementById("initials").focus();
  }, 50);
}

/**
 * @description Load a user's data into the form modal for editing.
 * @param {number} id - The user ID to edit
 */
async function editUser(id) {
  const result = await apiRequest("/api/users/" + id);

  if (!result.ok) {
    showError("page-messages", "Failed to load user for editing", result.detail || result.error);
    return;
  }

  const user = result.data;
  document.getElementById("form-title").textContent = "Edit User";
  document.getElementById("user-id").value = user.id;
  document.getElementById("initials").value = user.initials;
  document.getElementById("first_name").value = user.first_name;
  document.getElementById("last_name").value = user.last_name;
  document.getElementById("ni_number").value = user.ni_number || "";
  document.getElementById("utr").value = user.utr || "";
  populateProviderDropdown(user.provider);
  document.getElementById("trading_ref").value = user.trading_ref || "";
  document.getElementById("isa_ref").value = user.isa_ref || "";
  document.getElementById("sipp_ref").value = user.sipp_ref || "";
  document.getElementById("form-errors").textContent = "";

  // Show the delete link when editing
  const deleteBtn = document.getElementById("delete-from-form-btn");
  deleteBtn.classList.remove("hidden");
  deleteBtn.onclick = function () {
    confirmDeleteUser(user.id, user.first_name + " " + user.last_name);
  };

  document.getElementById("user-form-container").classList.remove("hidden");
  // Focus the first field after a brief delay to ensure modal is visible
  setTimeout(function () {
    document.getElementById("initials").focus();
  }, 50);
}

/**
 * @description Hide the form modal.
 */
function hideForm() {
  document.getElementById("user-form-container").classList.add("hidden");
}

/**
 * @description Handle form submission for creating or updating a user.
 * @param {Event} event - The form submit event
 */
async function handleFormSubmit(event) {
  event.preventDefault();

  const errorsDiv = document.getElementById("form-errors");
  errorsDiv.textContent = "";

  const userId = document.getElementById("user-id").value;
  const isEditing = userId !== "";

  const data = {
    initials: document.getElementById("initials").value.trim(),
    first_name: document.getElementById("first_name").value.trim(),
    last_name: document.getElementById("last_name").value.trim(),
    ni_number: document.getElementById("ni_number").value.trim() || null,
    utr: document.getElementById("utr").value.trim() || null,
    provider: document.getElementById("provider").value,
    trading_ref: document.getElementById("trading_ref").value.trim() || null,
    isa_ref: document.getElementById("isa_ref").value.trim() || null,
    sipp_ref: document.getElementById("sipp_ref").value.trim() || null,
  };

  let result;
  if (isEditing) {
    result = await apiRequest("/api/users/" + userId, {
      method: "PUT",
      body: data,
    });
  } else {
    result = await apiRequest("/api/users", {
      method: "POST",
      body: data,
    });
  }

  if (result.ok) {
    hideForm();
    await loadUsers();
    showSuccess("page-messages", isEditing ? "User updated successfully" : "User added successfully");
  } else {
    errorsDiv.textContent = result.detail || result.error;
  }
}

/**
 * @description Show the delete confirmation dialog.
 * @param {number} id - The user ID to delete
 * @param {string} name - The user's full name for the confirmation message
 */
function confirmDeleteUser(id, name) {
  deleteUserId = id;
  deleteUserName = name;
  document.getElementById("delete-user-name").textContent = name;
  document.getElementById("delete-dialog").classList.remove("hidden");
}

/**
 * @description Hide the delete confirmation dialog.
 */
function hideDeleteDialog() {
  deleteUserId = null;
  document.getElementById("delete-dialog").classList.add("hidden");
}

/**
 * @description Execute the user deletion after confirmation.
 */
async function executeDelete() {
  if (!deleteUserId) return;

  const result = await apiRequest("/api/users/" + deleteUserId, {
    method: "DELETE",
  });

  hideDeleteDialog();
  hideForm();

  if (result.ok) {
    await loadUsers();
    showSuccess("page-messages", "User deleted successfully");
  } else {
    showError("page-messages", "Failed to delete user", result.detail || result.error);
  }
}

// Initialise the page
document.addEventListener("DOMContentLoaded", async function () {
  await loadProviders();
  await loadUsers();

  // NI number: strip spaces on input and paste
  const niInput = document.getElementById("ni_number");
  niInput.addEventListener("input", function () {
    stripNiSpaces(niInput);
  });
  niInput.addEventListener("paste", function () {
    // Use setTimeout so the pasted value is in the input before we strip
    setTimeout(function () {
      stripNiSpaces(niInput);
    }, 0);
  });

  document.getElementById("add-user-btn").addEventListener("click", showAddForm);
  document.getElementById("cancel-btn").addEventListener("click", hideForm);
  document.getElementById("user-form").addEventListener("submit", handleFormSubmit);
  document.getElementById("delete-cancel-btn").addEventListener("click", hideDeleteDialog);
  document.getElementById("delete-confirm-btn").addEventListener("click", executeDelete);

  // Close modals when clicking on the backdrop (outside the modal content)
  document.getElementById("user-form-container").addEventListener("click", function (event) {
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
      const formContainer = document.getElementById("user-form-container");
      const deleteDialog = document.getElementById("delete-dialog");

      if (!deleteDialog.classList.contains("hidden")) {
        hideDeleteDialog();
      } else if (!formContainer.classList.contains("hidden")) {
        hideForm();
      }
    }
  });
});

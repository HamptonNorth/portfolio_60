/**
 * @description Other Assets page logic for Portfolio 60.
 * Handles listing, adding, editing, and deleting other assets
 * (pensions, property, savings, alternative assets).
 * Assets are displayed grouped by category with section headers.
 */

/** @type {number|null} ID of the asset pending deletion */
let deleteAssetId = null;

/** @type {string} Description of the asset pending deletion (for dialog) */
let deleteAssetDesc = "";

/** @type {Object[]} Cached list of users for the dropdown */
let cachedUsers = [];

/**
 * @description Category display labels, in the order they should appear.
 * @type {Array<{key: string, label: string}>}
 */
const CATEGORY_ORDER = [
  { key: "pension", label: "Pensions" },
  { key: "property", label: "Property" },
  { key: "savings", label: "Savings" },
  { key: "alternative", label: "Alternative Assets" },
];

/**
 * @description Frequency display labels.
 * @type {Object<string, string>}
 */
const FREQUENCY_LABELS = {
  weekly: "Weekly",
  fortnightly: "Fortnightly",
  "4_weeks": "4 Weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  "6_monthly": "6 Monthly",
  annually: "Annually",
};

/**
 * @description Format a scaled integer (× 10000) as a GBP currency string.
 * @param {number} scaledValue - The value × 10000
 * @returns {string} Formatted string like "£1,234.56" or "£1,234"
 */
function formatGBP(scaledValue) {
  const amount = scaledValue / 10000;
  if (amount === 0) return "£0";
  const isWhole = Math.abs(amount - Math.round(amount)) < 0.005;
  if (isWhole) {
    return "£" + Math.round(amount).toLocaleString("en-GB");
  }
  return "£" + amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * @description Format an ISO-8601 date string (YYYY-MM-DD) for display.
 * Returns a human-readable UK date format (e.g. "5 Feb 2026").
 * @param {string} dateStr - ISO-8601 date string
 * @returns {string} Formatted date string
 */
function formatDisplayDate(dateStr) {
  if (!dateStr) return "";
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
 * @description Get the display name for a user. Shows first_name for the Joint
 * user, initials for everyone else.
 * @param {Object} asset - The asset object with user_first_name and user_initials
 * @returns {string} Display name
 */
function getUserDisplay(asset) {
  if (asset.user_first_name === "Joint") {
    return "Joint";
  }
  return asset.user_initials || "";
}

/**
 * @description Load the users list for the dropdown.
 */
async function loadUsers() {
  const result = await apiRequest("/api/users");
  if (result.ok) {
    cachedUsers = result.data;
  }
}

/**
 * @description Populate the user dropdown with cached users.
 */
function populateUserDropdown() {
  const select = document.getElementById("user_id");
  // Keep the first placeholder option
  select.innerHTML = '<option value="">Select user...</option>';

  for (const user of cachedUsers) {
    const option = document.createElement("option");
    option.value = user.id;
    if (user.first_name === "Joint") {
      option.textContent = "Joint";
    } else {
      option.textContent = user.initials + " — " + user.first_name + " " + user.last_name;
    }
    select.appendChild(option);
  }
}

/**
 * @description Load and display all other assets in the table, grouped by category.
 */
async function loadAssets() {
  const container = document.getElementById("assets-table-container");

  const result = await apiRequest("/api/other-assets");

  if (!result.ok) {
    container.innerHTML = '<div class="bg-red-50 border border-red-300 text-error rounded-lg px-4 py-3">' +
      '<p class="text-base font-semibold">Failed to load other assets</p>' +
      '<p class="text-sm mt-1">' + escapeHtml(result.detail || result.error) + "</p></div>";
    return;
  }

  const assets = result.data;

  if (assets.length === 0) {
    container.innerHTML = '<p class="text-brand-500">No other assets yet. Click "Add Asset" to create one.</p>';
    return;
  }

  // Group assets by category
  const grouped = {};
  for (const cat of CATEGORY_ORDER) {
    grouped[cat.key] = [];
  }
  for (const asset of assets) {
    if (grouped[asset.category]) {
      grouped[asset.category].push(asset);
    }
  }

  let html = "";

  for (const cat of CATEGORY_ORDER) {
    const items = grouped[cat.key];

    // Section header
    html += '<h3 class="text-lg font-semibold text-brand-800 mt-6 mb-2">' + escapeHtml(cat.label) + "</h3>";

    if (items.length === 0) {
      html += '<p class="text-brand-400 mb-4 ml-2">None</p>';
      continue;
    }

    html += '<div class="overflow-x-auto mb-4">';
    html += '<table class="w-full text-left border-collapse">';
    html += "<thead>";
    html += '<tr class="border-b-2 border-brand-200 bg-blue-50">';
    html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700 w-20">User</th>';
    html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">Description</th>';
    html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700 w-24">Type</th>';
    html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700 text-right w-32">Value</th>';
    html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700 w-28">Every</th>';
    html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700 w-32">Last changed</th>';
    html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700">Notes</th>';
    html += '<th class="py-2 px-3 text-sm font-semibold text-brand-700 w-16"></th>';
    html += "</tr>";
    html += "</thead>";
    html += "<tbody>";

    for (let i = 0; i < items.length; i++) {
      const asset = items[i];
      const rowClass = i % 2 === 0 ? "bg-white" : "bg-brand-50";

      html += '<tr data-id="' + asset.id + '" class="' + rowClass + ' border-b border-brand-100 hover:bg-brand-100 transition-colors cursor-pointer" ondblclick="editAsset(' + asset.id + ')">';
      html += '<td class="py-2 px-3 text-base">' + escapeHtml(getUserDisplay(asset)) + "</td>";
      html += '<td class="py-2 px-3 text-base">' + escapeHtml(asset.description) + "</td>";
      html += '<td class="py-2 px-3 text-base">' + escapeHtml(asset.value_type === "recurring" ? "Recurring" : "") + "</td>";
      html += '<td class="py-2 px-3 text-base text-right font-mono">' + escapeHtml(formatGBP(asset.value)) + "</td>";
      html += '<td class="py-2 px-3 text-base">' + escapeHtml(asset.frequency ? (FREQUENCY_LABELS[asset.frequency] || asset.frequency) : "") + "</td>";
      html += '<td class="py-2 px-3 text-base">';
      html += '<button class="text-brand-600 hover:text-brand-800 hover:underline transition-colors" onclick="showHistory(' + asset.id + ", '" + escapeHtml(asset.description) + "'" + ')">';
      html += escapeHtml(formatDisplayDate(asset.last_updated));
      html += "</button></td>";

      // Notes column with executor reference as tooltip icon
      html += '<td class="py-2 px-3 text-base">';
      if (asset.notes) {
        html += escapeHtml(asset.notes);
      }
      if (asset.executor_reference) {
        html += ' <span class="relative group inline-block">';
        html += '<span class="text-brand-400 cursor-help text-xs align-super" title="' + escapeHtml(asset.executor_reference) + '">&#9432;</span>';
        html += '<span class="hidden group-hover:block absolute bottom-full left-0 mb-1 bg-brand-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-10">' + escapeHtml(asset.executor_reference) + "</span>";
        html += "</span>";
      }
      html += "</td>";

      html += '<td class="py-2 px-3 text-base">';
      html += '<button class="bg-brand-100 hover:bg-brand-200 text-brand-700 text-sm font-medium px-3 py-1 rounded transition-colors" onclick="editAsset(' + asset.id + ')">Edit</button>';
      html += "</td>";
      html += "</tr>";
    }

    html += "</tbody></table></div>";
  }

  container.innerHTML = html;
}

/**
 * @description Show the add asset form modal.
 */
function showAddForm() {
  document.getElementById("form-title").textContent = "Add Asset";
  document.getElementById("asset-id").value = "";
  document.getElementById("asset-form").reset();
  document.getElementById("form-errors").textContent = "";
  document.getElementById("delete-from-form-btn").classList.add("hidden");
  document.getElementById("frequency-group").classList.add("hidden");
  populateUserDropdown();
  document.getElementById("asset-form-container").classList.remove("hidden");
  setTimeout(function () {
    document.getElementById("user_id").focus();
  }, 50);
}

/**
 * @description Load an asset's data into the form for editing.
 * @param {number} id - The asset ID to edit
 */
async function editAsset(id) {
  const result = await apiRequest("/api/other-assets/" + id);

  if (!result.ok) {
    showError("page-messages", "Failed to load asset for editing", result.detail || result.error);
    return;
  }

  const asset = result.data;

  populateUserDropdown();

  document.getElementById("form-title").textContent = "Edit Asset";
  document.getElementById("asset-id").value = asset.id;
  document.getElementById("user_id").value = asset.user_id;
  document.getElementById("description").value = asset.description;
  document.getElementById("category").value = asset.category;

  // Set value type radio
  const radios = document.querySelectorAll('input[name="value_type"]');
  for (const radio of radios) {
    radio.checked = radio.value === asset.value_type;
  }

  // Show/hide frequency
  if (asset.value_type === "recurring") {
    document.getElementById("frequency-group").classList.remove("hidden");
    document.getElementById("frequency").value = asset.frequency || "";
  } else {
    document.getElementById("frequency-group").classList.add("hidden");
    document.getElementById("frequency").value = "";
  }

  // Convert scaled value to pounds.pence for the input
  document.getElementById("value").value = (asset.value / 10000).toFixed(2);
  document.getElementById("notes").value = asset.notes || "";
  document.getElementById("executor_reference").value = asset.executor_reference || "";
  document.getElementById("form-errors").textContent = "";

  const deleteBtn = document.getElementById("delete-from-form-btn");
  deleteBtn.classList.remove("hidden");
  deleteBtn.onclick = function () {
    confirmDeleteAsset(asset.id, asset.description);
  };

  document.getElementById("asset-form-container").classList.remove("hidden");
  setTimeout(function () {
    document.getElementById("user_id").focus();
  }, 50);
}

/**
 * @description Hide the form modal.
 */
function hideForm() {
  document.getElementById("asset-form-container").classList.add("hidden");
}

/**
 * @description Handle form submission for creating or updating an asset.
 * @param {Event} event - The form submit event
 */
async function handleFormSubmit(event) {
  event.preventDefault();

  const errorsDiv = document.getElementById("form-errors");
  errorsDiv.textContent = "";

  const assetId = document.getElementById("asset-id").value;
  const isEditing = assetId !== "";

  // Get selected value_type radio
  const valueTypeRadio = document.querySelector('input[name="value_type"]:checked');

  const data = {
    user_id: parseInt(document.getElementById("user_id").value, 10),
    description: document.getElementById("description").value.trim(),
    category: document.getElementById("category").value,
    value_type: valueTypeRadio ? valueTypeRadio.value : "",
    frequency: valueTypeRadio && valueTypeRadio.value === "recurring" ? document.getElementById("frequency").value : null,
    value: Math.round(parseFloat(document.getElementById("value").value) * 10000),
    notes: document.getElementById("notes").value.trim() || null,
    executor_reference: document.getElementById("executor_reference").value.trim() || null,
  };

  let result;
  if (isEditing) {
    result = await apiRequest("/api/other-assets/" + assetId, {
      method: "PUT",
      body: data,
    });
  } else {
    result = await apiRequest("/api/other-assets", {
      method: "POST",
      body: data,
    });
  }

  if (result.ok) {
    hideForm();
    await loadAssets();
    showSuccess("page-messages", isEditing ? "Asset updated successfully" : "Asset added successfully");
  } else {
    errorsDiv.textContent = result.detail || result.error;
  }
}

/**
 * @description Show the delete confirmation dialog.
 * @param {number} id - The asset ID to delete
 * @param {string} desc - The asset description for the confirmation message
 */
function confirmDeleteAsset(id, desc) {
  deleteAssetId = id;
  deleteAssetDesc = desc;
  document.getElementById("delete-asset-desc").textContent = desc;
  document.getElementById("delete-dialog").classList.remove("hidden");
}

/**
 * @description Hide the delete confirmation dialog.
 */
function hideDeleteDialog() {
  deleteAssetId = null;
  document.getElementById("delete-dialog").classList.add("hidden");
}

/**
 * @description Execute the asset deletion after confirmation.
 */
async function executeDelete() {
  if (!deleteAssetId) return;

  const result = await apiRequest("/api/other-assets/" + deleteAssetId, {
    method: "DELETE",
  });

  hideDeleteDialog();
  hideForm();

  if (result.ok) {
    await loadAssets();
    showSuccess("page-messages", "Asset deleted successfully");
  } else {
    showError("page-messages", "Failed to delete asset", result.detail || result.error);
  }
}

/**
 * @description Show the change history for an asset in a modal.
 * @param {number} id - The asset ID
 * @param {string} desc - The asset description for the title
 */
async function showHistory(id, desc) {
  const result = await apiRequest("/api/other-assets/" + id + "/history");

  document.getElementById("history-title").textContent = "History: " + desc;

  const content = document.getElementById("history-content");

  if (!result.ok) {
    content.innerHTML = '<p class="text-error">Failed to load history.</p>';
    document.getElementById("history-modal").classList.remove("hidden");
    return;
  }

  const history = result.data;

  if (history.length === 0) {
    content.innerHTML = '<p class="text-brand-500">No change history recorded yet.</p>';
    document.getElementById("history-modal").classList.remove("hidden");
    return;
  }

  let html = '<table class="w-full text-left border-collapse">';
  html += "<thead>";
  html += '<tr class="border-b-2 border-brand-200">';
  html += '<th class="py-2 px-2 text-sm font-semibold text-brand-700">Date</th>';
  html += '<th class="py-2 px-2 text-sm font-semibold text-brand-700 text-right">Value</th>';
  html += '<th class="py-2 px-2 text-sm font-semibold text-brand-700">Notes</th>';
  html += '<th class="py-2 px-2 text-sm font-semibold text-brand-700">Exec Ref</th>';
  html += "</tr></thead><tbody>";

  for (let i = 0; i < history.length; i++) {
    const h = history[i];
    const rowClass = i % 2 === 0 ? "bg-white" : "bg-brand-50";
    html += '<tr class="' + rowClass + ' border-b border-brand-100">';
    html += '<td class="py-2 px-2 text-sm">' + escapeHtml(formatDisplayDate(h.change_date)) + "</td>";
    html += '<td class="py-2 px-2 text-sm text-right font-mono">' + escapeHtml(formatGBP(h.revised_value)) + "</td>";
    html += '<td class="py-2 px-2 text-sm">' + escapeHtml(h.revised_notes || "") + "</td>";
    html += '<td class="py-2 px-2 text-sm">' + escapeHtml(h.revised_executor_reference || "") + "</td>";
    html += "</tr>";
  }

  html += "</tbody></table>";
  content.innerHTML = html;
  document.getElementById("history-modal").classList.remove("hidden");
}

/**
 * @description Hide the history modal.
 */
function hideHistoryModal() {
  document.getElementById("history-modal").classList.add("hidden");
}

// Initialise the page
document.addEventListener("DOMContentLoaded", async function () {
  await loadUsers();
  await loadAssets();

  document.getElementById("add-asset-btn").addEventListener("click", showAddForm);
  document.getElementById("cancel-btn").addEventListener("click", hideForm);
  document.getElementById("asset-form").addEventListener("submit", handleFormSubmit);
  document.getElementById("delete-cancel-btn").addEventListener("click", hideDeleteDialog);
  document.getElementById("delete-confirm-btn").addEventListener("click", executeDelete);
  document.getElementById("history-close-btn").addEventListener("click", hideHistoryModal);

  // Toggle frequency visibility based on value_type radio selection
  const radios = document.querySelectorAll('input[name="value_type"]');
  for (const radio of radios) {
    radio.addEventListener("change", function () {
      const freqGroup = document.getElementById("frequency-group");
      if (this.value === "recurring") {
        freqGroup.classList.remove("hidden");
      } else {
        freqGroup.classList.add("hidden");
        document.getElementById("frequency").value = "";
      }
    });
  }

  // Close modals when clicking on the backdrop
  document.getElementById("asset-form-container").addEventListener("click", function (event) {
    if (event.target === this) hideForm();
  });

  document.getElementById("delete-dialog").addEventListener("click", function (event) {
    if (event.target === this) hideDeleteDialog();
  });

  document.getElementById("history-modal").addEventListener("click", function (event) {
    if (event.target === this) hideHistoryModal();
  });

  // Close modals with Escape key
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      const historyModal = document.getElementById("history-modal");
      const deleteDialog = document.getElementById("delete-dialog");
      const formContainer = document.getElementById("asset-form-container");

      if (!historyModal.classList.contains("hidden")) {
        hideHistoryModal();
      } else if (!deleteDialog.classList.contains("hidden")) {
        hideDeleteDialog();
      } else if (!formContainer.classList.contains("hidden")) {
        hideForm();
      }
    }
  });
});

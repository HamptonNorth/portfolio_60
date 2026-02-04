/**
 * @description Passphrase page logic for Portfolio 60.
 * Handles two modes: setting a new passphrase (first run) and
 * verifying an existing passphrase (subsequent runs).
 */

document.addEventListener("DOMContentLoaded", async function () {
  const messagesDiv = document.getElementById("passphrase-messages");
  const contentDiv = document.getElementById("passphrase-content");

  // Check auth status to determine which form to show
  const result = await apiRequest("/api/auth/status");

  if (!result.ok) {
    showError("passphrase-messages", "Failed to check authentication status", result.detail);
    return;
  }

  // If already authenticated, redirect to home
  if (result.data.isAuthenticated) {
    window.location.href = "/";
    return;
  }

  if (result.data.isFirstRun) {
    showSetPassphraseForm(contentDiv, messagesDiv);
  } else {
    showVerifyPassphraseForm(contentDiv, messagesDiv);
  }
});

/**
 * @description Show the "Set Passphrase" form for first-time setup.
 * Includes two password fields (passphrase and confirm) with validation.
 * @param {HTMLElement} contentDiv - The container to render the form into
 * @param {HTMLElement} messagesDiv - The container for status messages
 */
function showSetPassphraseForm(contentDiv, messagesDiv) {
  contentDiv.innerHTML = `
    <p class="text-brand-600 text-center mb-6">
      Choose a passphrase to protect your portfolio data.<br>
      You will need this every time you open the application.
    </p>
    <form id="set-passphrase-form" class="space-y-4">
      <div>
        <label for="passphrase" class="block text-sm font-medium text-brand-700 mb-1">
          Passphrase
        </label>
        <input type="password" id="passphrase" name="passphrase"
          class="w-full px-3 py-2 border border-brand-300 rounded-md text-base
                 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          minlength="8" required
          placeholder="Minimum 8 characters">
      </div>
      <div>
        <label for="confirm-passphrase" class="block text-sm font-medium text-brand-700 mb-1">
          Confirm Passphrase
        </label>
        <input type="password" id="confirm-passphrase" name="confirm-passphrase"
          class="w-full px-3 py-2 border border-brand-300 rounded-md text-base
                 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          minlength="8" required
          placeholder="Enter passphrase again">
      </div>
      <div id="form-errors" class="text-error text-sm"></div>
      <button type="submit"
        class="w-full bg-brand-700 text-white py-2 px-4 rounded-md text-base font-medium
               hover:bg-brand-800 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500">
        Set Passphrase
      </button>
    </form>
  `;

  const form = document.getElementById("set-passphrase-form");
  form.addEventListener("submit", async function (event) {
    event.preventDefault();

    const passphrase = document.getElementById("passphrase").value;
    const confirm = document.getElementById("confirm-passphrase").value;
    const errorsDiv = document.getElementById("form-errors");
    errorsDiv.textContent = "";

    // Client-side validation
    if (passphrase.length < 8) {
      errorsDiv.textContent = "Passphrase must be at least 8 characters long.";
      return;
    }

    if (passphrase !== confirm) {
      errorsDiv.textContent = "Passphrases do not match.";
      return;
    }

    // Send to server
    const result = await apiRequest("/api/auth/set-passphrase", {
      method: "POST",
      body: { passphrase: passphrase },
    });

    if (result.ok) {
      // Show a brief confirmation before redirecting
      const msg = result.data.databaseCreated ? "Passphrase set and database created. Redirecting..." : "Passphrase set. Redirecting...";
      showSuccess("passphrase-messages", msg);
      setTimeout(function () {
        window.location.href = "/";
      }, 1500);
    } else {
      errorsDiv.textContent = result.error + (result.detail ? " — " + result.detail : "");
    }
  });
}

/**
 * @description Show the "Verify Passphrase" form for subsequent runs.
 * Single password field with an unlock button.
 * @param {HTMLElement} contentDiv - The container to render the form into
 * @param {HTMLElement} messagesDiv - The container for status messages
 */
function showVerifyPassphraseForm(contentDiv, messagesDiv) {
  contentDiv.innerHTML = `
    <p class="text-brand-600 text-center mb-6">
      Enter your passphrase to access your portfolio data.
    </p>
    <form id="verify-passphrase-form" class="space-y-4">
      <div>
        <label for="passphrase" class="block text-sm font-medium text-brand-700 mb-1">
          Passphrase
        </label>
        <input type="password" id="passphrase" name="passphrase"
          class="w-full px-3 py-2 border border-brand-300 rounded-md text-base
                 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          required autofocus
          placeholder="Enter your passphrase">
      </div>
      <div id="form-errors" class="text-error text-sm"></div>
      <button type="submit"
        class="w-full bg-brand-700 text-white py-2 px-4 rounded-md text-base font-medium
               hover:bg-brand-800 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500">
        Unlock
      </button>
    </form>
  `;

  const form = document.getElementById("verify-passphrase-form");
  form.addEventListener("submit", async function (event) {
    event.preventDefault();

    const passphrase = document.getElementById("passphrase").value;
    const errorsDiv = document.getElementById("form-errors");
    errorsDiv.textContent = "";

    if (!passphrase) {
      errorsDiv.textContent = "Please enter your passphrase.";
      return;
    }

    const result = await apiRequest("/api/auth/verify", {
      method: "POST",
      body: { passphrase: passphrase },
    });

    if (result.ok && result.data.success) {
      window.location.href = "/";
    } else {
      errorsDiv.textContent = result.error || "Incorrect passphrase. Please try again.";
    }
  });
}

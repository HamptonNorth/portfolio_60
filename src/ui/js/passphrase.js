/**
 * @description Passphrase page logic for Portfolio 60.
 * Handles two modes: setting a new passphrase (first run) and
 * verifying an existing passphrase (subsequent runs).
 */

/**
 * @description Show a "Creating new test database" progress message with
 * animated dots while the server creates the test database.
 * @param {HTMLElement} contentDiv - The container to show the message in
 * @returns {number} The setInterval ID (clear it when done)
 */
function showTestDbProgress(contentDiv) {
  contentDiv.innerHTML =
    '<div class="text-center py-6">' +
    '<p class="text-base text-brand-700 font-medium">Creating new test database<span id="progress-dots"></span></p>' +
    '<div class="mt-3 flex justify-center gap-1.5">' +
    '<span class="inline-block w-2.5 h-2.5 bg-brand-500 rounded-full animate-bounce" style="animation-delay: 0ms"></span>' +
    '<span class="inline-block w-2.5 h-2.5 bg-brand-500 rounded-full animate-bounce" style="animation-delay: 150ms"></span>' +
    '<span class="inline-block w-2.5 h-2.5 bg-brand-500 rounded-full animate-bounce" style="animation-delay: 300ms"></span>' +
    '</div>' +
    '</div>';

  var dotCount = 0;
  var dotsSpan = document.getElementById("progress-dots");
  return setInterval(function () {
    dotCount = (dotCount + 1) % 4;
    dotsSpan.textContent = ".".repeat(dotCount);
  }, 400);
}

/**
 * @description Show test database creation complete, then redirect after a pause.
 * @param {HTMLElement} contentDiv - The container to show the message in
 * @param {number} dotsInterval - The interval ID from showTestDbProgress
 */
function showTestDbComplete(contentDiv, dotsInterval) {
  clearInterval(dotsInterval);
  contentDiv.innerHTML =
    '<div class="text-center py-6 space-y-2">' +
    '<p class="text-base text-success font-medium">Creation of new test database complete.</p>' +
    '<p class="text-base text-success">Database is ready.</p>' +
    '</div>';
  setTimeout(function () {
    window.location.href = "/";
  }, 2000);
}

/**
 * @description Show a lockout message with a countdown timer.
 * Replaces the form content and re-shows the verify form when the lockout expires.
 * @param {HTMLElement} contentDiv - The container to show the message in
 * @param {number} remainingMs - Milliseconds remaining in the lockout period
 */
function showLockoutMessage(contentDiv, remainingMs) {
  const messagesDiv = document.getElementById("passphrase-messages");

  /**
   * @description Format milliseconds as "Xh Ym" or "Ym" text.
   * @param {number} ms - Milliseconds to format
   * @returns {string} Human-readable time string
   */
  function formatRemaining(ms) {
    const totalMinutes = Math.ceil(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0 && minutes > 0) {
      return hours + "h " + minutes + "m";
    } else if (hours > 0) {
      return hours + "h";
    }
    return minutes + "m";
  }

  contentDiv.innerHTML =
    '<div class="text-center py-6 space-y-3">' +
    '<p class="text-error font-medium text-lg">Too many failed attempts</p>' +
    '<p class="text-brand-600">Access has been temporarily locked for security.</p>' +
    '<p class="text-brand-700 font-medium">Try again in: <span id="lockout-countdown">' + formatRemaining(remainingMs) + '</span></p>' +
    '</div>';

  var endTime = Date.now() + remainingMs;
  var countdownSpan = document.getElementById("lockout-countdown");

  var countdownInterval = setInterval(function () {
    var remaining = endTime - Date.now();
    if (remaining <= 0) {
      clearInterval(countdownInterval);
      showVerifyPassphraseForm(contentDiv, messagesDiv);
      return;
    }
    countdownSpan.textContent = formatRemaining(remaining);
  }, 30000);
}

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
          required
          placeholder="Minimum 8 characters (or 'test' for demo mode)">
      </div>
      <div>
        <label for="confirm-passphrase" class="block text-sm font-medium text-brand-700 mb-1">
          Confirm Passphrase
        </label>
        <input type="password" id="confirm-passphrase" name="confirm-passphrase"
          class="w-full px-3 py-2 border border-brand-300 rounded-md text-base
                 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          required
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

    // Allow "test" to pass through to the server for test mode activation
    const isTestEntry = passphrase.toLowerCase() === "test";

    // Client-side validation (skip for test mode entry)
    if (!isTestEntry) {
      if (passphrase.length < 8) {
        errorsDiv.textContent = "Passphrase must be at least 8 characters long.";
        return;
      }

      if (passphrase !== confirm) {
        errorsDiv.textContent = "Passphrases do not match.";
        return;
      }
    }

    // Show progress indicator for test mode while the server creates the database
    var dotsInterval = null;
    if (isTestEntry) {
      dotsInterval = showTestDbProgress(contentDiv);
    }

    // Send to server
    const result = await apiRequest("/api/auth/set-passphrase", {
      method: "POST",
      body: { passphrase: passphrase },
    });

    if (result.ok) {
      // Test mode — show completion message if fresh DB, otherwise redirect
      if (result.data.testMode) {
        if (result.data.freshDatabase) {
          showTestDbComplete(contentDiv, dotsInterval);
        } else {
          clearInterval(dotsInterval);
          window.location.href = "/";
        }
        return;
      }
      // Show a brief confirmation before redirecting
      const msg = result.data.databaseCreated ? "Passphrase set and database created. Redirecting..." : "Passphrase set. Redirecting...";
      showSuccess("passphrase-messages", msg);
      setTimeout(function () {
        window.location.href = "/";
      }, 1500);
    } else {
      clearInterval(dotsInterval);
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
          placeholder="Enter your passphrase (or 'test' for demo mode)">
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

    // Show progress indicator for test mode while the server creates the database
    var isTestEntry = passphrase.toLowerCase() === "test";
    var dotsInterval = null;
    if (isTestEntry) {
      dotsInterval = showTestDbProgress(contentDiv);
    }

    const result = await apiRequest("/api/auth/verify", {
      method: "POST",
      body: { passphrase: passphrase },
    });

    if (result.ok && result.data.success) {
      // Test mode — show completion message if fresh DB, otherwise redirect
      if (result.data.testMode) {
        if (result.data.freshDatabase) {
          showTestDbComplete(contentDiv, dotsInterval);
        } else {
          clearInterval(dotsInterval);
          window.location.href = "/";
        }
        return;
      }
      clearInterval(dotsInterval);
      window.location.href = "/";
    } else {
      clearInterval(dotsInterval);
      // Handle lockout — disable the form and show remaining time
      if (result.data && result.data.locked) {
        showLockoutMessage(contentDiv, result.data.remainingMs);
      } else {
        errorsDiv.textContent = result.error || "Incorrect passphrase. Please try again.";
      }
    }
  });
}

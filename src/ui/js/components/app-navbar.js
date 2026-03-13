import { LitElement, html } from "lit";
import "./docs-search-modal.js";

/**
 * @description Shared navigation bar component for Portfolio 60.
 * Renders the full nav bar with logo, Set Up dropdown, Portfolio dropdown,
 * Reports placeholder, and Settings gear dropdown.
 * Uses light DOM so Tailwind CSS utility classes work without Shadow DOM.
 */
class AppNavbar extends LitElement {
  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <nav class="bg-brand-800 text-white px-6 py-4 shadow-md">
        <div class="flex items-center justify-between max-w-7xl mx-auto">
          <h1 class="text-xl font-semibold tracking-wide flex items-center gap-2">
            <img src="/images/redmug-logo.svg" alt="Red Mug logo" class="h-8 w-8" />
            <span id="nav-app-title">Portfolio 60</span>
          </h1>
          <ul class="flex gap-6 text-base items-center">
            <li><a href="/" class="hover:text-brand-200 transition-colors" data-nav="home">Home</a></li>
            <li class="relative group">
              <span class="hover:text-brand-200 transition-colors cursor-pointer select-none" data-nav-parent="setup">Set Up <span class="text-xs">&#9662;</span></span>
              <div class="hidden group-hover:block absolute left-0 top-full pt-1 z-50">
                <div class="bg-white text-brand-800 rounded-md shadow-lg border border-brand-200 py-1 min-w-48">
                  <a href="/pages/users.html" class="block px-4 py-2 hover:bg-brand-50 transition-colors" data-nav="users">Users</a>
                  <a href="/pages/investments.html" class="block px-4 py-2 hover:bg-brand-50 transition-colors" data-nav="investments">Investments</a>
                  <a href="/pages/benchmarks.html" class="block px-4 py-2 hover:bg-brand-50 transition-colors" data-nav="benchmarks">Benchmarks</a>
                  <a href="/pages/currencies.html" class="block px-4 py-2 hover:bg-brand-50 transition-colors" data-nav="currencies">Currencies</a>
                  <a href="/pages/global-events.html" class="block px-4 py-2 hover:bg-brand-50 transition-colors" data-nav="global-events">Global Events</a>
                  <a href="/pages/scraping.html" class="block px-4 py-2 hover:bg-brand-50 transition-colors" data-nav="scraping">Fetching</a>
                  <a href="/pages/portfolio.html?view=setup" class="block px-4 py-2 hover:bg-brand-50 transition-colors" data-nav="portfolio-setup">Portfolio Setup</a>
                  <a href="/pages/other-assets.html" class="block px-4 py-2 hover:bg-brand-50 transition-colors" data-nav="other-assets">Other Assets</a>
                  <hr class="my-1 border-brand-200" />
                  <a href="/pages/backup.html" class="block px-4 py-2 hover:bg-brand-50 transition-colors" data-nav="backup">Backup</a>
                </div>
              </div>
            </li>
            <li class="relative group">
              <span class="hover:text-brand-200 transition-colors cursor-pointer select-none" data-nav-parent="portfolio">Portfolio <span class="text-xs">&#9662;</span></span>
              <div class="hidden group-hover:block absolute left-0 top-full pt-1 z-50">
                <div class="bg-white text-brand-800 rounded-md shadow-lg border border-brand-200 py-1 min-w-48">
                  <a href="/pages/portfolio.html?view=summary" class="block px-4 py-2 hover:bg-brand-50 transition-colors" data-nav="portfolio-summary">Summary Valuation</a>
                </div>
              </div>
            </li>
            <li class="relative group">
              <span class="hover:text-brand-200 transition-colors cursor-pointer select-none" data-nav-parent="reports">Reports <span class="text-xs">&#9662;</span></span>
              <div class="hidden group-hover:block absolute left-0 top-full pt-1 z-50">
                <div class="bg-white text-brand-800 rounded-md shadow-lg border border-brand-200 py-1 min-w-48" id="nav-reports-dropdown">
                  <a href="/pages/reports.html?block=portfolio_summary" class="block px-4 py-2 hover:bg-brand-50 transition-colors" data-nav="report-portfolio-summary">Portfolio Summary</a>
                  <a href="/pages/reports.html?block=household_assets" class="block px-4 py-2 hover:bg-brand-50 transition-colors" data-nav="report-household">Household Assets</a>
                  <hr class="my-1 border-brand-200" />
                  <a href="/api/reports/pdf/household-assets" target="_blank" class="block px-4 py-2 hover:bg-brand-50 transition-colors text-brand-600" data-nav="report-household-pdf">Household Assets (PDF)</a>
                </div>
              </div>
            </li>
            <li class="relative group" id="nav-docs-item" style="display:none">
              <span class="hover:text-brand-200 transition-colors cursor-pointer select-none" data-nav-parent="docs">Docs <span class="text-xs">&#9662;</span></span>
              <div class="hidden group-hover:block absolute left-0 top-full pt-1 z-50">
                <div class="bg-white text-brand-800 rounded-md shadow-lg border border-brand-200 py-1 min-w-48" id="nav-docs-dropdown"></div>
              </div>
            </li>
            <li class="relative group" id="nav-lists-item" style="display:none">
              <span class="hover:text-brand-200 transition-colors cursor-pointer select-none" data-nav-parent="lists">Lists <span class="text-xs">&#9662;</span></span>
              <div class="hidden group-hover:block absolute left-0 top-full pt-1 z-50">
                <div class="bg-white text-brand-800 rounded-md shadow-lg border border-brand-200 py-1 min-w-48" id="nav-lists-dropdown"></div>
              </div>
            </li>
            <li class="relative group">
              <span class="hover:text-brand-200 transition-colors cursor-pointer select-none" data-nav-parent="settings">
                <svg class="w-5 h-5 inline-block" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z"
                  />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </span>
              <div class="hidden group-hover:block absolute right-0 top-full pt-1 z-50">
                <div class="bg-white text-brand-800 rounded-md shadow-lg border border-brand-200 py-1 min-w-48">
                  <a href="#" @click=${this._editSettings} class="block px-4 py-2 hover:bg-brand-50 transition-colors">Edit User Settings</a>
                  <a href="#" @click=${this._editReports} class="block px-4 py-2 hover:bg-brand-50 transition-colors">Edit Reports</a>
                  <a href="#" @click=${this._about} class="block px-4 py-2 hover:bg-brand-50 transition-colors">About</a>
                  <hr class="my-1 border-brand-200" />
                  <a href="#" @click=${this._signOut} class="block px-4 py-2 hover:bg-brand-50 transition-colors text-red-600">Sign Out</a>
                </div>
              </div>
            </li>
          </ul>
        </div>
      </nav>
    `;
  }

  /** @description Call the global showEditSettingsModal function from app.js */
  _editSettings(event) {
    event.preventDefault();
    if (typeof showEditSettingsModal === "function") {
      showEditSettingsModal();
    }
  }

  /** @description Call the global showEditReportsModal function from app.js */
  _editReports(event) {
    event.preventDefault();
    if (typeof showEditReportsModal === "function") {
      showEditReportsModal();
    }
  }

  /** @description Sign out and redirect to the passphrase screen. */
  async _signOut(event) {
    event.preventDefault();
    try {
      await fetch("/api/auth/sign-out", { method: "POST" });
    } catch {
      // Even if the request fails, redirect to force re-auth
    }
    window.location.href = "/";
  }

  /** @description Call the global showAboutModal function from app.js */
  _about(event) {
    event.preventDefault();
    if (typeof showAboutModal === "function") {
      showAboutModal();
    }
  }

  /**
   * @description Build the URL for a PDF report endpoint with params encoded.
   * Portfolio detail params use pipe "|" as separator (because individual
   * params contain commas for period codes). Portfolio summary params use
   * comma "," as separator.
   * @param {string} endpoint - The PDF API endpoint path
   * @param {Array<string>} params - The params array from the report definition
   * @returns {string} The full URL with encoded params query parameter
   */
  _buildPdfUrl(endpoint, params) {
    if (!params || params.length === 0) return endpoint;

    // Detail params contain colons and commas (e.g. "BW:ISA:1m,3m,1y,3y")
    // so use pipe separator for detail, comma for summary
    var isDetail = endpoint.indexOf("portfolio-detail") !== -1;
    var separator = isDetail ? "|" : ",";
    var joined = params.join(separator);
    return endpoint + "?params=" + encodeURIComponent(joined);
  }

  async firstUpdated() {
    if (typeof highlightActiveNav === "function") {
      highlightActiveNav();
    }
    this._loadLists();
    this._loadDocs();
    await this._loadCompositeReports();
    this._checkReportsNewTab();
    this._checkTestMode();
  }

  /**
   * @description Fetch composite report definitions from the API and add them
   * to the Reports dropdown menu below the built-in report block links.
   */
  async _loadCompositeReports() {
    try {
      const response = await fetch("/api/reports");
      if (!response.ok) return;
      const reports = await response.json();
      if (!Array.isArray(reports) || reports.length === 0) return;

      const dropdown = document.getElementById("nav-reports-dropdown");
      if (!dropdown) return;

      // Add a divider between report blocks and composite reports
      const hr = document.createElement("hr");
      hr.className = "my-1 border-brand-200";
      dropdown.appendChild(hr);

      for (const report of reports) {
        const link = document.createElement("a");

        if (report.output === "pdf" && report.pdfEndpoint) {
          // PDF report: link directly to the PDF endpoint with params
          link.href = this._buildPdfUrl(report.pdfEndpoint, report.params || []);
          link.setAttribute("target", "_blank");
          link.className = "block px-4 py-2 hover:bg-brand-50 transition-colors text-brand-600";
        } else {
          // HTML composite report: link to the report runner page
          link.href = "/pages/reports.html?report=" + encodeURIComponent(report.id);
          link.className = "block px-4 py-2 hover:bg-brand-50 transition-colors";
          if (this._reportsNewTab) {
            link.setAttribute("target", "_blank");
          }
        }

        link.setAttribute("data-nav", "report-" + report.id);
        link.textContent = report.title;
        dropdown.appendChild(link);
      }
    } catch (err) {
      // Silently ignore — composite reports menu items are optional
    }
  }

  /**
   * @description Check whether the current session is in test mode.
   * If so, update the navbar title and add a visual indicator.
   */
  async _checkTestMode() {
    try {
      const response = await fetch("/api/auth/test-mode");
      if (!response.ok) return;
      const data = await response.json();
      if (!data.testMode) return;

      document.documentElement.dataset.dbMode = "test";

      const titleSpan = this.querySelector("#nav-app-title");
      if (titleSpan) {
        titleSpan.textContent = "Portfolio 60 - Test";
      }

      const nav = this.querySelector("nav");
      if (nav) {
        nav.classList.remove("bg-brand-800");
        nav.classList.add("bg-emerald-900");
      }
    } catch {
      // Ignore fetch errors — navbar stays in normal mode
    }
  }

  /**
   * @description Check whether report links should open in a new browser tab.
   * If enabled, sets target="_blank" on all links inside the Reports dropdown.
   */
  async _checkReportsNewTab() {
    try {
      const response = await fetch("/api/config/reports-new-tab");
      if (!response.ok) return;
      const data = await response.json();
      if (!data.reportsOpenInNewTab) return;

      const dropdown = document.getElementById("nav-reports-dropdown");
      if (!dropdown) return;

      // Apply to existing static links
      const links = dropdown.querySelectorAll("a");
      links.forEach(function (link) {
        link.setAttribute("target", "_blank");
      });

      // Store flag so dynamically added composite report links also get it
      this._reportsNewTab = true;
    } catch {
      // Ignore — default behaviour (same tab)
    }
  }

  /**
   * @description Fetch list items from the config API and populate the Lists dropdown.
   * Shows the Lists menu item only if there are items configured.
   */
  async _loadLists() {
    try {
      const response = await fetch("/api/config/lists");
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      const items = data.items || [];
      const listItem = this.querySelector("#nav-lists-item");
      const dropdown = this.querySelector("#nav-lists-dropdown");

      if (items.length === 0 || !listItem || !dropdown) {
        return;
      }

      listItem.style.display = "";
      dropdown.innerHTML = "";

      items.forEach(function (item, index) {
        const link = document.createElement("a");
        link.href = "/pages/list-viewer.html?index=" + index;
        link.className = "block px-4 py-2 hover:bg-brand-50 transition-colors";
        link.setAttribute("data-nav", "list-viewer-" + index);
        link.textContent = item.title;
        dropdown.appendChild(link);
      });
    } catch {
      // Lists menu stays hidden if fetch fails
    }
  }

  /**
   * @description Fetch docs categories from the config API and populate the Docs dropdown.
   * Shows the Docs menu item only if there are categories configured.
   * Adds a "Search Docs" button at the bottom.
   */
  async _loadDocs() {
    try {
      const response = await fetch("/api/docs/config");
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      const categories = data.categories || {};
      const categoryNames = Object.keys(categories);
      const docsItem = this.querySelector("#nav-docs-item");
      const dropdown = this.querySelector("#nav-docs-dropdown");

      if (categoryNames.length === 0 || !docsItem || !dropdown) {
        return;
      }

      docsItem.style.display = "";
      dropdown.innerHTML = "";

      categoryNames.forEach(function (name) {
        const cat = categories[name];
        const link = document.createElement("a");
        link.href = "/pages/docs-list.html?category=" + encodeURIComponent(name);
        link.className = "block px-4 py-2 hover:bg-brand-50 transition-colors";
        link.setAttribute("data-nav", "docs-" + name);
        link.textContent = cat.label || name;
        dropdown.appendChild(link);
      });

      // Separator and search button
      const hr = document.createElement("hr");
      hr.className = "my-1 border-brand-200";
      dropdown.appendChild(hr);

      const searchBtn = document.createElement("button");
      searchBtn.className = "block w-full text-left px-4 py-2 hover:bg-brand-50 transition-colors text-brand-600";
      searchBtn.textContent = "Search Docs";
      searchBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        // Find or create the search modal
        var modal = document.querySelector("docs-search-modal");
        if (!modal) {
          modal = document.createElement("docs-search-modal");
          document.body.appendChild(modal);
        }
        modal.open();
      });
      dropdown.appendChild(searchBtn);
    } catch {
      // Docs menu stays hidden if fetch fails
    }
  }
}

customElements.define("app-navbar", AppNavbar);

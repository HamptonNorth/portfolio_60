import { LitElement, html } from "lit";

/**
 * @description Full-screen search modal for the docs subsystem.
 * Provides debounced search with highlighted snippets and navigation
 * to matching documents.
 */
class DocsSearchModal extends LitElement {
  static properties = {
    _open: { type: Boolean, state: true },
    _query: { type: String, state: true },
    _results: { type: Array, state: true },
    _total: { type: Number, state: true },
    _duration: { type: String, state: true },
    _error: { type: String, state: true },
    _searching: { type: Boolean, state: true },
    _lastIndexed: { type: String, state: true },
    _docCount: { type: Number, state: true },
  };

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this._open = false;
    this._query = "";
    this._results = [];
    this._total = 0;
    this._duration = "";
    this._error = "";
    this._searching = false;
    this._lastIndexed = null;
    this._docCount = 0;
    this._debounceTimer = null;
  }

  /**
   * @description Open the search modal and focus the input.
   */
  open() {
    this._open = true;
    this._query = "";
    this._results = [];
    this._error = "";
    this._fetchMeta();
    this.updateComplete.then(() => {
      var input = this.querySelector("#docs-search-input");
      if (input) input.focus();
    });
  }

  /**
   * @description Close the search modal.
   */
  close() {
    this._open = false;
  }

  /**
   * @description Fetch search index metadata.
   */
  async _fetchMeta() {
    try {
      var response = await fetch("/api/docs/search-meta");
      if (response.ok) {
        var data = await response.json();
        this._lastIndexed = data.lastIndexed;
        this._docCount = data.documentCount;
      }
    } catch (e) {
      // Non-critical
    }
  }

  /**
   * @description Handle input changes with debouncing.
   * @param {Event} e - Input event
   */
  _onInput(e) {
    this._query = e.target.value;
    this._error = "";

    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }

    if (this._query.trim().length < 3) {
      this._results = [];
      this._total = 0;
      return;
    }

    this._debounceTimer = setTimeout(() => {
      this._doSearch();
    }, 250);
  }

  /**
   * @description Perform the search API call.
   */
  async _doSearch() {
    this._searching = true;
    try {
      var response = await fetch("/api/docs/search?q=" + encodeURIComponent(this._query.trim()));
      if (!response.ok) {
        this._error = "Search failed";
        this._results = [];
        return;
      }

      var data = await response.json();
      this._results = data.results || [];
      this._total = data.total || 0;
      this._duration = data.duration || "";
      this._error = data.error || "";
    } catch (err) {
      this._error = "Search failed: " + err.message;
      this._results = [];
    } finally {
      this._searching = false;
    }
  }

  /**
   * @description Trigger a reindex of all docs.
   */
  async _reindex() {
    try {
      var response = await fetch("/api/docs/reindex", { method: "POST" });
      var data = await response.json();
      if (data.success) {
        this._fetchMeta();
      }
    } catch (e) {
      // Non-critical
    }
  }

  /**
   * @description Handle keyboard events (Escape to close).
   * @param {KeyboardEvent} e
   */
  _onKeyDown(e) {
    if (e.key === "Escape") {
      this.close();
    }
  }

  render() {
    if (!this._open) return html``;

    var lastIndexedStr = "";
    if (this._lastIndexed) {
      var d = new Date(this._lastIndexed);
      lastIndexedStr = d.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    }

    return html`
      <div class="fixed inset-0 bg-black/50 flex items-start justify-center pt-16 z-50" @click=${(e) => { if (e.target === e.currentTarget) this.close(); }} @keydown=${this._onKeyDown}>
        <div class="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col mx-4">
          <!-- Header -->
          <div class="p-4 border-b border-brand-200">
            <div class="flex items-center justify-between mb-3">
              <h3 class="text-lg font-semibold text-brand-800">Search Documents</h3>
              <button @click=${this.close} class="text-brand-400 hover:text-brand-600 text-xl leading-none">&times;</button>
            </div>
            <input
              type="text"
              id="docs-search-input"
              placeholder="Search for documents (minimum 3 characters)..."
              class="w-full px-3 py-2 border border-brand-300 rounded-md text-base focus:outline-none focus:ring-2 focus:ring-brand-500"
              .value=${this._query}
              @input=${this._onInput}
            />
          </div>

          <!-- Results -->
          <div class="flex-1 overflow-y-auto p-4">
            ${this._searching ? html`<p class="text-brand-400 text-center">Searching...</p>` : ""}

            ${this._error ? html`<p class="text-red-500 text-sm">${this._error}</p>` : ""}

            ${!this._searching && !this._error && this._query.trim().length >= 3 && this._results.length === 0
              ? html`<p class="text-brand-400 text-center">No results found</p>`
              : ""}

            ${this._results.map(
              (result) => html`
                <a href="/pages/docs-page.html?category=${encodeURIComponent(result.category)}&slug=${encodeURIComponent(result.slug)}"
                   class="block p-3 mb-2 rounded-lg hover:bg-brand-50 border border-brand-100 transition-colors">
                  <div class="flex items-center gap-2">
                    <span class="font-semibold text-brand-800">${result.title}</span>
                    <span class="text-xs text-brand-400 bg-brand-50 px-2 py-0.5 rounded">${result.category}</span>
                    ${result.isUnpublished ? html`<span class="text-xs text-brand-400 bg-brand-100 px-2 py-0.5 rounded">Draft</span>` : ""}
                  </div>
                  ${result.description ? html`<p class="text-sm text-brand-500 mt-1">${result.description}</p>` : ""}
                  ${result.matches && result.matches.length > 0
                    ? html`<div class="mt-1">
                        ${result.matches.map(
                          (m) => html`<p class="text-xs text-brand-400 mt-0.5"><span class="text-brand-300">${m.region}:</span> <span .innerHTML=${m.fragment}></span></p>`
                        )}
                      </div>`
                    : ""}
                </a>
              `
            )}
          </div>

          <!-- Footer -->
          <div class="p-3 border-t border-brand-200 flex items-center justify-between text-xs text-brand-400">
            <div>
              ${this._total > 0 ? html`${this._total} result${this._total !== 1 ? "s" : ""} (${this._duration})` : ""}
              ${lastIndexedStr ? html`<span class="ml-3">Indexed: ${lastIndexedStr} (${this._docCount} docs)</span>` : ""}
            </div>
            <button @click=${this._reindex} class="text-brand-500 hover:text-brand-700 transition-colors">Reindex</button>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define("docs-search-modal", DocsSearchModal);

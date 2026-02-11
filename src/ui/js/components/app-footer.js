import { LitElement, html } from "lit";

/**
 * @description Shared footer component for Portfolio 60.
 * Renders the application version and build time.
 * Uses light DOM so Tailwind CSS utility classes work without Shadow DOM.
 */
class AppFooter extends LitElement {
  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <footer class="text-brand-400 text-sm py-4 border-t border-brand-100 flex justify-between px-6 max-w-7xl mx-auto w-full">
        <span>Portfolio 60 v0.1.0</span>
        <span id="build-time"></span>
      </footer>
    `;
  }

  firstUpdated() {
    if (typeof loadBuildTime === "function") {
      loadBuildTime();
    }
  }
}

customElements.define("app-footer", AppFooter);

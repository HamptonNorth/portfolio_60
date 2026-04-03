import { LitElement, html } from "lit";
import { APP_NAME } from "../../../../app-identity.js";
import packageJson from "../../../../package.json";

/**
 * @description Shared footer component for Portfolio 60.
 * Renders the application version and build time.
 * Uses light DOM so Tailwind CSS utility classes work without Shadow DOM.
 */
class AppFooter extends LitElement {
  /**
   * @description Use light DOM instead of Shadow DOM so Tailwind utility classes apply directly.
   * @returns {HTMLElement} The component element itself
   */
  createRenderRoot() {
    return this;
  }

  /**
   * @description Render the footer with the application name, version, and build time placeholder.
   * @returns {import('lit').TemplateResult} The footer template
   */
  render() {
    return html`
      <footer class="text-brand-400 text-sm py-4 border-t border-brand-100 flex justify-between px-6 max-w-7xl mx-auto w-full">
        <span>${APP_NAME} v${packageJson.version}</span>
        <span id="build-time"></span>
      </footer>
    `;
  }

  /**
   * @description Lit lifecycle callback invoked after the first render. Calls the global
   * loadBuildTime function to populate the build timestamp in the footer.
   */
  firstUpdated() {
    if (typeof loadBuildTime === "function") {
      loadBuildTime();
    }
  }
}

customElements.define("app-footer", AppFooter);

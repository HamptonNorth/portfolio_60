/**
 * @description Style registry for the docs subsystem.
 * Defines available markdown rendering styles with their CSS files,
 * wrapper classes, and font requirements.
 */

/**
 * @description Registry of available markdown styles.
 * Each style defines its CSS file, wrapper class, and optional font links.
 * @type {Object.<string, {name: string, label: string, cssFile: string, wrapperClass: string, removeProse: boolean, description: string, googleFonts: string[], cdnFonts: string[]}>}
 */
export const STYLE_REGISTRY = {
  github: {
    name: "github",
    label: "GitHub Style",
    cssFile: "md-github.css",
    wrapperClass: "md-github",
    removeProse: true,
    description: "GitHub README-style markdown rendering",
    googleFonts: [],
    cdnFonts: [],
  },

  modest: {
    name: "modest",
    label: "Modest",
    cssFile: "md-modest.css",
    wrapperClass: "md-modest",
    removeProse: true,
    description: "Rather modest styling with Open Sans font",
    googleFonts: ["Open+Sans:ital,wght@0,400;0,700;1,400;1,700"],
    cdnFonts: [],
  },
};

/**
 * @description Get style configuration by name.
 * Falls back to "github" if the requested style is not found.
 * @param {string} styleName - Name of the style to look up
 * @returns {Object} Style configuration object
 */
export function getStyleConfig(styleName) {
  const normalised = (styleName || "github").toLowerCase().trim();

  if (STYLE_REGISTRY[normalised]) {
    return STYLE_REGISTRY[normalised];
  }

  return STYLE_REGISTRY["github"];
}

/**
 * @description Generate Google Fonts link URL for a style.
 * Returns null if no Google Fonts are required.
 * @param {Object} styleConfig - Style configuration object
 * @returns {string|null} Google Fonts URL or null
 */
export function getGoogleFontsUrl(styleConfig) {
  if (!styleConfig.googleFonts || styleConfig.googleFonts.length === 0) {
    return null;
  }

  const families = styleConfig.googleFonts.join("&family=");
  return "https://fonts.googleapis.com/css2?family=" + families + "&display=swap";
}

/**
 * @description Get all required font link URLs (Google Fonts + CDN fonts) for a style.
 * @param {Object} styleConfig - Style configuration object
 * @returns {string[]} Array of CSS link URLs to include
 */
export function getFontLinks(styleConfig) {
  var links = [];

  var googleFontsUrl = getGoogleFontsUrl(styleConfig);
  if (googleFontsUrl) {
    links.push(googleFontsUrl);
  }

  if (styleConfig.cdnFonts && styleConfig.cdnFonts.length > 0) {
    links.push.apply(links, styleConfig.cdnFonts);
  }

  return links;
}

/**
 * @description Simple regex-based HTTP router for Portfolio 60.
 * Supports path parameters like :id and matches routes by method + pattern.
 */

/**
 * @typedef {Object} Route
 * @property {string} method - HTTP method (GET, POST, PUT, DELETE)
 * @property {RegExp} pattern - Compiled regex pattern for the path
 * @property {string[]} paramNames - Names of path parameters (e.g. ["id"])
 * @property {Function} handler - The route handler function
 */

export class Router {
  constructor() {
    /** @type {Route[]} */
    this.routes = [];
  }

  /**
   * @description Register a route. Path parameters use :name syntax
   * (e.g. "/api/users/:id"). The handler receives (request, params) where
   * params is an object like { id: "123" }.
   * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
   * @param {string} path - URL pattern with optional :param segments
   * @param {Function} handler - Async function(request, params) returning Response
   */
  add(method, path, handler) {
    const paramNames = [];
    // Convert path like "/api/users/:id" into a regex
    // Escape forward slashes, replace :param with a named capture group
    const patternString = path.replace(/:([a-zA-Z_]+)/g, function (match, paramName) {
      paramNames.push(paramName);
      return "([^/]+)";
    });

    const pattern = new RegExp("^" + patternString + "$");
    this.routes.push({ method, pattern, paramNames, handler });
  }

  /**
   * @description Convenience method to register a GET route.
   * @param {string} path - URL pattern
   * @param {Function} handler - Route handler
   */
  get(path, handler) {
    this.add("GET", path, handler);
  }

  /**
   * @description Convenience method to register a POST route.
   * @param {string} path - URL pattern
   * @param {Function} handler - Route handler
   */
  post(path, handler) {
    this.add("POST", path, handler);
  }

  /**
   * @description Convenience method to register a PUT route.
   * @param {string} path - URL pattern
   * @param {Function} handler - Route handler
   */
  put(path, handler) {
    this.add("PUT", path, handler);
  }

  /**
   * @description Convenience method to register a DELETE route.
   * @param {string} path - URL pattern
   * @param {Function} handler - Route handler
   */
  delete(path, handler) {
    this.add("DELETE", path, handler);
  }

  /**
   * @description Try to match an incoming request against registered routes.
   * Returns the matched handler's response, or null if no route matched.
   * @param {string} method - HTTP method of the request
   * @param {string} path - URL pathname of the request
   * @param {Request} request - The full Request object
   * @returns {Promise<Response|null>} The handler's response, or null if no match
   */
  async match(method, path, request) {
    for (const route of this.routes) {
      if (route.method !== method) {
        continue;
      }

      const result = route.pattern.exec(path);
      if (!result) {
        continue;
      }

      // Build the params object from captured groups
      const params = {};
      for (let i = 0; i < route.paramNames.length; i++) {
        params[route.paramNames[i]] = result[i + 1];
      }

      return await route.handler(request, params);
    }

    return null;
  }
}

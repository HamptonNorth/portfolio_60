import { Router } from "../router.js";
import { createBackup, listBackups, restoreBackup, deleteBackup } from "../db/backup-db.js";

/**
 * @description Router instance for backup/restore API routes.
 * @type {Router}
 */
const backupRouter = new Router();

// POST /api/backup — create a new backup
backupRouter.post("/api/backup", function () {
  try {
    const result = createBackup();

    if (!result.success) {
      return new Response(
        JSON.stringify({ error: result.message, detail: result.error || "" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to create backup", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// GET /api/backup — list all backups
backupRouter.get("/api/backup", function () {
  try {
    const result = listBackups();

    if (!result.success) {
      return new Response(
        JSON.stringify({ error: result.message, detail: result.error || "" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to list backups", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// POST /api/backup/restore/:filename — restore from a specific backup
backupRouter.post("/api/backup/restore/:filename", function (request, params) {
  try {
    const result = restoreBackup(params.filename);

    if (!result.success) {
      return new Response(
        JSON.stringify({ error: result.message, detail: result.error || "" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to restore backup", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// DELETE /api/backup/:filename — delete a backup file
backupRouter.delete("/api/backup/:filename", function (request, params) {
  try {
    const result = deleteBackup(params.filename);

    if (!result.success) {
      return new Response(
        JSON.stringify({ error: result.message, detail: result.error || "" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to delete backup", detail: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

/**
 * @description Handle a backup API request. Delegates to the backup router.
 * @param {string} method - HTTP method
 * @param {string} path - URL pathname
 * @param {Request} request - The full Request object
 * @returns {Promise<Response|null>} Response if matched, null otherwise
 */
export async function handleBackupRoute(method, path, request) {
  return await backupRouter.match(method, path, request);
}

import { Router } from "../router.js";
import { createBackup, listBackups, restoreBackup, deleteBackup, getBackupFile, uploadBackup } from "../db/backup-db.js";

/**
 * @description Router instance for backup/restore API routes.
 * @type {Router}
 */
const backupRouter = new Router();

// POST /api/backup — create a new backup
backupRouter.post("/api/backup", async function () {
  try {
    const result = await createBackup();

    if (!result.success) {
      return new Response(JSON.stringify({ error: result.message, detail: result.error || "" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to create backup", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// GET /api/backup — list all backups
backupRouter.get("/api/backup", function () {
  try {
    const result = listBackups();

    if (!result.success) {
      return new Response(JSON.stringify({ error: result.message, detail: result.error || "" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to list backups", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// GET /api/backup/download/:filename — download a backup file
backupRouter.get("/api/backup/download/:filename", function (request, params) {
  try {
    const result = getBackupFile(params.filename);

    if (!result.success) {
      return new Response(JSON.stringify({ error: "Download failed", detail: result.error || "" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    return new Response(result.data, {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Content-Disposition": 'attachment; filename="' + result.filename + '"',
        "Content-Length": String(result.data.length),
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to download backup", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// POST /api/backup/upload — upload a backup file into the backups directory
backupRouter.post("/api/backup/upload", async function (request) {
  try {
    var formData;
    try {
      formData = await request.formData();
    } catch (err) {
      return new Response(JSON.stringify({ error: "Invalid form data", detail: err.message }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    var file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return new Response(JSON.stringify({ error: "No file provided" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    // Validate file extension
    var filename = file.name;
    if (!filename.endsWith(".zip") && !filename.endsWith(".db")) {
      return new Response(JSON.stringify({ error: "Invalid file type", detail: "Only .zip and .db backup files are accepted" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    var buffer = await file.arrayBuffer();
    var data = Buffer.from(buffer);

    var result = uploadBackup(filename, data);

    if (!result.success) {
      return new Response(JSON.stringify({ error: result.message, detail: result.error || "" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to upload backup", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// POST /api/backup/restore/:filename — restore from a specific backup
backupRouter.post("/api/backup/restore/:filename", function (request, params) {
  try {
    const result = restoreBackup(params.filename);

    if (!result.success) {
      return new Response(JSON.stringify({ error: result.message, detail: result.error || "" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to restore backup", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

// DELETE /api/backup/:filename — delete a backup file
backupRouter.delete("/api/backup/:filename", function (request, params) {
  try {
    const result = deleteBackup(params.filename);

    if (!result.success) {
      return new Response(JSON.stringify({ error: result.message, detail: result.error || "" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to delete backup", detail: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
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

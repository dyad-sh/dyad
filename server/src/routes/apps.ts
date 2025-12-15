/**
 * Apps API routes
 * Migrated from: src/ipc/handlers/app_handlers.ts
 */

import { Router } from "express";
import { z } from "zod";
import { createError } from "../middleware/errorHandler.js";
import { getDb } from "../db/index.js";
import { apps, chats } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { FileService } from "../services/fileService.js";

const router = Router();

import mime from 'mime-types';

import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { spawn, ChildProcess } from 'child_process';
import portfinder from 'portfinder';
import { createProxyMiddleware } from 'http-proxy-middleware';

interface RunningApp {
    process: ChildProcess;
    port: number;
    dir: string;
    startTime: number;
}

const runningApps = new Map<number, RunningApp>();

// Materialize app files from DB to disk
async function writeAppToDisk(appId: number, targetDir: string): Promise<void> {
    const fileService = new FileService();
    const files = await fileService.listFiles(appId);

    for (const filePath of files) {
        const content = await fileService.getFile(appId, filePath);
        if (content !== null) {
            const fullPath = path.join(targetDir, filePath);
            await fs.outputFile(fullPath, content);
        }
    }
}


// Helper for content types
// Helper for content types
function getContentType(filename: string): string {
    return mime.lookup(filename) || 'text/plain';
}

// Validation schemas
const CreateAppSchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().optional(),
    templateId: z.string().optional(),
});

const UpdateAppSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().optional(),
    isFavorite: z.boolean().optional(),
});

/**
 * GET /api/apps - List all apps
 */
router.get("/", async (req, res, next) => {
    try {
        const db = getDb();
        const allApps = await db.select().from(apps).orderBy(desc(apps.updatedAt));

        res.json({
            success: true,
            data: allApps,
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/apps/:id - Get single app
 */
router.get("/:id", async (req, res, next) => {
    try {
        const db = getDb();
        const { id } = req.params;

        const app = await db.select().from(apps).where(eq(apps.id, Number(id))).limit(1);

        if (!app.length) {
            throw createError("App not found", 404, "APP_NOT_FOUND");
        }

        // Get files for this app
        const fileService = new FileService();
        const files = await fileService.listFiles(Number(id));

        res.json({
            success: true,
            data: {
                ...app[0],
                files,
            },
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/apps - Create new app with initial chat
 */
router.post("/", async (req, res, next) => {
    try {
        const db = getDb();
        const body = CreateAppSchema.parse(req.body);

        // Generate a path for web mode (no actual filesystem)
        // Use timestamp + sanitized name to ensure uniqueness
        const sanitizedName = body.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
        const timestamp = Date.now();
        const webPath = `/web-apps/${sanitizedName}-${timestamp}`;

        // Create the app
        const newApp = await db.insert(apps).values({
            name: body.name,
            path: webPath, // Provide path for web mode to satisfy NOT NULL constraint
        }).returning();

        // Create an initial chat for the app
        const newChat = await db.insert(chats).values({
            appId: newApp[0].id,
            title: null, // Will be set later based on first message
        }).returning();

        res.status(201).json({
            success: true,
            data: {
                app: newApp[0],
                chatId: newChat[0].id,
            },
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({
                success: false,
                error: {
                    message: "Validation error",
                    code: "VALIDATION_ERROR",
                    details: error.errors,
                },
            });
        }
        next(error);
    }
});

/**
 * PUT /api/apps/:id - Update app
 */
router.put("/:id", async (req, res, next) => {
    try {
        const db = getDb();
        const { id } = req.params;
        const body = UpdateAppSchema.parse(req.body);

        const updated = await db.update(apps)
            .set({
                ...body,
                updatedAt: new Date(),
            })
            .where(eq(apps.id, Number(id)))
            .returning();

        if (!updated.length) {
            throw createError("App not found", 404, "APP_NOT_FOUND");
        }

        res.json({
            success: true,
            data: updated[0],
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({
                success: false,
                error: {
                    message: "Validation error",
                    code: "VALIDATION_ERROR",
                    details: error.errors,
                },
            });
        }
        next(error);
    }
});

/**
 * DELETE /api/apps/:id - Delete app
 */
router.delete("/:id", async (req, res, next) => {
    try {
        const db = getDb();
        const { id } = req.params;

        // Delete associated chats first
        await db.delete(chats).where(eq(chats.appId, Number(id)));

        // Delete the app
        const deleted = await db.delete(apps).where(eq(apps.id, Number(id))).returning();

        if (!deleted.length) {
            throw createError("App not found", 404, "APP_NOT_FOUND");
        }

        res.json({
            success: true,
            data: { deleted: true },
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/apps/:id/files/read
 */
router.get("/:id/files/read", async (req, res, next) => {
    try {
        const { id } = req.params;
        const { path: filePath } = req.query;

        if (!filePath || typeof filePath !== 'string') {
            throw createError("Path query parameter required", 400, "INVALID_PATH");
        }

        const fileService = new FileService();
        const content = await fileService.getFile(Number(id), filePath);

        if (content === null) {
            throw createError("File not found", 404, "FILE_NOT_FOUND");
        }

        res.json({
            success: true,
            data: {
                content,
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/apps/:id/files/write
 */
router.post("/:id/files/write", async (req, res, next) => {
    try {
        const { id } = req.params;
        const { path: filePath, content } = req.body;

        if (!filePath || typeof filePath !== 'string') {
            throw createError("Path required", 400, "INVALID_PATH");
        }

        if (typeof content !== 'string') {
            throw createError("Content required", 400, "INVALID_CONTENT");
        }

        const fileService = new FileService();
        await fileService.saveFile(Number(id), filePath, content);

        // SYNC: If app is running, update file on disk to trigger HMR
        const appId = Number(id);
        if (runningApps.has(appId)) {
            const running = runningApps.get(appId)!;
            const fullPath = path.join(running.dir, filePath);
            await fs.outputFile(fullPath, content);
            console.log(`[WebBackend] Synced file ${filePath} to running app ${id} disk`);
        }

        res.json({
            success: true,
            data: {
                success: true
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/apps/:id/run
 */
router.post("/:id/run", async (req, res, next) => {
    try {
        const { id } = req.params;
        const appId = Number(id);

        console.log(`[WebBackend] Requested run for app ${id}`);

        // Check if already running
        if (runningApps.has(appId)) {
            const running = runningApps.get(appId)!;
            console.log(`[WebBackend] App ${id} already running on port ${running.port}`);
            res.json({
                success: true,
                data: {
                    success: true,
                    processId: running.process.pid,
                    previewUrl: `/api/apps/${id}/proxy/`
                }
            });
            return;
        }

        // 1. Prepare Directory
        const targetDir = path.join(os.tmpdir(), 'dyad-apps', String(id));
        await fs.emptyDir(targetDir);
        await writeAppToDisk(appId, targetDir);

        // 2. Find Port
        const port = await portfinder.getPortPromise({ port: 3001 + Math.floor(Math.random() * 1000) });

        // 3. Install Dependencies
        console.log(`[WebBackend] Installing dependencies for app ${id} in ${targetDir}`);
        const installProcess = spawn('npm', ['install'], {
            cwd: targetDir,
            shell: true,
            stdio: 'inherit' // Pipe to server logs for now
        });

        await new Promise<void>((resolve, reject) => {
            installProcess.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`npm install failed with code ${code}`));
            });
        });

        // 4. Run Dev Server
        console.log(`[WebBackend] Starting dev server for app ${id} on port ${port}`);
        // "next dev" expects -p PORT
        const devProcess = spawn('npm', ['run', 'dev', '--', '-p', String(port)], {
            cwd: targetDir,
            shell: true,
            stdio: 'inherit' // For now let's pipe to stdout to see logs
        });

        // Wait a bit for server to start (naive check)
        // Ideally we tail stdout for "Ready on" but using stdio:inherit makes that hard.
        // We'll trust it starts or fails quickly.
        // Creating the entry immediately.
        runningApps.set(appId, {
            process: devProcess,
            port,
            dir: targetDir,
            startTime: Date.now()
        });

        devProcess.on('error', (err) => {
            console.error(`[WebBackend] App ${id} failed to start:`, err);
            runningApps.delete(appId);
        });

        devProcess.on('exit', (code) => {
            console.log(`[WebBackend] App ${id} exited with code ${code}`);
            runningApps.delete(appId);
        });

        res.json({
            success: true,
            data: {
                success: true,
                processId: devProcess.pid,
                previewUrl: `/api/apps/${id}/proxy/`
            }
        });

    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/apps/:id/preview/*
 * Serve app files for preview
 */
router.get("/:id/preview/*", async (req, res, next) => {
    try {
        const { id } = req.params;
        // req.params[0] captures everything after /preview/ due to wildcard *
        // e.g. /api/apps/1/preview/css/style.css -> req.params[0] = "css/style.css"
        const params = req.params as any;
        const filePath = params[0] || "index.html";

        if (!filePath) {
            // Should verify if we ever hit this with the default fallback above
            throw createError("Path required", 400, "INVALID_PATH");
        }

        const fileService = new FileService();
        const content = await fileService.getFile(Number(id), filePath);

        if (content === null) {
            // Try adding .html if missing
            if (!filePath.endsWith('.html') && !filePath.includes('.')) {
                const htmlContent = await fileService.getFile(Number(id), `${filePath}.html`);
                if (htmlContent !== null) {
                    res.type('text/html').send(htmlContent);
                    return;
                }
            }

            // Return 404 for resources not found
            // Don't throw JSON error for resources like favicon, just 404
            return res.status(404).send("File not found");
        }

        const contentType = getContentType(filePath);
        res.type(contentType).send(content);

    } catch (error) {
        // dynamic resource serving should probably just fail gracefully usually
        next(error);
    }
});

/**
 * POST /api/apps/:id/stop
 */
router.post("/:id/stop", async (req, res, next) => {
    try {
        const { id } = req.params;
        const appId = Number(id);

        console.log(`[WebBackend] Stopping app ${id}`);

        if (runningApps.has(appId)) {
            const running = runningApps.get(appId)!;
            // Kill the process tree ideally, but for now simple kill
            // On Windows, tree kill is often needed. 
            // process.kill() might only kill the shell.
            // Using tree-kill would be better but let's try standard kill first.
            running.process.kill();
            runningApps.delete(appId);
        }

        res.json({
            success: true,
            data: {
                success: true
            }
        });
    } catch (error) {
        next(error);
    }
});


/**
 * POST /api/apps/:id/copy
 */
router.post("/:id/copy", async (req, res, next) => {
    try {
        const db = getDb();
        const { id } = req.params;
        const { newAppName } = req.body;

        if (!newAppName) {
            throw createError("New app name required", 400, "INVALID_NAME");
        }

        const app = await db.select().from(apps).where(eq(apps.id, Number(id))).limit(1);
        if (!app.length) {
            throw createError("App not found", 404, "APP_NOT_FOUND");
        }

        const sanitizedName = newAppName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
        const timestamp = Date.now();
        const webPath = `/web-apps/${sanitizedName}-${timestamp}`;

        const newApp = await db.insert(apps).values({
            name: newAppName,
            path: webPath,
        }).returning();

        // Copy chats? For now just create a new empty one
        await db.insert(chats).values({
            appId: newApp[0].id,
            title: null,
        });

        res.json({
            success: true,
            data: {
                success: true,
                app: newApp[0]
            }
        });
    } catch (error) {
        next(error);
    }
});

export default router;

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

const router = Router();

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

        res.json({
            success: true,
            data: app[0],
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

        // Mock file system in web mode
        // In a real implementation, this would read from a secure container or storage
        // For now, we return a mock content if the file implies it's new

        res.json({
            success: true,
            data: {
                content: `// Content of ${filePath}\n// Fetched from Web Backend`,
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

        // Mock write
        console.log(`[WebBackend] Writing to app ${id} file ${filePath}: ${content.substring(0, 20)}...`);

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
        // Mock run
        console.log(`[WebBackend] Running app ${id}`);

        // We could trigger a websocket event here to stream "logs"

        res.json({
            success: true,
            data: {
                success: true,
                processId: 12345
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/apps/:id/stop
 */
router.post("/:id/stop", async (req, res, next) => {
    try {
        const { id } = req.params;
        // Mock stop
        console.log(`[WebBackend] Stopping app ${id}`);

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
            description: app[0].description ? `Copy of ${app[0].name}` : undefined,
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

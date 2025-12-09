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
 * POST /api/apps - Create new app
 */
router.post("/", async (req, res, next) => {
    try {
        const db = getDb();
        const body = CreateAppSchema.parse(req.body);

        const newApp = await db.insert(apps).values({
            name: body.name,
            description: body.description || "",
            // Additional fields will be set by service layer
        }).returning();

        res.status(201).json({
            success: true,
            data: newApp[0],
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

export default router;

/**
 * Prompts API routes
 */

import { Router } from "express";
import { z } from "zod";
import { createError } from "../middleware/errorHandler.js";
import { getDb } from "../db/index.js";
import { prompts } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";

const router = Router();

const CreatePromptSchema = z.object({
    title: z.string().min(1),
    content: z.string().min(1),
    description: z.string().optional(),
});

const UpdatePromptSchema = z.object({
    title: z.string().min(1).optional(),
    content: z.string().min(1).optional(),
    description: z.string().optional(),
});

/**
 * GET /api/prompts - List all prompts
 */
router.get("/", async (req, res, next) => {
    try {
        const db = getDb();
        const allPrompts = await db.select().from(prompts).orderBy(desc(prompts.updatedAt));

        res.json({
            success: true,
            data: allPrompts,
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/prompts - Create prompt
 */
router.post("/", async (req, res, next) => {
    try {
        const db = getDb();
        const body = CreatePromptSchema.parse(req.body);

        const newPrompt = await db.insert(prompts).values({
            title: body.title,
            content: body.content,
            description: body.description,
            createdAt: new Date(),
            updatedAt: new Date(),
        }).returning();

        res.status(201).json({
            success: true,
            data: newPrompt[0],
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
 * PUT /api/prompts/:id - Update prompt
 */
router.put("/:id", async (req, res, next) => {
    try {
        const db = getDb();
        const { id } = req.params;
        const body = UpdatePromptSchema.parse(req.body);

        const updated = await db.update(prompts)
            .set({
                ...body,
                updatedAt: new Date(),
            })
            .where(eq(prompts.id, Number(id)))
            .returning();

        if (!updated.length) {
            throw createError("Prompt not found", 404, "PROMPT_NOT_FOUND");
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
 * DELETE /api/prompts/:id - Delete prompt
 */
router.delete("/:id", async (req, res, next) => {
    try {
        const db = getDb();
        const { id } = req.params;

        const deleted = await db.delete(prompts).where(eq(prompts.id, Number(id))).returning();

        if (!deleted.length) {
            throw createError("Prompt not found", 404, "PROMPT_NOT_FOUND");
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

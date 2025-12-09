/**
 * Chats API routes
 * Migrated from: src/ipc/handlers/chat_handlers.ts
 */

import { Router } from "express";
import { z } from "zod";
import { createError } from "../middleware/errorHandler.js";
import { getDb } from "../db/index.js";
import { chats, messages } from "../db/schema.js";
import { eq, desc, and } from "drizzle-orm";

const router = Router();

// Validation schemas
const CreateChatSchema = z.object({
    appId: z.number(),
    title: z.string().optional(),
});

/**
 * GET /api/chats - List all chats (optionally by appId)
 */
router.get("/", async (req, res, next) => {
    try {
        const db = getDb();
        const { appId } = req.query;

        // @ts-ignore - updatedAt will be added to schema later
        let query = db.select().from(chats).orderBy(desc(chats.updatedAt));

        if (appId) {
            const allChats = await db.select()
                .from(chats)
                .where(eq(chats.appId, Number(appId)))
                // @ts-ignore - updatedAt will be added to schema later
                .orderBy(desc(chats.updatedAt));

            return res.json({
                success: true,
                data: allChats,
            });
        }

        const allChats = await query;

        res.json({
            success: true,
            data: allChats,
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/chats/:id - Get single chat with messages
 */
router.get("/:id", async (req, res, next) => {
    try {
        const db = getDb();
        const { id } = req.params;

        const chat = await db.select().from(chats).where(eq(chats.id, Number(id))).limit(1);

        if (!chat.length) {
            throw createError("Chat not found", 404, "CHAT_NOT_FOUND");
        }

        const chatMessages = await db.select()
            .from(messages)
            .where(eq(messages.chatId, Number(id)))
            .orderBy(messages.createdAt);

        res.json({
            success: true,
            data: {
                ...chat[0],
                messages: chatMessages,
            },
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/chats - Create new chat
 */
router.post("/", async (req, res, next) => {
    try {
        const db = getDb();
        const body = CreateChatSchema.parse(req.body);

        const newChat = await db.insert(chats).values({
            appId: body.appId,
            title: body.title || "New Chat",
        }).returning();

        res.status(201).json({
            success: true,
            data: newChat[0],
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
 * DELETE /api/chats/:id - Delete chat
 */
router.delete("/:id", async (req, res, next) => {
    try {
        const db = getDb();
        const { id } = req.params;

        // Delete associated messages first
        await db.delete(messages).where(eq(messages.chatId, Number(id)));

        // Delete the chat
        const deleted = await db.delete(chats).where(eq(chats.id, Number(id))).returning();

        if (!deleted.length) {
            throw createError("Chat not found", 404, "CHAT_NOT_FOUND");
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

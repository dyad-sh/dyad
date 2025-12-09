/**
 * MCP (Model Context Protocol) API routes
 * Migrated from: src/ipc/handlers/mcp_handlers.ts
 */

import { Router } from "express";
import { z } from "zod";
import { createError } from "../middleware/errorHandler.js";
import { getDb } from "../db/index.js";
import { mcpServers, mcpToolConsents } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

const router = Router();

// Validation schemas
const CreateMcpServerSchema = z.object({
    name: z.string().min(1),
    transport: z.enum(["stdio", "http"]),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    url: z.string().url().optional(),
    enabled: z.boolean().default(true),
});

const UpdateMcpServerSchema = CreateMcpServerSchema.partial();

const SetToolConsentSchema = z.object({
    toolName: z.string(),
    consent: z.enum(["ask", "always", "denied"]),
});

/**
 * GET /api/mcp/servers - List all MCP servers
 */
router.get("/servers", async (req, res, next) => {
    try {
        const db = getDb();
        const servers = await db.select().from(mcpServers);

        res.json({
            success: true,
            data: servers.map((s) => ({
                ...s,
                args: s.args || [],
                env: s.envJson || {},
            })),
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/mcp/servers/:id - Get single MCP server
 */
router.get("/servers/:id", async (req, res, next) => {
    try {
        const db = getDb();
        const { id } = req.params;

        const server = await db.select().from(mcpServers).where(eq(mcpServers.id, Number(id))).limit(1);

        if (!server.length) {
            throw createError("MCP server not found", 404, "NOT_FOUND");
        }

        res.json({
            success: true,
            data: {
                ...server[0],
                args: server[0].args || [],
                env: server[0].envJson || {},
            },
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/mcp/servers - Create MCP server
 */
router.post("/servers", async (req, res, next) => {
    try {
        const db = getDb();
        const body = CreateMcpServerSchema.parse(req.body);

        const newServer = await db.insert(mcpServers).values({
            name: body.name,
            transport: body.transport,
            command: body.command,
            args: body.args || null,
            envJson: body.env || null,
            url: body.url,
            enabled: body.enabled,
        }).returning();

        res.status(201).json({
            success: true,
            data: newServer[0],
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({
                success: false,
                error: { message: "Validation error", code: "VALIDATION_ERROR", details: error.errors },
            });
        }
        next(error);
    }
});

/**
 * PUT /api/mcp/servers/:id - Update MCP server
 */
router.put("/servers/:id", async (req, res, next) => {
    try {
        const db = getDb();
        const { id } = req.params;
        const body = UpdateMcpServerSchema.parse(req.body);

        const updateData: any = { updatedAt: new Date() };
        if (body.name !== undefined) updateData.name = body.name;
        if (body.transport !== undefined) updateData.transport = body.transport;
        if (body.command !== undefined) updateData.command = body.command;
        if (body.args !== undefined) updateData.args = body.args;
        if (body.env !== undefined) updateData.envJson = body.env;
        if (body.url !== undefined) updateData.url = body.url;
        if (body.enabled !== undefined) updateData.enabled = body.enabled;

        const updated = await db.update(mcpServers).set(updateData).where(eq(mcpServers.id, Number(id))).returning();

        if (!updated.length) {
            throw createError("MCP server not found", 404, "NOT_FOUND");
        }

        res.json({
            success: true,
            data: updated[0],
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({
                success: false,
                error: { message: "Validation error", code: "VALIDATION_ERROR", details: error.errors },
            });
        }
        next(error);
    }
});

/**
 * DELETE /api/mcp/servers/:id - Delete MCP server
 */
router.delete("/servers/:id", async (req, res, next) => {
    try {
        const db = getDb();
        const { id } = req.params;

        // Delete associated consents first (cascade should handle this, but be explicit)
        await db.delete(mcpToolConsents).where(eq(mcpToolConsents.serverId, Number(id)));

        const deleted = await db.delete(mcpServers).where(eq(mcpServers.id, Number(id))).returning();

        if (!deleted.length) {
            throw createError("MCP server not found", 404, "NOT_FOUND");
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
 * GET /api/mcp/servers/:id/consents - Get tool consents for server
 */
router.get("/servers/:id/consents", async (req, res, next) => {
    try {
        const db = getDb();
        const { id } = req.params;

        const consents = await db.select().from(mcpToolConsents).where(eq(mcpToolConsents.serverId, Number(id)));

        res.json({
            success: true,
            data: consents,
        });
    } catch (error) {
        next(error);
    }
});

/**
 * PUT /api/mcp/servers/:id/consents - Set tool consent
 */
router.put("/servers/:id/consents", async (req, res, next) => {
    try {
        const db = getDb();
        const { id } = req.params;
        const body = SetToolConsentSchema.parse(req.body);

        // Upsert consent
        const existing = await db.select().from(mcpToolConsents)
            .where(and(
                eq(mcpToolConsents.serverId, Number(id)),
                eq(mcpToolConsents.toolName, body.toolName)
            ))
            .limit(1);

        let result;
        if (existing.length) {
            result = await db.update(mcpToolConsents).set({
                consent: body.consent,
                updatedAt: new Date(),
            }).where(eq(mcpToolConsents.id, existing[0].id)).returning();
        } else {
            result = await db.insert(mcpToolConsents).values({
                serverId: Number(id),
                toolName: body.toolName,
                consent: body.consent,
            }).returning();
        }

        res.json({
            success: true,
            data: result[0],
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({
                success: false,
                error: { message: "Validation error", code: "VALIDATION_ERROR", details: error.errors },
            });
        }
        next(error);
    }
});

export default router;

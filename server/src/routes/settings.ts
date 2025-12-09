/**
 * Settings API routes
 * Migrated from: src/ipc/handlers/settings_handlers.ts
 */

import { Router } from "express";
import { z } from "zod";
import { createError } from "../middleware/errorHandler.js";
import fs from "node:fs";
import path from "node:path";

const router = Router();

// Settings file path
const getSettingsPath = () => {
    const dataDir = process.env.DATA_DIR || "./data";
    return path.join(dataDir, "settings.json");
};

// Default settings
const defaultSettings = {
    theme: "dark",
    telemetryEnabled: true,
    enableAutoUpdate: true,
    releaseChannel: "stable",
    defaultModel: "gpt-4o",
    hasRunBefore: false,
};

const SettingsSchema = z.object({
    theme: z.enum(["light", "dark", "system"]).optional(),
    telemetryEnabled: z.boolean().optional(),
    enableAutoUpdate: z.boolean().optional(),
    releaseChannel: z.enum(["stable", "beta"]).optional(),
    defaultModel: z.string().optional(),
    hasRunBefore: z.boolean().optional(),
    anthropicApiKey: z.string().optional(),
    openaiApiKey: z.string().optional(),
    googleApiKey: z.string().optional(),
});

/**
 * GET /api/settings - Get all settings
 */
router.get("/", async (req, res, next) => {
    try {
        const settingsPath = getSettingsPath();

        if (!fs.existsSync(settingsPath)) {
            return res.json({
                success: true,
                data: defaultSettings,
            });
        }

        const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));

        res.json({
            success: true,
            data: { ...defaultSettings, ...settings },
        });
    } catch (error) {
        next(error);
    }
});

/**
 * PUT /api/settings - Update settings
 */
router.put("/", async (req, res, next) => {
    try {
        const body = SettingsSchema.parse(req.body);
        const settingsPath = getSettingsPath();
        const dataDir = path.dirname(settingsPath);

        // Ensure data directory exists
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        // Read existing settings or use defaults
        let currentSettings = defaultSettings;
        if (fs.existsSync(settingsPath)) {
            currentSettings = { ...defaultSettings, ...JSON.parse(fs.readFileSync(settingsPath, "utf-8")) };
        }

        // Merge with new settings
        const updatedSettings = { ...currentSettings, ...body };

        // Write back
        fs.writeFileSync(settingsPath, JSON.stringify(updatedSettings, null, 2));

        res.json({
            success: true,
            data: updatedSettings,
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

export default router;

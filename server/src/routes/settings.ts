/**
 * Settings API routes
 * Migrated from: src/ipc/handlers/settings_handlers.ts
 */

import { Router } from "express";
import { z } from "zod";
import { createError } from "../middleware/errorHandler.js";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../db/index.js";
import { language_model_providers, system_settings } from "../db/schema.js";
import { eq, inArray } from "drizzle-orm";

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
    defaultModel: "deepseek/deepseek-chat-v3.1:free",
    hasRunBefore: false,
};

const SecretSchema = z.object({
    value: z.string(),
    encryptionType: z.enum(["electron-safe-storage", "plaintext"]).optional(),
});

const ProviderSettingSchema = z.object({
    apiKey: SecretSchema.optional(),
    // Allow other fields like resourceName (Azure) or projectId (Vertex)
}).passthrough();

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
    githubClientId: z.string().optional(),
    githubClientSecret: z.string().optional(),

    // Support modern nested provider settings
    providerSettings: z.record(z.string(), ProviderSettingSchema).optional(),
});

const PROVIDER_IDS = {
    openaiApiKey: "openai",
    anthropicApiKey: "anthropic",
    googleApiKey: "google",
};

/**
 * GET /api/settings - Get all settings
 */
router.get("/", async (req, res, next) => {
    try {
        const settingsPath = getSettingsPath();
        let settings = defaultSettings;

        if (fs.existsSync(settingsPath)) {
            settings = { ...defaultSettings, ...JSON.parse(fs.readFileSync(settingsPath, "utf-8")) };
        }

        // Fetch keys and settings from DB
        try {
            const db = getDb();
            const providers = await db.select().from(language_model_providers);
            const sysSettings = await db.select().from(system_settings).where(inArray(system_settings.key, ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "defaultModel"]));

            // Map DB keys to settings object
            for (const provider of providers) {
                if (provider.apiKey) {
                    if (provider.id === "openai") settings = { ...settings, openaiApiKey: provider.apiKey } as any;
                    if (provider.id === "anthropic") settings = { ...settings, anthropicApiKey: provider.apiKey } as any;
                    if (provider.id === "google") settings = { ...settings, googleApiKey: provider.apiKey } as any;
                }
            }

            for (const setting of sysSettings) {
                if (setting.key === "GITHUB_CLIENT_ID") settings = { ...settings, githubClientId: setting.value } as any;
                if (setting.key === "GITHUB_CLIENT_SECRET") settings = { ...settings, githubClientSecret: setting.value } as any;
                if (setting.key === "defaultModel") settings = { ...settings, defaultModel: setting.value } as any;
            }
        } catch (e) {
            console.error("Failed to fetch providers from DB:", e);
            // Non-fatal, return file settings
        }

        res.json({
            success: true,
            data: settings,
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

        // Separate keys from general settings
        const { openaiApiKey, anthropicApiKey, googleApiKey, githubClientId, githubClientSecret, ...generalSettings } = body;

        // Merge with new settings (excluding keys from JSON file ideally, but keeping backwards compat logic if needed)
        // We will strip keys from saving to JSON to ensure they only live in DB if that's the goal, 
        // OR we keep them in both. User said "persist in DB", implies DB is the source of truth.
        // Let's remove them from the object saved to JSON to avoid duplication/stale content.
        const settingsToSave = { ...currentSettings, ...generalSettings };
        delete (settingsToSave as any).openaiApiKey;
        delete (settingsToSave as any).anthropicApiKey;
        delete (settingsToSave as any).googleApiKey;

        // Write back general settings
        fs.writeFileSync(settingsPath, JSON.stringify(settingsToSave, null, 2));

        // Save keys to DB
        try {
            const db = getDb();

            const upsertKey = async (id: string, name: string, apiKey?: string, baseUrl = "https://api.openai.com/v1") => {
                if (apiKey !== undefined) {
                    // Only update if provided (even empty string to clear?)
                    // If undefined, do nothing. If empty string, maybe clear?
                    // Assuming provided means update.

                    await db.insert(language_model_providers).values({
                        id,
                        name,
                        api_base_url: baseUrl, // Default, not real for all but required by schema
                        apiKey,
                    }).onConflictDoUpdate({
                        target: language_model_providers.id,
                        set: { apiKey, updatedAt: new Date() }
                    });
                }
            };

            if (openaiApiKey !== undefined) await upsertKey("openai", "OpenAI", openaiApiKey, "https://api.openai.com/v1");
            if (anthropicApiKey !== undefined) await upsertKey("anthropic", "Anthropic", anthropicApiKey, "https://api.anthropic.com");
            if (googleApiKey !== undefined) await upsertKey("google", "Google Gemini", googleApiKey, "https://generativelanguage.googleapis.com");

            // Save System Settings
            const upsertSystemSetting = async (key: string, value?: string, description?: string) => {
                if (value !== undefined) {
                    await db.insert(system_settings).values({
                        key,
                        value,
                        description,
                    }).onConflictDoUpdate({
                        target: system_settings.key,
                        set: { value, updatedAt: new Date() }
                    });
                }
            };

            await upsertSystemSetting("GITHUB_CLIENT_ID", githubClientId, "GitHub Client ID");
            await upsertSystemSetting("GITHUB_CLIENT_SECRET", githubClientSecret, "GitHub Client Secret");

            // Save defaultModel to DB
            if (body.defaultModel !== undefined) {
                await upsertSystemSetting("defaultModel", body.defaultModel, "Default AI model for chat");
            }

        } catch (e) {
            console.error("Failed to save keys to DB:", e);
            throw createError("Failed to persist API keys to database", 500);
        }

        // Return combined result
        res.json({
            success: true,
            data: { ...settingsToSave, openaiApiKey, anthropicApiKey, googleApiKey, githubClientId, githubClientSecret } as any,
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

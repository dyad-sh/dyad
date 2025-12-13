/**
 * Language Model Providers API Routes
 */

import { Router } from "express";
import { getDb } from "../db/index.js";
import { language_model_providers, language_models } from "../db/schema.js";
import { eq } from "drizzle-orm";

const router = Router();

// List all providers (built-in + custom)
router.get("/providers", async (req, res) => {
    try {
        const db = getDb();
        const customProviders = await db.select().from(language_model_providers);

        res.json({
            success: true,
            data: customProviders,
        });
    } catch (error) {
        console.error("[API] Error listing providers:", error);
        res.status(500).json({
            success: false,
            error: {
                message: error instanceof Error ? error.message : "Failed to list providers",
                code: "PROVIDERS_LIST_ERROR",
            },
        });
    }
});

// Create custom provider
router.post("/providers", async (req, res) => {
    try {
        const { id, name, apiBaseUrl, envVarName, apiKey } = req.body;

        if (!id || !name || !apiBaseUrl) {
            return res.status(400).json({
                success: false,
                error: {
                    message: "Missing required fields: id, name, apiBaseUrl",
                    code: "INVALID_INPUT",
                },
            });
        }

        const db = getDb();

        // Insert provider
        const [provider] = await db.insert(language_model_providers).values({
            id,
            name,
            api_base_url: apiBaseUrl,
            env_var_name: envVarName,
            apiKey: apiKey || null,
        }).returning();

        res.status(201).json({
            success: true,
            data: provider,
        });
    } catch (error) {
        console.error("[API] Error creating provider:", error);
        res.status(500).json({
            success: false,
            error: {
                message: error instanceof Error ? error.message : "Failed to create provider",
                code: "PROVIDER_CREATE_ERROR",
            },
        });
    }
});

// Update custom provider
router.put("/providers/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { name, apiBaseUrl, envVarName, apiKey } = req.body;

        const db = getDb();

        const updateData: any = {};
        if (name) updateData.name = name;
        if (apiBaseUrl) updateData.api_base_url = apiBaseUrl;
        if (envVarName !== undefined) updateData.env_var_name = envVarName;
        if (apiKey !== undefined) updateData.apiKey = apiKey;

        const [provider] = await db
            .update(language_model_providers)
            .set(updateData)
            .where(eq(language_model_providers.id, id))
            .returning();

        if (!provider) {
            return res.status(404).json({
                success: false,
                error: {
                    message: "Provider not found",
                    code: "PROVIDER_NOT_FOUND",
                },
            });
        }

        res.json({
            success: true,
            data: provider,
        });
    } catch (error) {
        console.error("[API] Error updating provider:", error);
        res.status(500).json({
            success: false,
            error: {
                message: error instanceof Error ? error.message : "Failed to update provider",
                code: "PROVIDER_UPDATE_ERROR",
            },
        });
    }
});

// Delete custom provider
router.delete("/providers/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const db = getDb();

        await db
            .delete(language_model_providers)
            .where(eq(language_model_providers.id, id));

        res.json({
            success: true,
            data: { deleted: true },
        });
    } catch (error) {
        console.error("[API] Error deleting provider:", error);
        res.status(500).json({
            success: false,
            error: {
                message: error instanceof Error ? error.message : "Failed to delete provider",
                code: "PROVIDER_DELETE_ERROR",
            },
        });
    }
});

// List models for a provider
router.get("/providers/:id/models", async (req, res) => {
    try {
        const { id } = req.params;
        const db = getDb();

        const models = await db
            .select()
            .from(language_models)
            .where(eq(language_models.customProviderId, id));

        res.json({
            success: true,
            data: models,
        });
    } catch (error) {
        console.error("[API] Error listing models:", error);
        res.status(500).json({
            success: false,
            error: {
                message: error instanceof Error ? error.message : "Failed to list models",
                code: "MODELS_LIST_ERROR",
            },
        });
    }
});

// Create custom model for a provider
router.post("/providers/:id/models", async (req, res) => {
    try {
        const { id: providerId } = req.params;
        const { displayName, apiName, description, maxOutputTokens, contextWindow } = req.body;

        if (!displayName || !apiName) {
            return res.status(400).json({
                success: false,
                error: {
                    message: "Missing required fields: displayName, apiName",
                    code: "INVALID_INPUT",
                },
            });
        }

        const db = getDb();

        const [model] = await db.insert(language_models).values({
            displayName,
            apiName,
            customProviderId: providerId,
            description: description || null,
            max_output_tokens: maxOutputTokens || null,
            context_window: contextWindow || null,
        }).returning();

        res.status(201).json({
            success: true,
            data: model,
        });
    } catch (error) {
        console.error("[API] Error creating model:", error);
        res.status(500).json({
            success: false,
            error: {
                message: error instanceof Error ? error.message : "Failed to create model",
                code: "MODEL_CREATE_ERROR",
            },
        });
    }
});

export default router;

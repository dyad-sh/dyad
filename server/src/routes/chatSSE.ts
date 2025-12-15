/**
 * Chat Streaming via Server-Sent Events (SSE)
 * Fallback for WebSocket when proxied through Cloudflare/CDN
 */

import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google, createGoogleGenerativeAI } from "@ai-sdk/google";
import { getDb } from "../db/index.js";
import { language_model_providers, messages, chats, system_settings, language_models } from "../db/schema.js";
import { eq, and, not } from "drizzle-orm";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { parseCodeBlocks } from "../utils/codeBlockParser.js";
import { FileService } from "../services/fileService.js";

const router = Router();

// Active streams for cancellation
const activeStreams = new Map<string, AbortController>();

/**
 * Get the appropriate AI provider based on model string
 */
async function getModelProvider(modelId: string) {
    const db = getDb();

    const getApiKey = async (providerId: string, envVar: string): Promise<string | undefined> => {
        try {
            const result = await db.select({ apiKey: language_model_providers.apiKey })
                .from(language_model_providers)
                .where(eq(language_model_providers.id, providerId))
                .limit(1);

            if (result.length > 0 && result[0].apiKey) {
                return result[0].apiKey;
            }
        } catch (e) {
            console.error(`Failed to fetch key for ${providerId}:`, e);
        }
        return process.env[envVar];
    };

    // Check custom models first
    const customModel = await db.select({
        model: language_models,
        provider: language_model_providers
    })
        .from(language_models)
        .innerJoin(language_model_providers, eq(language_models.customProviderId, language_model_providers.id))
        .where(eq(language_models.apiName, modelId))
        .limit(1);

    if (customModel.length > 0) {
        const { provider, model } = customModel[0];
        console.log(`[SSE] Using custom provider ${provider.name} for model ${model.apiName}`);
        const customOpenAI = createOpenAI({
            apiKey: provider.apiKey || process.env[provider.env_var_name || ""] || "",
            baseURL: provider.api_base_url,
        });
        return customOpenAI.chat(model.apiName);
    }

    // Built-in providers
    if (modelId.startsWith("claude")) {
        const apiKey = await getApiKey("anthropic", "ANTHROPIC_API_KEY");
        if (apiKey) return createAnthropic({ apiKey })(modelId);
        return anthropic(modelId);
    } else if (modelId.startsWith("gemini")) {
        const apiKey = await getApiKey("google", "GOOGLE_GENERATIVE_AI_API_KEY");
        if (apiKey) return createGoogleGenerativeAI({ apiKey })(modelId);
        return google(modelId);
    } else if (modelId.startsWith("gpt-") || modelId.startsWith("o1-")) {
        const apiKey = await getApiKey("openai", "OPENAI_API_KEY");
        if (apiKey) return createOpenAI({ apiKey })(modelId);
        return openai(modelId);
    }

    // Default fallback
    const apiKey = await getApiKey("openai", "OPENAI_API_KEY");
    if (apiKey) return createOpenAI({ apiKey })(modelId || "gpt-4o");
    return openai(modelId || "gpt-4o");
}

/**
 * POST /api/chat/stream - SSE endpoint for chat streaming
 */
router.post("/stream", async (req: Request, res: Response) => {
    const { chatId, messages: clientMessages, model: requestModel, systemPrompt } = req.body;

    if (!chatId || !clientMessages) {
        res.status(400).json({ error: "chatId and messages required" });
        return;
    }

    const requestId = uuidv4();
    const abortController = new AbortController();
    activeStreams.set(requestId, abortController);

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
    res.flushHeaders();

    // Send request ID
    res.write(`data: ${JSON.stringify({ type: "stream_started", requestId })}\n\n`);

    try {
        const db = getDb();

        // Save user message
        const userMessage = await db.insert(messages).values({
            chatId,
            role: "user",
            content: clientMessages[clientMessages.length - 1].content,
        }).returning();

        // Create placeholder for assistant message
        const assistantMessage = await db.insert(messages).values({
            chatId,
            role: "assistant",
            content: "",
        }).returning();

        // Get model
        let modelToUse = requestModel || "gemini-1.5-flash";
        if (!requestModel) {
            const settingsResult = await db
                .select()
                .from(system_settings)
                .where(eq(system_settings.key, "defaultModel"))
                .limit(1);
            if (settingsResult.length > 0) {
                modelToUse = settingsResult[0].value;
            }
        }

        console.log(`[SSE] Starting stream for chat ${chatId} with model ${modelToUse}`);

        const model = await getModelProvider(modelToUse);

        // Get history
        const history = await db.select()
            .from(messages)
            .where(
                and(
                    eq(messages.chatId, chatId),
                    not(eq(messages.id, assistantMessage[0].id)),
                    not(eq(messages.id, userMessage[0].id))
                )
            )
            .orderBy(messages.createdAt)
            .limit(20);

        const historyMessages = history.map(msg => ({
            role: msg.role as "user" | "assistant" | "system",
            content: msg.content
        }));

        const currentMessage = { role: "user" as const, content: clientMessages[clientMessages.length - 1].content };

        const messagesWithSystem = [
            ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
            ...historyMessages,
            currentMessage
        ];

        const { textStream } = await streamText({
            model,
            messages: messagesWithSystem,
            abortSignal: abortController.signal,
        });

        let fullResponse = "";

        // Stream chunks
        for await (const chunk of textStream) {
            if (res.writableEnded) break;

            fullResponse += chunk;
            res.write(`data: ${JSON.stringify({ type: "chunk", content: chunk, requestId })}\n\n`);
        }

        // Update assistant message
        await db.update(messages)
            .set({ content: fullResponse })
            .where(eq(messages.id, assistantMessage[0].id));

        // Update chat timestamp
        await db.update(chats)
            .set({ updatedAt: new Date() })
            .where(eq(chats.id, chatId));

        // Parse and save files
        try {
            const parsedFiles = parseCodeBlocks(fullResponse);
            if (parsedFiles.length > 0) {
                const chat = await db.select().from(chats).where(eq(chats.id, chatId)).limit(1);
                if (chat.length > 0) {
                    const appId = chat[0].appId;
                    const fileService = new FileService();
                    for (const file of parsedFiles) {
                        await fileService.saveFile(appId, file.path, file.content);
                    }
                    res.write(`data: ${JSON.stringify({ type: "files_updated", count: parsedFiles.length, files: parsedFiles.map(f => f.path) })}\n\n`);
                    console.log(`[SSE] Saved ${parsedFiles.length} files for app ${appId}`);
                }
            }
        } catch (fileError) {
            console.error("[SSE] Error parsing/saving files:", fileError);
        }

        // Send end
        res.write(`data: ${JSON.stringify({ type: "end", requestId })}\n\n`);
        res.end();

    } catch (error) {
        console.error("[SSE] Stream error:", error);
        const errorMessage = error instanceof Error ? error.message : "Stream failed";
        res.write(`data: ${JSON.stringify({ type: "error", error: errorMessage, requestId })}\n\n`);
        res.end();
    } finally {
        activeStreams.delete(requestId);
    }
});

/**
 * POST /api/chat/cancel - Cancel active stream
 */
router.post("/cancel", (req: Request, res: Response) => {
    const { requestId } = req.body;
    const controller = activeStreams.get(requestId);
    if (controller) {
        controller.abort();
        activeStreams.delete(requestId);
        res.json({ success: true, cancelled: true });
    } else {
        res.json({ success: true, cancelled: false });
    }
});

export default router;

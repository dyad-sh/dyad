/**
 * Chat Streaming WebSocket handler
 * Migrated from: src/ipc/handlers/chat_stream_handlers.ts
 */

import { WebSocketServer, WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google, createGoogleGenerativeAI } from "@ai-sdk/google";
import { getDb } from "../db/index.js";
import { language_model_providers, messages, chats } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import fs from "node:fs";
import path from "node:path";

interface ChatMessage {
    role: "user" | "assistant" | "system";
    content: string;
}

interface StreamRequest {
    type: "start_stream";
    chatId: number;
    messages: ChatMessage[];
    model?: string;
    systemPrompt?: string;
}

interface StreamChunk {
    type: "chunk" | "end" | "error";
    content?: string;
    error?: string;
    requestId?: string;
}

// Active streams map for cancellation
const activeStreams = new Map<string, AbortController>();

/**
 * Get the appropriate AI provider based on model string
 */
/**
 * Get the appropriate AI provider based on model string
 * Fetches API key from DB if available.
 */
async function getModelProvider(modelId: string) {
    const db = getDb(); // Assuming we export getDb from ../db/index.js

    // Helper to get key from DB or Env
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

    // Check for OpenRouter models (format: provider/model:variant)
    if (modelId.includes('/') && modelId.includes(':')) {
        const apiKey = await getApiKey("openrouter", "OPENROUTER_API_KEY");
        if (apiKey) {
            return createOpenAI({
                apiKey,
                baseURL: "https://openrouter.ai/api/v1",
            })(modelId);
        }
        // Fallback to env var
        if (process.env.OPENROUTER_API_KEY) {
            return createOpenAI({
                apiKey: process.env.OPENROUTER_API_KEY,
                baseURL: "https://openrouter.ai/api/v1",
            })(modelId);
        }
    }

    if (modelId.startsWith("claude")) {
        const apiKey = await getApiKey("anthropic", "ANTHROPIC_API_KEY");
        if (apiKey) return createAnthropic({ apiKey })(modelId);
        return anthropic(modelId); // Fallback to default env var behavior of SDK
    } else if (modelId.startsWith("gemini")) {
        const apiKey = await getApiKey("google", "GOOGLE_GENERATIVE_AI_API_KEY"); // or GOOGLE_API_KEY
        if (apiKey) return createGoogleGenerativeAI({ apiKey })(modelId);
        return google(modelId);
    } else {
        // Default to OpenAI
        const apiKey = await getApiKey("openai", "OPENAI_API_KEY");
        if (apiKey) return createOpenAI({ apiKey })(modelId || "gpt-4o");
        return openai(modelId || "gpt-4o");
    }
}

/**
 * Setup WebSocket handler for chat streaming
 */
export function setupChatWebSocket(wss: WebSocketServer) {
    wss.on("connection", (ws: WebSocket) => {
        console.log("[WS] New client connected");
        const clientId = uuidv4();

        ws.on("message", async (data: Buffer) => {
            try {
                const message = JSON.parse(data.toString());

                if (message.type === "start_stream") {
                    await handleStreamRequest(ws, clientId, message as StreamRequest);
                } else if (message.type === "cancel_stream") {
                    handleCancelStream(message.requestId);
                }
            } catch (error) {
                console.error("[WS] Error processing message:", error);
                ws.send(JSON.stringify({
                    type: "error",
                    error: error instanceof Error ? error.message : "Unknown error",
                }));
            }
        });

        ws.on("close", () => {
            console.log("[WS] Client disconnected:", clientId);
            // Cancel any active streams for this client
            for (const [requestId, controller] of activeStreams) {
                if (requestId.startsWith(clientId)) {
                    controller.abort();
                    activeStreams.delete(requestId);
                }
            }
        });

        ws.on("error", (error) => {
            console.error("[WS] WebSocket error:", error);
        });
    });

    console.log("[WS] Chat WebSocket server initialized");
}

/**
 * Handle streaming chat request
 */
async function handleStreamRequest(
    ws: WebSocket,
    clientId: string,
    request: StreamRequest
) {
    const requestId = `${clientId}-${uuidv4()}`;
    const abortController = new AbortController();
    activeStreams.set(requestId, abortController);

    try {
        // Get database connection
        const db = getDb();

        // Save user message to database
        const userMessage = await db.insert(messages).values({
            chatId: request.chatId,
            role: "user",
            content: request.messages[request.messages.length - 1].content,
        }).returning();

        // Create placeholder for assistant message
        const assistantMessage = await db.insert(messages).values({
            chatId: request.chatId,
            role: "assistant",
            content: "",
        }).returning();

        let fullResponse = "";

        // Get default model from settings if not specified
        let modelToUse: string = request.model || "gemini-2.0-flash-exp";
        if (!request.model) {
            try {
                const dataDir = process.env.DATA_DIR || "./data";
                const settingsPath = path.join(dataDir, "settings.json");
                if (fs.existsSync(settingsPath)) {
                    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
                    modelToUse = settings.defaultModel || "gemini-2.0-flash-exp";
                    console.log(`[WS] Using default model from settings: ${modelToUse}`);
                }
            } catch (e) {
                console.error("[WS] Failed to read settings, using gemini-2.0-flash-exp:", e);
                // modelToUse already has fallback value
            }
        }

        const model = await getModelProvider(modelToUse);

        const messagesWithSystem = request.systemPrompt
            ? [{ role: "system" as const, content: request.systemPrompt as string }, ...request.messages]
            : request.messages;

        const { textStream } = await streamText({
            model,
            messages: messagesWithSystem,
            abortSignal: abortController.signal,
        });

        // Send request ID to client
        ws.send(JSON.stringify({ type: "stream_started", requestId }));

        // Stream chunks to client
        for await (const chunk of textStream) {
            if (ws.readyState !== WebSocket.OPEN) break;

            fullResponse += chunk;

            ws.send(JSON.stringify({
                type: "chunk",
                content: chunk,
                requestId,
            } as StreamChunk));
        }

        // Update assistant message with full response
        await db.update(messages)
            .set({ content: fullResponse })
            .where(eq(messages.id, assistantMessage[0].id));

        // Update chat timestamp
        await db.update(chats)
            .set({ updatedAt: new Date() })
            .where(eq(chats.id, request.chatId));

        // Send completion
        ws.send(JSON.stringify({
            type: "end",
            requestId,
        } as StreamChunk));

    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
            ws.send(JSON.stringify({
                type: "cancelled",
                requestId,
            }));
        } else {
            console.error("[WS] Stream error:", error);
            ws.send(JSON.stringify({
                type: "error",
                error: error instanceof Error ? error.message : "Stream failed",
                requestId,
            } as StreamChunk));
        }
    } finally {
        activeStreams.delete(requestId);
    }
}

/**
 * Cancel an active stream
 */
function handleCancelStream(requestId: string) {
    const controller = activeStreams.get(requestId);
    if (controller) {
        controller.abort();
        activeStreams.delete(requestId);
        console.log("[WS] Stream cancelled:", requestId);
    }
}

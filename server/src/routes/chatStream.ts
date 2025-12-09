/**
 * Chat Streaming WebSocket handler
 * Migrated from: src/ipc/handlers/chat_stream_handlers.ts
 */

import { WebSocketServer, WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";

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
function getModelProvider(modelId: string) {
    if (modelId.startsWith("claude")) {
        return anthropic(modelId);
    } else if (modelId.startsWith("gemini")) {
        return google(modelId);
    } else {
        // Default to OpenAI
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
        const model = getModelProvider(request.model || "gpt-4o");

        const messagesWithSystem = request.systemPrompt
            ? [{ role: "system" as const, content: request.systemPrompt }, ...request.messages]
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

            ws.send(JSON.stringify({
                type: "chunk",
                content: chunk,
                requestId,
            } as StreamChunk));
        }

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

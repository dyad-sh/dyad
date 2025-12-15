/**
 * API Client for Dyad Web
 * Replaces Electron IPC calls with HTTP/WebSocket API calls
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";

const getWsBaseUrl = () => {
    if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
    const protocol = window.location.protocol === "https:" ? "wss://" : "ws://";
    return `${protocol}${window.location.host}`;
};

const WS_BASE_URL = getWsBaseUrl();

// Types
interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: {
        message: string;
        code: string;
        details?: unknown;
    };
}

// Generic fetch wrapper
async function apiRequest<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;

    const response = await fetch(url, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...options.headers,
        },
    });

    const json: ApiResponse<T> = await response.json();

    if (!json.success || !response.ok) {
        throw new Error(json.error?.message || "API request failed");
    }

    return json.data as T;
}

// ============================================================================
// Apps API
// ============================================================================

export const appsApi = {
    list: () => apiRequest<any[]>("/apps"),

    get: (id: number) => apiRequest<any>(`/apps/${id}`),

    create: (data: { name: string; description?: string; templateId?: string }) =>
        apiRequest<any>("/apps", {
            method: "POST",
            body: JSON.stringify(data),
        }),

    update: (id: number, data: Partial<{ name: string; description: string; isFavorite: boolean }>) =>
        apiRequest<any>(`/apps/${id}`, {
            method: "PUT",
            body: JSON.stringify(data),
        }),

    delete: (id: number) =>
        apiRequest<{ deleted: boolean }>(`/apps/${id}`, { method: "DELETE" }),

    // File System
    readFile: (id: number, path: string) =>
        apiRequest<{ content: string }>(`/apps/${id}/files/read?path=${encodeURIComponent(path)}`),

    saveFile: (id: number, path: string, content: string) =>
        apiRequest<{ success: boolean; error?: string }>(`/apps/${id}/files/write`, {
            method: "POST",
            body: JSON.stringify({ path, content }),
        }),

    // Process Control
    run: (id: number) =>
        apiRequest<{ success: boolean; processId?: number; previewUrl?: string }>(`/apps/${id}/run`, { method: "POST" }),

    stop: (id: number) =>
        apiRequest<{ success: boolean }>(`/apps/${id}/stop`, { method: "POST" }),

    copy: (id: number, newAppName: string) =>
        apiRequest<{ app: any; success: boolean }>(`/apps/${id}/copy`, {
            method: "POST",
            body: JSON.stringify({ newAppName }),
        }),
};

// ============================================================================
// Chats API
// ============================================================================

export const chatsApi = {
    list: (appId?: number) =>
        apiRequest<any[]>(appId ? `/chats?appId=${appId}` : "/chats"),

    get: (id: number) => apiRequest<any>(`/chats/${id}`),

    create: (data: { appId: number; title?: string }) =>
        apiRequest<any>("/chats", {
            method: "POST",
            body: JSON.stringify(data),
        }),

    update: (id: number, data: { title: string }) =>
        apiRequest<any>(`/chats/${id}`, {
            method: "PUT",
            body: JSON.stringify(data),
        }),

    delete: (id: number) =>
        apiRequest<{ deleted: boolean }>(`/chats/${id}`, { method: "DELETE" }),
};

// ============================================================================
// Settings API
// ============================================================================

export const settingsApi = {
    get: () => apiRequest<any>("/settings"),

    update: (data: Record<string, unknown>) =>
        apiRequest<any>("/settings", {
            method: "PUT",
            body: JSON.stringify(data),
        }),
};

// ============================================================================
// Templates API
// ============================================================================

export const templatesApi = {
    list: () => apiRequest<any[]>("/templates"),
};

// ============================================================================
// GitHub API
// ============================================================================

export const githubApi = {
    status: () => apiRequest<{ connected: boolean; user?: { login: string } }>("/github/status"),

    connect: (accessToken: string) =>
        apiRequest<{ connected: boolean }>("/github/connect", {
            method: "POST",
            body: JSON.stringify({ accessToken }),
        }),

    disconnect: () =>
        apiRequest<{ connected: boolean }>("/github/disconnect", { method: "POST" }),

    listRepos: () => apiRequest<any[]>("/github/repos"),

    getBranches: (owner: string, repo: string) =>
        apiRequest<any[]>(`/github/repos/${owner}/${repo}/branches`),

    createRepo: (name: string, org?: string, isPrivate = true) =>
        apiRequest<any>("/github/repos", {
            method: "POST",
            body: JSON.stringify({ name, org, isPrivate }),
        }),

    push: (appId: number, force = false) =>
        apiRequest<{ pushed: boolean }>(`/github/push/${appId}`, {
            method: "POST",
            body: JSON.stringify({ force }),
        }),

    link: (appId: number, owner: string, repo: string, branch = "main") =>
        apiRequest<{ linked: boolean }>(`/github/link/${appId}`, {
            method: "POST",
            body: JSON.stringify({ owner, repo, branch }),
        }),

    unlink: (appId: number) =>
        apiRequest<{ unlinked: boolean }>(`/github/link/${appId}`, { method: "DELETE" }),
};

// ============================================================================
// MCP API
// ============================================================================

export const mcpApi = {
    listServers: () => apiRequest<any[]>("/mcp/servers"),

    getServer: (id: number) => apiRequest<any>(`/mcp/servers/${id}`),

    createServer: (data: {
        name: string;
        transport: "stdio" | "http";
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        url?: string;
        enabled?: boolean;
    }) =>
        apiRequest<any>("/mcp/servers", {
            method: "POST",
            body: JSON.stringify(data),
        }),

    updateServer: (id: number, data: Partial<{
        name: string;
        transport: "stdio" | "http";
        command: string;
        args: string[];
        env: Record<string, string>;
        url: string;
        enabled: boolean;
    }>) =>
        apiRequest<any>(`/mcp/servers/${id}`, {
            method: "PUT",
            body: JSON.stringify(data),
        }),

    deleteServer: (id: number) =>
        apiRequest<{ deleted: boolean }>(`/mcp/servers/${id}`, { method: "DELETE" }),

    getConsents: (serverId: number) =>
        apiRequest<any[]>(`/mcp/servers/${serverId}/consents`),

    setConsent: (serverId: number, toolName: string, consent: "ask" | "always" | "denied") =>
        apiRequest<any>(`/mcp/servers/${serverId}/consents`, {
            method: "PUT",
            body: JSON.stringify({ toolName, consent }),
        }),
};

// ============================================================================
// Prompts API
// ============================================================================

export const promptsApi = {
    list: () =>
        apiRequest<any[]>("/prompts"),

    create: (data: { title: string; content: string; description?: string }) =>
        apiRequest<any>("/prompts", {
            method: "POST",
            body: JSON.stringify(data),
        }),

    update: (id: number, data: Partial<{ title: string; content: string; description: string }>) =>
        apiRequest<any>(`/prompts/${id}`, {
            method: "PUT",
            body: JSON.stringify(data),
        }),

    delete: (id: number) =>
        apiRequest<{ deleted: boolean }>(`/prompts/${id}`, { method: "DELETE" }),
};

// ============================================================================
// Providers API
// ============================================================================

export const providersApi = {
    list: () => apiRequest<any[]>("/providers"),

    create: (data: {
        id: string;
        name: string;
        apiBaseUrl: string;
        envVarName?: string;
        apiKey?: string;
    }) =>
        apiRequest<any>("/providers", {
            method: "POST",
            body: JSON.stringify(data),
        }),

    update: (id: string, data: Partial<{
        name: string;
        apiBaseUrl: string;
        envVarName: string;
        apiKey: string;
    }>) =>
        apiRequest<any>(`/providers/${id}`, {
            method: "PUT",
            body: JSON.stringify(data),
        }),

    delete: (id: string) =>
        apiRequest<{ deleted: boolean }>(`/providers/${id}`, { method: "DELETE" }),

    listModels: (providerId: string) =>
        apiRequest<any[]>(`/providers/${providerId}/models`),

    createModel: (providerId: string, data: {
        displayName: string;
        apiName: string;
        description?: string;
        maxOutputTokens?: number;
        contextWindow?: number;
    }) =>
        apiRequest<any>(`/providers/${providerId}/models`, {
            method: "POST",
            body: JSON.stringify(data),
        }),
};

// ============================================================================
// Chat Streaming (SSE - Server-Sent Events)
// More reliable through Cloudflare/CDN than WebSocket
// ============================================================================

export interface ChatMessage {
    role: "user" | "assistant" | "system";
    content: string;
}

export interface StreamCallbacks {
    onChunk: (content: string) => void;
    onEnd: () => void;
    onError: (error: string) => void;
    onFilesUpdated?: (files: string[], count: number) => void;
}

export function createChatStream(
    chatId: number,
    messages: ChatMessage[],
    callbacks: StreamCallbacks,
    model?: string,
    systemPrompt?: string
): { cancel: () => void } {
    const abortController = new AbortController();
    let requestId: string | null = null;

    // Use SSE via fetch with streaming
    const startStream = async () => {
        try {
            console.log("[SSE] Starting chat stream...");
            const response = await fetch(`${API_BASE_URL}/chat/stream`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    chatId,
                    messages,
                    model,
                    systemPrompt,
                }),
                signal: abortController.signal,
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            if (!response.body) {
                throw new Error("Response body is null");
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();

                if (done) {
                    console.log("[SSE] Stream completed");
                    break;
                }

                buffer += decoder.decode(value, { stream: true });

                // Process complete SSE messages
                const lines = buffer.split("\n");
                buffer = lines.pop() || ""; // Keep incomplete line in buffer

                for (const line of lines) {
                    if (line.startsWith("data: ")) {
                        try {
                            const data = JSON.parse(line.slice(6));

                            switch (data.type) {
                                case "stream_started":
                                    requestId = data.requestId;
                                    console.log("[SSE] Stream started:", requestId);
                                    break;
                                case "chunk":
                                    callbacks.onChunk(data.content);
                                    break;
                                case "files_updated":
                                    callbacks.onFilesUpdated?.(data.files, data.count);
                                    break;
                                case "end":
                                    callbacks.onEnd();
                                    return;
                                case "error":
                                    callbacks.onError(data.error);
                                    return;
                            }
                        } catch (parseError) {
                            console.warn("[SSE] Failed to parse:", line);
                        }
                    }
                }
            }
        } catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
                console.log("[SSE] Stream cancelled");
                callbacks.onEnd();
            } else {
                console.error("[SSE] Stream error:", error);
                callbacks.onError(error instanceof Error ? error.message : "Stream error");
            }
        }
    };

    startStream();

    return {
        cancel: () => {
            console.log("[SSE] Cancelling stream");
            abortController.abort();

            // Also notify server to cancel
            if (requestId) {
                fetch(`${API_BASE_URL}/chat/cancel`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ requestId }),
                }).catch(() => { }); // Ignore errors on cancel
            }
        },
    };
}

// ============================================================================
// Health Check
// ============================================================================

export const healthApi = {
    check: () => apiRequest<{ status: string; timestamp: string }>("/health"),
    ready: () => apiRequest<{ status: string; database: string }>("/health/ready"),
};

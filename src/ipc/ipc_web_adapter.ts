/**
 * IPC Adapter for Web Mode
 * 
 * This module provides an adapter that mimics the Electron IPC client interface
 * but uses HTTP/WebSocket API calls under the hood. This allows gradual migration
 * by swapping the implementation without changing all consumer code.
 * 
 * Usage:
 * - In web mode: import { IpcClient } from "@/ipc/ipc_web_adapter"
 * - In Electron mode: import { IpcClient } from "@/ipc/ipc_client"
 */

import {
    appsApi,
    chatsApi,
    settingsApi,
    githubApi,
    mcpApi,
    healthApi,
    createChatStream,
    type ChatMessage,
    type StreamCallbacks,
} from "@/api/client";

import type {
    Chat,
    ChatResponseEnd,
    CreateAppParams,
    CreateAppResult,
    ListAppsResponse,
    Message,
    Version,
    UserSettings,
    App,
} from "./ipc_types";

export interface ChatStreamCallbacks {
    onUpdate: (messages: Message[]) => void;
    onEnd: (response: ChatResponseEnd) => void;
    onError: (error: string) => void;
}

export interface AppStreamCallbacks {
    onOutput: (output: any) => void;
}

/**
 * Web-based IPC Client that uses REST API instead of Electron IPC
 */
export class IpcClient {
    private static instance: IpcClient;
    private chatStreams: Map<number, { cancel: () => void }>;
    private appStreams: Map<number, AppStreamCallbacks>;

    private constructor() {
        this.chatStreams = new Map();
        this.appStreams = new Map();
    }

    public static getInstance(): IpcClient {
        if (!IpcClient.instance) {
            IpcClient.instance = new IpcClient();
        }
        return IpcClient.instance;
    }

    // =========================================================================
    // Apps
    // =========================================================================

    public async createApp(params: CreateAppParams): Promise<CreateAppResult> {
        const app = await appsApi.create({ name: params.appName || "New App" });
        return { app, chatId: 0 }; // TODO: Implement proper chat creation
    }

    public async getApp(appId: number): Promise<App> {
        return appsApi.get(appId);
    }

    public async listApps(): Promise<ListAppsResponse> {
        const apps = await appsApi.list();
        return { apps };
    }

    public async deleteApp(appId: number): Promise<void> {
        await appsApi.delete(appId);
    }

    public async renameApp(params: { appId: number; appName: string; appPath: string }): Promise<void> {
        await appsApi.update(params.appId, { name: params.appName });
    }

    public async addAppToFavorite(appId: number): Promise<{ isFavorite: boolean }> {
        const app = await appsApi.get(appId);
        const updated = await appsApi.update(appId, { isFavorite: !app.isFavorite });
        return { isFavorite: updated.isFavorite };
    }

    // =========================================================================
    // Chats
    // =========================================================================

    public async getChat(chatId: number): Promise<Chat> {
        return chatsApi.get(chatId);
    }

    public async getChats(appId?: number): Promise<any[]> {
        return chatsApi.list(appId);
    }

    public async createChat(appId: number): Promise<number> {
        const chat = await chatsApi.create({ appId });
        return chat.id;
    }

    public async deleteChat(chatId: number): Promise<void> {
        await chatsApi.delete(chatId);
    }

    // =========================================================================
    // Chat Streaming
    // =========================================================================

    public streamMessage(
        prompt: string,
        options: {
            chatId: number;
            redo?: boolean;
            onUpdate: (messages: Message[]) => void;
            onEnd: (response: ChatResponseEnd) => void;
            onError: (error: string) => void;
        }
    ): void {
        const { chatId, onUpdate, onEnd, onError } = options;

        const messages: ChatMessage[] = [{ role: "user", content: prompt }];
        let fullContent = "";

        const stream = createChatStream(
            chatId,
            messages,
            {
                onChunk: (chunk) => {
                    fullContent += chunk;
                    onUpdate([
                        { role: "user", content: prompt } as Message,
                        { role: "assistant", content: fullContent } as Message,
                    ]);
                },
                onEnd: () => {
                    onEnd({ chatId } as ChatResponseEnd);
                },
                onError: (error) => {
                    onError(error);
                },
            }
        );

        this.chatStreams.set(chatId, stream);
    }

    public cancelChatStream(chatId: number): void {
        const stream = this.chatStreams.get(chatId);
        if (stream) {
            stream.cancel();
            this.chatStreams.delete(chatId);
        }
    }

    // =========================================================================
    // Settings
    // =========================================================================

    public async getUserSettings(): Promise<UserSettings> {
        return settingsApi.get();
    }

    public async setUserSettings(settings: Partial<UserSettings>): Promise<UserSettings> {
        return settingsApi.update(settings);
    }

    // =========================================================================
    // GitHub
    // =========================================================================

    public async listGithubRepos(): Promise<{ name: string; full_name: string; private: boolean }[]> {
        return githubApi.listRepos();
    }

    public async getGithubRepoBranches(owner: string, repo: string): Promise<any[]> {
        return githubApi.getBranches(owner, repo);
    }

    public async createGithubRepo(org: string, repo: string, appId: number): Promise<void> {
        await githubApi.createRepo(repo, org);
        await githubApi.link(appId, org, repo);
    }

    public async syncGithubRepo(appId: number, force?: boolean): Promise<{ success: boolean; error?: string }> {
        try {
            await githubApi.push(appId, force);
            return { success: true };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : "Push failed" };
        }
    }

    public async disconnectGithubRepo(appId: number): Promise<void> {
        await githubApi.unlink(appId);
    }

    // =========================================================================
    // MCP
    // =========================================================================

    public async listMcpServers(): Promise<any[]> {
        return mcpApi.listServers();
    }

    public async createMcpServer(data: any): Promise<any> {
        return mcpApi.createServer(data);
    }

    public async updateMcpServer(id: number, data: any): Promise<any> {
        return mcpApi.updateServer(id, data);
    }

    public async deleteMcpServer(id: number): Promise<void> {
        await mcpApi.deleteServer(id);
    }

    // =========================================================================
    // Versions (Stub - requires backend implementation)
    // =========================================================================

    public async listVersions({ appId }: { appId: number }): Promise<Version[]> {
        console.warn("listVersions not yet implemented for web mode");
        return [];
    }

    public async revertVersion(params: any): Promise<any> {
        console.warn("revertVersion not yet implemented for web mode");
        return {};
    }

    // =========================================================================
    // System (Stubs for web mode)
    // =========================================================================

    public async openExternalUrl(url: string): Promise<void> {
        window.open(url, "_blank");
    }

    public async showItemInFolder(fullPath: string): Promise<void> {
        console.warn("showItemInFolder not available in web mode");
    }

    public async getNodejsStatus(): Promise<any> {
        return { nodeVersion: "N/A (Web Mode)", npmVersion: "N/A" };
    }

    public async resetAll(): Promise<void> {
        console.warn("resetAll not yet implemented for web mode");
    }

    public async restartDyad(): Promise<void> {
        window.location.reload();
    }

    public async getAppVersion(): Promise<string> {
        return "0.1.0-web";
    }

    // =========================================================================
    // Event handlers (No-ops for web mode)
    // =========================================================================

    public onDeepLinkReceived(callback: any): () => void {
        return () => { };
    }

    public onMcpToolConsentRequest(callback: any): () => void {
        return () => { };
    }

    public respondToMcpConsentRequest(requestId: string, decision: string): void {
        // No-op for web mode
    }

    // GitHub device flow (use token-based auth in web mode)
    public startGithubDeviceFlow(appId: number | null): void {
        console.warn("GitHub device flow not available in web mode. Use token-based auth.");
    }

    public onGithubDeviceFlowUpdate(callback: any): () => void {
        return () => { };
    }

    public onGithubDeviceFlowSuccess(callback: any): () => void {
        return () => { };
    }

    public onGithubDeviceFlowError(callback: any): () => void {
        return () => { };
    }
}

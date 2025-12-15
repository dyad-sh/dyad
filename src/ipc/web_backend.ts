
import type { IBackendClient } from "./backend_interface";
import {
    appsApi,
    chatsApi,
    settingsApi,
    mcpApi,
    promptsApi,
    templatesApi,
    createChatStream,
    ChatMessage,
    StreamCallbacks
} from "@/api/client";
import {
    ChatSummariesSchema,
    ChatSearchResultsSchema,
    AppSearchResultsSchema,
} from "@/lib/schemas";
import {
    PROVIDER_TO_ENV_VAR,
    CLOUD_PROVIDERS,
    LOCAL_PROVIDERS,
    MODEL_OPTIONS,
} from "@/ipc/shared/language_model_constants";
import type {
    App,
    AppOutput,
    AppSearchResult,
    AppUpgrade,
    ApproveProposalResult,
    BranchResult,
    Chat,
    ChatLogsData,
    ChatResponseEnd,
    ChatSearchResult,
    ChatSummary,
    CloneRepoParams,
    ComponentSelection,
    ConnectToExistingVercelProjectParams,
    ContextPathResults,
    CopyAppParams,
    CreateAppParams,
    CreateAppResult,
    CreateCustomLanguageModelParams,
    CreateCustomLanguageModelProviderParams,
    CreateMcpServer,
    CreateNeonProjectParams,
    CreatePromptParamsDto,
    CreateVercelProjectParams,
    DeepLinkData,
    DisconnectVercelProjectParams,
    DoesReleaseNoteExistParams,
    EditAppFileReturnType,
    FileAttachment,
    GetAppEnvVarsParams,
    GetNeonProjectParams,
    GetNeonProjectResponse,
    GetVercelDeploymentsParams,
    GitHubDeviceFlowErrorData,
    GitHubDeviceFlowSuccessData,
    GitHubDeviceFlowUpdateData,
    ImportAppParams,
    ImportAppResult,
    IsVercelProjectAvailableParams,
    IsVercelProjectAvailableResponse,
    LanguageModel,
    LanguageModelProvider,
    ListAppsResponse,
    LocalModel,
    McpServerUpdate,
    NeonProject,
    NodeSystemInfo,
    ProblemReport,
    PromptDto,
    ProposalResult,
    RenameBranchParams,
    RespondToAppInputParams,
    RevertVersionParams,
    RevertVersionResponse,
    SaveVercelAccessTokenParams,
    SecurityReviewResult,
    SelectNodeFolderResult,
    SetAppEnvVarsParams,
    SetSupabaseAppProjectParams,
    SupabaseBranch,
    SystemDebugInfo,
    Template,
    TokenCountParams,
    TokenCountResult,
    UpdateChatParams,
    UpdatePromptParamsDto,
    UserBudgetInfo,
    UserSettings,
    VercelDeployment,
    VercelProject,
    Version,
    Message,
    ChatProblemsEvent
} from "./ipc_types";

export class WebBackend implements IBackendClient {
    private chatCancelFns: Map<number, () => void> = new Map();

    async restartDyad(): Promise<void> {
        console.warn("restartDyad not supported in web");
    }
    async reloadEnvPath(): Promise<void> { }

    async getSystemDebugInfo(): Promise<SystemDebugInfo> {
        return {
            os: "web",
            arch: "web",
            release: "web",
            hostname: window.location.hostname,
            totalmem: 0,
            freemem: 0,
            cpus: [],
            uptime: 0,
            shell: navigator.userAgent,
            nodeVersion: "n/a",
            electronVersion: "n/a",
            chromeVersion: "n/a",
            appVersion: "web",
            userDataPath: "n/a",
            logsPath: "n/a",
            appPath: "n/a",
            tempPath: "n/a",
            homePath: "n/a",
            env: {},
            networkInterfaces: {},
            telemetryId: "web",
            telemetryConsent: "unknown",
            telemetryUrl: "",
            dyadVersion: "1.0.0-web",
            platform: "web",
            architecture: "web",
            logs: "",
            selectedLanguageModel: ""
        };
    }

    async getSystemPlatform(): Promise<string> {
        return "web";
    }

    // Apps
    async createApp(params: CreateAppParams): Promise<CreateAppResult> {
        return appsApi.create(params);
    }

    async getApp(appId: number): Promise<App> {
        return appsApi.get(appId);
    }

    async listApps(): Promise<ListAppsResponse> {
        const apps = await appsApi.list();
        return { apps, appBasePath: "" };
    }

    async searchApps(searchQuery: string): Promise<AppSearchResult[]> {
        // Basic Client-side filtering if API doesn't support search yet, or use list
        const { apps } = await this.listApps();
        return apps
            .filter(a => a.name.toLowerCase().includes(searchQuery.toLowerCase()))
            .map(a => ({ id: a.id, name: a.name, path: a.path, lastModified: new Date(a.updatedAt).getTime() }));
    }

    async deleteApp(appId: number): Promise<void> {
        await appsApi.delete(appId);
    }

    async renameApp(params: { appId: number; appName: string; appPath: string }): Promise<void> {
        await appsApi.update(params.appId, { name: params.appName });
    }

    async copyApp(params: CopyAppParams): Promise<{ app: App }> {
        const res = await appsApi.copy(params.appId, params.newAppName);
        return { app: res.app };
    }

    async resetAll(): Promise<void> {
        console.warn("resetAll not supported via API");
    }

    async addAppToFavorite(appId: number): Promise<{ isFavorite: boolean }> {
        const app = await appsApi.update(appId, { isFavorite: true });
        return { isFavorite: app.isFavorite };
    }

    // Files
    async readAppFile(appId: number, filePath: string): Promise<string> {
        console.log(`[WebBackend] Reading file: ${appId} / ${filePath}`);
        try {
            const res = await appsApi.readFile(appId, filePath);
            console.log(`[WebBackend] readFile response:`, res);
            if (!res) throw new Error("Response is undefined");
            return res.content;
        } catch (e) {
            console.error(`[WebBackend] readFile failed:`, e);
            throw e;
        }
    }

    async editAppFile(appId: number, filePath: string, content: string): Promise<EditAppFileReturnType> {
        await appsApi.saveFile(appId, filePath, content);
        return { success: true };
    }

    async getAppEnvVars(params: GetAppEnvVarsParams): Promise<{ key: string; value: string }[]> {
        // API needed
        return [];
    }

    async setAppEnvVars(params: SetAppEnvVarsParams): Promise<void> {
        // API needed
    }

    async getEnvVars(): Promise<Record<string, string | undefined>> {
        return {};
    }

    async selectAppFolder(): Promise<{ path: string | null; name: string | null }> {
        // Web: maybe prompt input?
        return { path: null, name: null };
    }

    async showItemInFolder(fullPath: string): Promise<void> {
        console.log("Show item:", fullPath);
    }

    // Execution
    async runApp(appId: number, onOutput: (output: AppOutput) => void): Promise<void> {
        const res = await appsApi.run(appId);

        onOutput({
            type: "info", message: "App started", appId, timestamp: Date.now()
        });

        if (res.previewUrl) {
            // Emit the magic string that useRunApp listens for to set the preview Iframe URL
            onOutput({
                type: "info",
                message: `[dyad-proxy-server]started=[${res.previewUrl}]`,
                appId,
                timestamp: Date.now()
            });
        } else {
            onOutput({ type: "info", message: "App running (no preview URL returned)", appId, timestamp: Date.now() });
        }
    }

    async stopApp(appId: number): Promise<void> {
        await appsApi.stop(appId);
    }

    async restartApp(appId: number, onOutput: (output: AppOutput) => void, removeNodeModules?: boolean): Promise<{ success: boolean }> {
        await appsApi.stop(appId);
        await appsApi.run(appId);
        return { success: true };
    }

    async respondToAppInput(params: RespondToAppInputParams): Promise<void> {
        // API needed
    }

    // Chat
    async getChat(chatId: number): Promise<Chat> {
        return chatsApi.get(chatId);
    }

    async getChats(appId?: number): Promise<ChatSummary[]> {
        const res = await chatsApi.list(appId);
        return ChatSummariesSchema.parse(res);
    }

    async searchChats(appId: number, query: string): Promise<ChatSearchResult[]> {
        const chats = await chatsApi.list(appId);
        return chats
            .filter((c: any) => c.title?.toLowerCase().includes(query.toLowerCase()))
            .map((c: any) => ({
                id: c.id,
                appId,
                title: c.title,
                createdAt: new Date(c.createdAt),
                matchedMessageContent: null
            }));
    }

    async createChat(appId: number): Promise<number> {
        const res = await chatsApi.create({ appId });
        return res.id;
    }

    async updateChat(params: UpdateChatParams): Promise<void> {
        await chatsApi.update(params.chatId, { title: params.title });
    }

    async deleteChat(chatId: number): Promise<void> {
        await chatsApi.delete(chatId);
    }

    async deleteMessages(chatId: number): Promise<void> {
        // API needed
    }

    async getChatLogs(chatId: number): Promise<ChatLogsData> {
        return { debugInfo: await this.getSystemDebugInfo(), chat: await this.getChat(chatId), codebase: "" };
    }

    // Streaming
    streamMessage(
        prompt: string,
        options: {
            selectedComponents?: ComponentSelection[];
            chatId: number;
            redo?: boolean;
            attachments?: FileAttachment[];
            onUpdate: (messages: Message[]) => void;
            onEnd: (response: ChatResponseEnd) => void;
            onError: (error: string) => void;
            onProblems?: (problems: ChatProblemsEvent) => void;
        }
    ): void {
        const { chatId, onUpdate, onEnd, onError } = options;

        // In the web client, we reconstruct the ephemeral message list for the UI
        // processing. The actual persistent history is managed by the server for next fetches.
        // We start with the user's new message.
        // FIX: We need to preserve previous messages so the UI doesn't wipe them out.
        // We'll trust the server to send the "real" history later, but for the immediate
        // optimistic update, we need the old messages.

        let existingMessages: ChatMessage[] = [];
        this.getChat(chatId).then(chat => {
            // Map existing chat messages to ChatMessage type
            if (chat && chat.messages) {
                existingMessages = chat.messages.map(m => ({
                    role: m.role as "user" | "assistant" | "system",
                    content: m.content
                }));
            }
        }).catch(err => {
            console.warn("Failed to fetch existing chat for history preservation:", err);
        });

        const messages: ChatMessage[] = [{ role: "user", content: prompt }];
        let assistantContent = "";
        let filesUpdated = false;

        const stream = createChatStream(
            chatId,
            messages,
            {
                onChunk: (chunk) => {
                    assistantContent += chunk;

                    // The UI expects the full conversation history or at least the current turn
                    // configured in a way it understands.
                    // Ideally we should have the full history, but for now we construct the 
                    // current exchange.
                    // NOTE: If the UI demands full history including previous turns, this might 
                    // look empty until refresh. However, typically the chat view appends 
                    // these updates to its existing local list.

                    const currentTurnMessages: Message[] = [
                        { role: "user", content: prompt } as Message,
                        { role: "assistant", content: assistantContent } as Message,
                    ];

                    // Combine with existing messages for the UI update
                    // We need to match the Message type which has more fields than ChatMessage
                    // but for the UI display, role and content are key.
                    const updatedMessages: Message[] = [
                        ...existingMessages as any[],
                        ...currentTurnMessages
                    ];

                    onUpdate(updatedMessages);
                },
                onFilesUpdated: (files, count) => {
                    console.log(`[WebBackend] Files updated: ${count} files`, files);
                    filesUpdated = true;
                },
                onEnd: () => {
                    onEnd({ chatId, updatedFiles: filesUpdated });
                    this.chatCancelFns.delete(chatId);
                },
                onError: (err) => {
                    onError(String(err));
                    this.chatCancelFns.delete(chatId);
                }
            }
        );

        this.chatCancelFns.set(chatId, stream.cancel);
    }

    cancelChatStream(chatId: number): void {
        const cancel = this.chatCancelFns.get(chatId);
        if (cancel) {
            cancel();
            this.chatCancelFns.delete(chatId);
        }
    }

    // Stubs for the rest (implement as needed)
    async addDependency(): Promise<void> { }
    async countTokens(params: TokenCountParams): Promise<TokenCountResult> {
        return { estimatedTotalTokens: 0, actualMaxTokens: 0, messageHistoryTokens: 0, codebaseTokens: 0, mentionedAppsTokens: 0, inputTokens: 0, systemPromptTokens: 0, contextWindow: 0 };
    }
    async getChatContextResults(): Promise<ContextPathResults> { return { files: [], symbols: [] }; }
    async setChatContext(): Promise<void> { }

    async getUserSettings(): Promise<UserSettings> {
        return settingsApi.get();
    }
    async setUserSettings(settings: Partial<UserSettings>): Promise<UserSettings> {
        return settingsApi.update(settings);
    }
    async getUserBudget(): Promise<UserBudgetInfo | null> { return null; }
    async clearSessionData(): Promise<void> { }

    async listVersions(): Promise<Version[]> { return []; }
    async revertVersion(params: RevertVersionParams): Promise<RevertVersionResponse> { return { warningMessage: "Not supported" }; }
    async checkoutVersion(): Promise<void> { }
    async getCurrentBranch(appId: number): Promise<BranchResult> { return { branch: "main", exists: true }; }
    async renameBranch(): Promise<void> { }

    startGithubDeviceFlow(): void { }
    onGithubDeviceFlowUpdate(): () => void { return () => { }; }
    onGithubDeviceFlowSuccess(): () => void { return () => { }; }
    onGithubDeviceFlowError(): () => void { return () => { }; }

    async listGithubRepos(): Promise<{ name: string; full_name: string; private: boolean }[]> {
        return githubApi.listRepos();
    }

    async getGithubRepoBranches(owner: string, repo: string): Promise<any[]> {
        return githubApi.getBranches(owner, repo);
    }

    async connectToExistingGithubRepo(owner: string, repo: string, branch: string, appId: number): Promise<void> {
        await githubApi.link(appId, owner, repo, branch);
    }

    async checkGithubRepoAvailable(org: string, repo: string): Promise<any> {
        // This is tricky as we need to check if we can access it; listRepos filtering might be enough or try to fetch it
        const repos = await this.listGithubRepos();
        const exists = repos.some(r => r.name === repo && (!org || r.full_name.startsWith(org)));
        return { available: exists };
    }

    async createGithubRepo(org: string, repo: string, appId: number, branch?: string): Promise<void> {
        await githubApi.createRepo(repo, org);
        await githubApi.link(appId, org, repo, branch || "main"); // Assuming link is desired
    }

    async syncGithubRepo(appId: number, force?: boolean): Promise<{ success: boolean; error?: string }> {
        return githubApi.push(appId, force);
    }

    async disconnectGithubRepo(appId: number): Promise<void> {
        await githubApi.unlink(appId);
    }

    async cloneRepoFromUrl(params: CloneRepoParams): Promise<{ app: App; hasAiRules: boolean } | { error: string }> {
        // For now, clone from URL is not fully implemented in web version
        // Users should use GitHub integration instead
        return {
            error: "Clone from URL is not available in the web version. Please use the GitHub integration in Settings to connect your account and clone repositories."
        };
    }

    async saveVercelAccessToken(): Promise<void> { }
    async listVercelProjects(): Promise<VercelProject[]> { return []; }
    async connectToExistingVercelProject(): Promise<void> { }
    async isVercelProjectAvailable(): Promise<IsVercelProjectAvailableResponse> { return { available: false }; }
    async createVercelProject(): Promise<void> { }
    async getVercelDeployments(): Promise<VercelDeployment[]> { return []; }
    async disconnectVercelProject(): Promise<void> { }

    async getAppVersion(): Promise<string> { return "1.0.0-web"; }
    async openExternalUrl(url: string): Promise<void> { window.open(url, "_blank"); }
    async uploadToSignedUrl(): Promise<void> { }
    async listLocalOllamaModels(): Promise<LocalModel[]> { return []; }
    async listLocalLMStudioModels(): Promise<LocalModel[]> { return []; }
    onDeepLinkReceived(): () => void { return () => { }; }

    async minimizeWindow(): Promise<void> { }
    async maximizeWindow(): Promise<void> { }
    async closeWindow(): Promise<void> { }
    async takeScreenshot(): Promise<void> { }

    async checkAiRules(): Promise<{ exists: boolean }> { return { exists: false }; }
    async getLatestSecurityReview(): Promise<SecurityReviewResult> { return { riskScore: 0, issues: [] }; }
    async importApp(): Promise<ImportAppResult> { throw new Error("Not supported"); }
    async checkAppName(): Promise<{ exists: boolean }> { return { exists: false }; }
    async getAppUpgrades(): Promise<AppUpgrade[]> { return []; }
    async executeAppUpgrade(): Promise<void> { }

    async isCapacitor(): Promise<boolean> { return false; }
    async syncCapacitor(): Promise<void> { }
    async openIos(): Promise<void> { }
    async openAndroid(): Promise<void> { }
    async checkProblems(): Promise<ProblemReport> { return { missingEnvVars: [], missingFiles: [] }; }

    async getTemplates(): Promise<Template[]> {
        try {
            return await templatesApi.list();
        } catch (error) {
            console.error("Failed to fetch templates:", error);
            // Fallback (or re-throw)? returning [] allows app to run but hub is empty.
            // Client.ts throws on error, so this catch handles API failure.
            return [];
        }
    }

    // Prompts
    async listPrompts(): Promise<PromptDto[]> {
        return promptsApi.list();
    }

    async createPrompt(params: CreatePromptParamsDto): Promise<PromptDto> {
        return promptsApi.create(params);
    }

    async updatePrompt(params: UpdatePromptParamsDto): Promise<void> {
        await promptsApi.update(params.id, {
            title: params.title,
            content: params.content,
            description: params.description
        });
    }

    async deletePrompt(id: number): Promise<void> {
        await promptsApi.delete(id);
    }

    async selectNodeFolder(): Promise<SelectNodeFolderResult> { return { path: null, selectedPath: null }; }
    async getNodePath(): Promise<string | null> { return null; }
    async getNodejsStatus(): Promise<NodeSystemInfo> { return { nodeVersion: "n/a", pnpmVersion: "n/a", nodeDownloadUrl: "" }; }

    startHelpChat(): void { }
    cancelHelpChat(): void { }

    async getProposal(): Promise<ProposalResult | null> { return null; }
    async approveProposal(): Promise<ApproveProposalResult> { return {}; }
    async rejectProposal(): Promise<void> { }

    async doesReleaseNoteExist(): Promise<{ exists: boolean }> { return { exists: false }; }
    async getLanguageModelProviders(): Promise<LanguageModelProvider[]> {
        // Return hardcoded cloud providers (matching language_model_helpers.ts logic)
        const hardcodedProviders: LanguageModelProvider[] = [];
        for (const providerKey in CLOUD_PROVIDERS) {
            if (Object.prototype.hasOwnProperty.call(CLOUD_PROVIDERS, providerKey)) {
                const key = providerKey as keyof typeof CLOUD_PROVIDERS;
                const providerDetails = CLOUD_PROVIDERS[key];
                if (providerDetails) {
                    hardcodedProviders.push({
                        id: key,
                        name: providerDetails.displayName,
                        hasFreeTier: providerDetails.hasFreeTier,
                        websiteUrl: providerDetails.websiteUrl,
                        gatewayPrefix: providerDetails.gatewayPrefix,
                        secondary: providerDetails.secondary,
                        envVarName: PROVIDER_TO_ENV_VAR[key] ?? undefined,
                        type: "cloud",
                    });
                }
            }
        }

        for (const providerKey in LOCAL_PROVIDERS) {
            if (Object.prototype.hasOwnProperty.call(LOCAL_PROVIDERS, providerKey)) {
                const key = providerKey as keyof typeof LOCAL_PROVIDERS;
                const providerDetails = LOCAL_PROVIDERS[key];
                hardcodedProviders.push({
                    id: key,
                    name: providerDetails.displayName,
                    hasFreeTier: providerDetails.hasFreeTier,
                    type: "local",
                });
            }
        }

        // Fetch custom providers from API
        try {
            const { providersApi } = await import("@/api/client");
            const customProvidersResponse = await providersApi.list();

            const customProviders: LanguageModelProvider[] = customProvidersResponse.map((provider: any) => ({
                id: provider.id,
                name: provider.name,
                type: "custom",
                envVarName: provider.env_var_name || undefined,
            }));

            return [...hardcodedProviders, ...customProviders];
        } catch (error) {
            console.error("Failed to fetch custom providers:", error);
            // Return hardcoded providers even if custom providers fail to load
            return hardcodedProviders;
        }
    }

    async getLanguageModels(params: { providerId: string }): Promise<LanguageModel[]> {
        const { providerId } = params;
        if (!providerId) return [];

        let hardcodedModels: LanguageModel[] = [];
        if (providerId in MODEL_OPTIONS) {
            const models = MODEL_OPTIONS[providerId] || [];
            hardcodedModels = models.map((model) => ({
                ...model,
                apiName: model.name,
                type: "cloud",
            }));
        }

        // TODO: Fetch custom models from API
        return hardcodedModels;
    }

    async getLanguageModelsByProviders(): Promise<Record<string, LanguageModel[]>> {
        const providers = await this.getLanguageModelProviders();
        const record: Record<string, LanguageModel[]> = {};
        for (const provider of providers) {
            if (provider.type !== 'local') {
                record[provider.id] = await this.getLanguageModels({ providerId: provider.id });
            }
        }
        return record;
    }
    async createCustomLanguageModelProvider(params: CreateCustomLanguageModelProviderParams): Promise<LanguageModelProvider> {
        const { id, name, apiBaseUrl, envVarName } = params;

        // Import providersApi dynamically to avoid circular dependency
        const { providersApi } = await import("@/api/client");

        const provider = await providersApi.create({
            id,
            name,
            apiBaseUrl,
            envVarName,
        });

        return {
            id: provider.id,
            name: provider.name,
            type: "custom",
            envVarName: provider.env_var_name,
        };
    }
    async editCustomLanguageModelProvider(params: CreateCustomLanguageModelProviderParams): Promise<LanguageModelProvider> {
        const { id, name, apiBaseUrl, envVarName } = params;

        const { providersApi } = await import("@/api/client");

        const provider = await providersApi.update(id, {
            name,
            apiBaseUrl,
            envVarName,
        });

        return {
            id: provider.id,
            name: provider.name,
            type: "custom",
            envVarName: provider.env_var_name,
        };
    }
    async createCustomLanguageModel(): Promise<void> { }
    async deleteCustomLanguageModel(): Promise<void> { }
    async deleteCustomModel(): Promise<void> { }
    async deleteCustomLanguageModelProvider(): Promise<void> { }
    async portalMigrateCreate(): Promise<{ output: string }> { return { output: "" }; }

    // MCP
    async listMcpServers() { return mcpApi.listServers(); }
    async createMcpServer(params: CreateMcpServer) { return mcpApi.createServer(params); }
    async updateMcpServer(params: McpServerUpdate) { return mcpApi.updateServer(params.id, params); }
    async deleteMcpServer(id: number) { return mcpApi.deleteServer(id); }
    async listMcpTools(serverId: number) { return []; }
    async getMcpToolConsents() { return []; }
    async setMcpToolConsent(params: any) { return mcpApi.setConsent(params.serverId, params.toolName, params.consent); }
    onMcpToolConsentRequest(): () => void { return () => { }; }
    respondToMcpConsentRequest(): void { }

    async listSupabaseProjects() { return []; }
    async listSupabaseBranches() { return []; }
    async setSupabaseAppProject() { }
    async unsetSupabaseAppProject() { }
    async fakeHandleSupabaseConnect() { }
    async fakeHandleNeonConnect() { }
    async createNeonProject(params: CreateNeonProjectParams): Promise<NeonProject> { throw new Error("Not supported"); }
    async getNeonProject(params: GetNeonProjectParams): Promise<GetNeonProjectResponse> { throw new Error("Not supported"); }
}


import type { IBackendClient } from "./backend_interface";
import {
    appsApi,
    chatsApi,
    settingsApi,
    mcpApi,
    createChatStream,
    ChatMessage,
    StreamCallbacks
} from "@/api/client";
import {
    ChatSummariesSchema,
    ChatSearchResultsSchema,
    AppSearchResultsSchema,
} from "../lib/schemas";
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
        throw new Error("copyApp not implemented in web");
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
        const res = await appsApi.readFile(appId, filePath);
        return res.content;
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
        await appsApi.run(appId);
        // TODO: Connect to output stream (WebSocket/SSE)
        onOutput({ type: "info", message: "App started (output streaming pending impl)", appId, timestamp: Date.now() });
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
        // API needed
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
        // Adapt to api/client createChatStream
        // We need to convert prompt to messages... actually api/client takes messages[]
        // But IpcClient usually manages history? 
        // Wait, createChatStream in api/client expects "messages". 
        // The IPC contract sends "prompt" and "chatId", and the backend figures out the context.

        // For now, we will assume we send just the user message as a start
        const messages: ChatMessage[] = [{ role: "user", content: prompt }];

        // We need to fetch history if we want full context, OR the backend handles it by chatId.
        // The `createChatStream` in `api/client.ts` sends `chatId` AND `messages`.
        // If we pass `chatId`, the backend should append `messages` to history.

        const callbacks: StreamCallbacks = {
            onChunk: (content) => {
                // This is partial content. 
                // IpcClient expects full message updates `onUpdate(messages[])`.
                // We need to accumulate locally or fetching updated messages.
                // Actually Electron IPC sends `messages: Message[]` (full history) on every chunk? 
                // Or just the updated last message?
                // Looking at ElectronBackend: `callbacks.onUpdate(messages)`

                // This is a discrepancy. Electron sends full message list updates. Web socket sends chunks.
                // We need to reconstruct the message list.
                // For 100% compatibility, `WebBackend` should probably maintain state or the API should return full messages.

                // HACK: for now, we just call onUpdate with a constructed message. 
                // Real fix: Update API to send full messages or fetch history.
            },
            onEnd: () => options.onEnd({ chatId: options.chatId, updatedFiles: false }),
            onError: (err) => options.onError(err)
        };

        const stream = createChatStream(options.chatId, messages, callbacks);
        this.chatCancelFns.set(options.chatId, stream.cancel);
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

    async listGithubRepos(): Promise<any[]> { return []; }
    async getGithubRepoBranches(): Promise<any[]> { return []; }
    async connectToExistingGithubRepo(): Promise<void> { }
    async checkGithubRepoAvailable(): Promise<any> { return { available: false }; }
    async createGithubRepo(): Promise<void> { }
    async syncGithubRepo(): Promise<any> { return { success: false }; }
    async disconnectGithubRepo(): Promise<void> { }
    async cloneRepoFromUrl(): Promise<any> { return { error: "Not supported" }; }

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

    async getTemplates(): Promise<Template[]> { return []; }
    async listPrompts(): Promise<PromptDto[]> { return []; }
    async createPrompt(params: CreatePromptParamsDto): Promise<PromptDto> { throw new Error("Not supported"); }
    async updatePrompt(): Promise<void> { }
    async deletePrompt(): Promise<void> { }

    async selectNodeFolder(): Promise<SelectNodeFolderResult> { return { path: null, selectedPath: null }; }
    async getNodePath(): Promise<string | null> { return null; }
    async getNodejsStatus(): Promise<NodeSystemInfo> { return { nodeVersion: "n/a", pnpmVersion: "n/a", nodeDownloadUrl: "" }; }

    startHelpChat(): void { }
    cancelHelpChat(): void { }

    async getProposal(): Promise<ProposalResult | null> { return null; }
    async approveProposal(): Promise<ApproveProposalResult> { return {}; }
    async rejectProposal(): Promise<void> { }

    async doesReleaseNoteExist(): Promise<{ exists: boolean }> { return { exists: false }; }
    async getLanguageModelProviders(): Promise<LanguageModelProvider[]> { return []; }
    async getLanguageModels(): Promise<LanguageModel[]> { return []; }
    async getLanguageModelsByProviders(): Promise<Record<string, LanguageModel[]>> { return {}; }
    async createCustomLanguageModelProvider(): Promise<LanguageModelProvider> { throw new Error("Not supported"); }
    async editCustomLanguageModelProvider(): Promise<LanguageModelProvider> { throw new Error("Not supported"); }
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

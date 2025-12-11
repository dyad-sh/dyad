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
    ChatStreamParams,
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
} from "./ipc_types";
import { Message } from "./ipc_types";
import { ChatProblemsEvent } from "./ipc_types";

export interface IBackendClient {
    // Core System
    restartDyad(): Promise<void>;
    reloadEnvPath(): Promise<void>;
    getSystemDebugInfo(): Promise<SystemDebugInfo>;
    getSystemPlatform(): Promise<string>;

    // Apps
    createApp(params: CreateAppParams): Promise<CreateAppResult>;
    getApp(appId: number): Promise<App>;
    listApps(): Promise<ListAppsResponse>;
    searchApps(searchQuery: string): Promise<AppSearchResult[]>;
    deleteApp(appId: number): Promise<void>;
    renameApp(params: { appId: number; appName: string; appPath: string }): Promise<void>;
    copyApp(params: CopyAppParams): Promise<{ app: App }>;
    resetAll(): Promise<void>;
    addAppToFavorite(appId: number): Promise<{ isFavorite: boolean }>;

    // App Files & Env
    readAppFile(appId: number, filePath: string): Promise<string>;
    editAppFile(appId: number, filePath: string, content: string): Promise<EditAppFileReturnType>;
    getAppEnvVars(params: GetAppEnvVarsParams): Promise<{ key: string; value: string }[]>;
    setAppEnvVars(params: SetAppEnvVarsParams): Promise<void>;
    getEnvVars(): Promise<Record<string, string | undefined>>;
    selectAppFolder(): Promise<{ path: string | null; name: string | null }>;
    showItemInFolder(fullPath: string): Promise<void>;

    // App Execution
    runApp(appId: number, onOutput: (output: AppOutput) => void): Promise<void>;
    stopApp(appId: number): Promise<void>;
    restartApp(appId: number, onOutput: (output: AppOutput) => void, removeNodeModules?: boolean): Promise<{ success: boolean }>;
    respondToAppInput(params: RespondToAppInputParams): Promise<void>;

    // Chat
    getChat(chatId: number): Promise<Chat>;
    getChats(appId?: number): Promise<ChatSummary[]>;
    searchChats(appId: number, query: string): Promise<ChatSearchResult[]>;
    createChat(appId: number): Promise<number>;
    updateChat(params: UpdateChatParams): Promise<void>;
    deleteChat(chatId: number): Promise<void>;
    deleteMessages(chatId: number): Promise<void>;
    getChatLogs(chatId: number): Promise<ChatLogsData>;

    // Chat Streaming
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
    ): void;
    cancelChatStream(chatId: number): void;

    // Context & Tokens
    addDependency(params: { chatId: number; packages: string[] }): Promise<void>;
    countTokens(params: TokenCountParams): Promise<TokenCountResult>;
    getChatContextResults(params: { appId: number }): Promise<ContextPathResults>;
    setChatContext(params: { appId: number; chatContext: any }): Promise<void>;

    // User Settings
    getUserSettings(): Promise<UserSettings>;
    setUserSettings(settings: Partial<UserSettings>): Promise<UserSettings>;
    getUserBudget(): Promise<UserBudgetInfo | null>;
    clearSessionData(): Promise<void>;

    // Git / Versions
    listVersions(params: { appId: number }): Promise<Version[]>;
    revertVersion(params: RevertVersionParams): Promise<RevertVersionResponse>;
    checkoutVersion(params: { appId: number; versionId: string }): Promise<void>;
    getCurrentBranch(appId: number): Promise<BranchResult>;
    renameBranch(params: RenameBranchParams): Promise<void>;

    // GitHub Integration
    startGithubDeviceFlow(appId: number | null): void;
    onGithubDeviceFlowUpdate(callback: (data: GitHubDeviceFlowUpdateData) => void): () => void;
    onGithubDeviceFlowSuccess(callback: (data: GitHubDeviceFlowSuccessData) => void): () => void;
    onGithubDeviceFlowError(callback: (data: GitHubDeviceFlowErrorData) => void): () => void;
    listGithubRepos(): Promise<{ name: string; full_name: string; private: boolean }[]>;
    getGithubRepoBranches(owner: string, repo: string): Promise<{ name: string; commit: { sha: string } }[]>;
    connectToExistingGithubRepo(owner: string, repo: string, branch: string, appId: number): Promise<void>;
    checkGithubRepoAvailable(org: string, repo: string): Promise<{ available: boolean; error?: string }>;
    createGithubRepo(org: string, repo: string, appId: number, branch?: string): Promise<void>;
    syncGithubRepo(appId: number, force?: boolean): Promise<{ success: boolean; error?: string }>;
    disconnectGithubRepo(appId: number): Promise<void>;
    cloneRepoFromUrl(params: CloneRepoParams): Promise<{ app: App; hasAiRules: boolean } | { error: string }>;

    // Vercel
    saveVercelAccessToken(params: SaveVercelAccessTokenParams): Promise<void>;
    listVercelProjects(): Promise<VercelProject[]>;
    connectToExistingVercelProject(params: ConnectToExistingVercelProjectParams): Promise<void>;
    isVercelProjectAvailable(params: IsVercelProjectAvailableParams): Promise<IsVercelProjectAvailableResponse>;
    createVercelProject(params: CreateVercelProjectParams): Promise<void>;
    getVercelDeployments(params: GetVercelDeploymentsParams): Promise<VercelDeployment[]>;
    disconnectVercelProject(params: DisconnectVercelProjectParams): Promise<void>;

    // MCP
    listMcpServers(): Promise<any>;
    createMcpServer(params: CreateMcpServer): Promise<any>;
    updateMcpServer(params: McpServerUpdate): Promise<any>;
    deleteMcpServer(id: number): Promise<any>;
    listMcpTools(serverId: number): Promise<any>;
    getMcpToolConsents(): Promise<any>;
    setMcpToolConsent(params: { serverId: number; toolName: string; consent: "ask" | "always" | "denied" }): Promise<any>;
    onMcpToolConsentRequest(handler: (payload: any) => void): () => void;
    respondToMcpConsentRequest(requestId: string, decision: "accept-once" | "accept-always" | "decline"): void;

    // Supabase / Neon
    listSupabaseProjects(): Promise<any[]>;
    listSupabaseBranches(params: { projectId: string }): Promise<SupabaseBranch[]>;
    setSupabaseAppProject(params: SetSupabaseAppProjectParams): Promise<void>;
    unsetSupabaseAppProject(app: number): Promise<void>;
    fakeHandleSupabaseConnect(params: { appId: number; fakeProjectId: string }): Promise<void>;
    fakeHandleNeonConnect(): Promise<void>;
    createNeonProject(params: CreateNeonProjectParams): Promise<NeonProject>;
    getNeonProject(params: GetNeonProjectParams): Promise<GetNeonProjectResponse>;

    // Misc
    getAppVersion(): Promise<string>;
    openExternalUrl(url: string): Promise<void>;
    uploadToSignedUrl(url: string, contentType: string, data: any): Promise<void>;
    listLocalOllamaModels(): Promise<LocalModel[]>;
    listLocalLMStudioModels(): Promise<LocalModel[]>;
    onDeepLinkReceived(callback: (data: DeepLinkData) => void): () => void;

    // Window
    minimizeWindow(): Promise<void>;
    maximizeWindow(): Promise<void>;
    closeWindow(): Promise<void>;
    takeScreenshot(): Promise<void>;

    // Security / Updates
    checkAiRules(params: { path: string }): Promise<{ exists: boolean }>;
    getLatestSecurityReview(appId: number): Promise<SecurityReviewResult>;
    importApp(params: ImportAppParams): Promise<ImportAppResult>;
    checkAppName(params: { appName: string }): Promise<{ exists: boolean }>;
    getAppUpgrades(params: { appId: number }): Promise<AppUpgrade[]>;
    executeAppUpgrade(params: { appId: number; upgradeId: string }): Promise<void>;

    // Capacitor
    isCapacitor(params: { appId: number }): Promise<boolean>;
    syncCapacitor(params: { appId: number }): Promise<void>;
    openIos(params: { appId: number }): Promise<void>;
    openAndroid(params: { appId: number }): Promise<void>;
    checkProblems(params: { appId: number }): Promise<ProblemReport>;

    // Templates & Prompts
    getTemplates(): Promise<Template[]>;
    listPrompts(): Promise<PromptDto[]>;
    createPrompt(params: CreatePromptParamsDto): Promise<PromptDto>;
    updatePrompt(params: UpdatePromptParamsDto): Promise<void>;
    deletePrompt(id: number): Promise<void>;

    // Node
    selectNodeFolder(): Promise<SelectNodeFolderResult>;
    getNodePath(): Promise<string | null>;
    getNodejsStatus(): Promise<NodeSystemInfo>;

    // Help Bot
    startHelpChat(sessionId: string, message: string, options: any): void;
    cancelHelpChat(sessionId: string): void;

    // Proposals
    getProposal(chatId: number): Promise<ProposalResult | null>;
    approveProposal(params: { chatId: number; messageId: number }): Promise<ApproveProposalResult>;
    rejectProposal(params: { chatId: number; messageId: number }): Promise<void>;

    // Language Models
    doesReleaseNoteExist(params: DoesReleaseNoteExistParams): Promise<{ exists: boolean; url?: string }>;
    getLanguageModelProviders(): Promise<LanguageModelProvider[]>;
    getLanguageModels(params: { providerId: string }): Promise<LanguageModel[]>;
    getLanguageModelsByProviders(): Promise<Record<string, LanguageModel[]>>;
    createCustomLanguageModelProvider(params: CreateCustomLanguageModelProviderParams): Promise<LanguageModelProvider>;
    editCustomLanguageModelProvider(params: CreateCustomLanguageModelProviderParams): Promise<LanguageModelProvider>;
    createCustomLanguageModel(params: CreateCustomLanguageModelParams): Promise<void>;
    deleteCustomLanguageModel(modelId: string): Promise<void>;
    deleteCustomModel(params: { providerId: string; modelApiName: string }): Promise<void>;
    deleteCustomLanguageModelProvider(providerId: string): Promise<void>;

    // Portal
    portalMigrateCreate(params: { appId: number }): Promise<{ output: string }>;
}

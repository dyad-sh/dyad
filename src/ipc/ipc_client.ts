import type { IBackendClient } from "./backend_interface";
import { ElectronBackend } from "./electron_backend";
import { WebBackend } from "./web_backend";
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

export class IpcClient implements IBackendClient {
  private static instance: IpcClient;
  private backend: IBackendClient;

  private constructor() {
    if ((window as any).electron) {
      this.backend = new ElectronBackend();
      console.log("IpcClient: Initialized with ElectronBackend");
    } else {
      this.backend = new WebBackend();
      console.log("IpcClient: Initialized with WebBackend");
    }
  }

  public static getInstance(): IpcClient {
    if (!IpcClient.instance) {
      IpcClient.instance = new IpcClient();
    }
    return IpcClient.instance;
  }

  // --- Delegation ---

  public restartDyad() { return this.backend.restartDyad(); }
  public reloadEnvPath() { return this.backend.reloadEnvPath(); }
  public getSystemDebugInfo() { return this.backend.getSystemDebugInfo(); }
  public getSystemPlatform() { return this.backend.getSystemPlatform(); }

  public createApp(params: CreateAppParams) { return this.backend.createApp(params); }
  public getApp(appId: number) { return this.backend.getApp(appId); }
  public listApps() { return this.backend.listApps(); }
  public searchApps(searchQuery: string) { return this.backend.searchApps(searchQuery); }
  public deleteApp(appId: number) { return this.backend.deleteApp(appId); }
  public renameApp(params: any) { return this.backend.renameApp(params); }
  public copyApp(params: CopyAppParams) { return this.backend.copyApp(params); }
  public resetAll() { return this.backend.resetAll(); }
  public addAppToFavorite(appId: number) { return this.backend.addAppToFavorite(appId); }

  public readAppFile(appId: number, filePath: string) { return this.backend.readAppFile(appId, filePath); }
  public editAppFile(appId: number, filePath: string, content: string) { return this.backend.editAppFile(appId, filePath, content); }
  public getAppEnvVars(params: GetAppEnvVarsParams) { return this.backend.getAppEnvVars(params); }
  public setAppEnvVars(params: SetAppEnvVarsParams) { return this.backend.setAppEnvVars(params); }
  public getEnvVars() { return this.backend.getEnvVars(); }
  public selectAppFolder() { return this.backend.selectAppFolder(); }
  public showItemInFolder(fullPath: string) { return this.backend.showItemInFolder(fullPath); }

  public runApp(appId: number, onOutput: (output: AppOutput) => void) { return this.backend.runApp(appId, onOutput); }
  public stopApp(appId: number) { return this.backend.stopApp(appId); }
  public restartApp(appId: number, onOutput: (output: AppOutput) => void, removeNodeModules?: boolean) { return this.backend.restartApp(appId, onOutput, removeNodeModules); }
  public respondToAppInput(params: RespondToAppInputParams) { return this.backend.respondToAppInput(params); }

  public getChat(chatId: number) { return this.backend.getChat(chatId); }
  public getChats(appId?: number) { return this.backend.getChats(appId); }
  public searchChats(appId: number, query: string) { return this.backend.searchChats(appId, query); }
  public createChat(appId: number) { return this.backend.createChat(appId); }
  public updateChat(params: UpdateChatParams) { return this.backend.updateChat(params); }
  public deleteChat(chatId: number) { return this.backend.deleteChat(chatId); }
  public deleteMessages(chatId: number) { return this.backend.deleteMessages(chatId); }
  public getChatLogs(chatId: number) { return this.backend.getChatLogs(chatId); }

  public streamMessage(prompt: string, options: any) { return this.backend.streamMessage(prompt, options); }
  public cancelChatStream(chatId: number) { return this.backend.cancelChatStream(chatId); }

  public addDependency(params: any) { return this.backend.addDependency(params); }
  public countTokens(params: TokenCountParams) { return this.backend.countTokens(params); }
  public getChatContextResults(params: any) { return this.backend.getChatContextResults(params); }
  public setChatContext(params: any) { return this.backend.setChatContext(params); }

  public getUserSettings() { return this.backend.getUserSettings(); }
  public setUserSettings(settings: Partial<UserSettings>) { return this.backend.setUserSettings(settings); }
  public getUserBudget() { return this.backend.getUserBudget(); }
  public clearSessionData() { return this.backend.clearSessionData(); }

  public listVersions(params: any) { return this.backend.listVersions(params); }
  public revertVersion(params: RevertVersionParams) { return this.backend.revertVersion(params); }
  public checkoutVersion(params: any) { return this.backend.checkoutVersion(params); }
  public getCurrentBranch(appId: number) { return this.backend.getCurrentBranch(appId); }
  public renameBranch(params: RenameBranchParams) { return this.backend.renameBranch(params); }

  public startGithubDeviceFlow(appId: number | null) { return this.backend.startGithubDeviceFlow(appId); }
  public onGithubDeviceFlowUpdate(cb: any) { return this.backend.onGithubDeviceFlowUpdate(cb); }
  public onGithubDeviceFlowSuccess(cb: any) { return this.backend.onGithubDeviceFlowSuccess(cb); }
  public onGithubDeviceFlowError(cb: any) { return this.backend.onGithubDeviceFlowError(cb); }
  public listGithubRepos() { return this.backend.listGithubRepos(); }
  public getGithubRepoBranches(owner: string, repo: string) { return this.backend.getGithubRepoBranches(owner, repo); }
  public connectToExistingGithubRepo(owner: string, repo: string, branch: string, appId: number) { return this.backend.connectToExistingGithubRepo(owner, repo, branch, appId); }
  public checkGithubRepoAvailable(org: string, repo: string) { return this.backend.checkGithubRepoAvailable(org, repo); }
  public createGithubRepo(org: string, repo: string, appId: number, branch?: string) { return this.backend.createGithubRepo(org, repo, appId, branch); }
  public syncGithubRepo(appId: number, force?: boolean) { return this.backend.syncGithubRepo(appId, force); }
  public disconnectGithubRepo(appId: number) { return this.backend.disconnectGithubRepo(appId); }
  public cloneRepoFromUrl(params: CloneRepoParams) { return this.backend.cloneRepoFromUrl(params); }

  public saveVercelAccessToken(params: SaveVercelAccessTokenParams) { return this.backend.saveVercelAccessToken(params); }
  public listVercelProjects() { return this.backend.listVercelProjects(); }
  public connectToExistingVercelProject(params: ConnectToExistingVercelProjectParams) { return this.backend.connectToExistingVercelProject(params); }
  public isVercelProjectAvailable(params: IsVercelProjectAvailableParams) { return this.backend.isVercelProjectAvailable(params); }
  public createVercelProject(params: CreateVercelProjectParams) { return this.backend.createVercelProject(params); }
  public getVercelDeployments(params: GetVercelDeploymentsParams) { return this.backend.getVercelDeployments(params); }
  public disconnectVercelProject(params: DisconnectVercelProjectParams) { return this.backend.disconnectVercelProject(params); }

  public listMcpServers() { return this.backend.listMcpServers(); }
  public createMcpServer(params: CreateMcpServer) { return this.backend.createMcpServer(params); }
  public updateMcpServer(params: McpServerUpdate) { return this.backend.updateMcpServer(params); }
  public deleteMcpServer(id: number) { return this.backend.deleteMcpServer(id); }
  public listMcpTools(serverId: number) { return this.backend.listMcpTools(serverId); }
  public getMcpToolConsents() { return this.backend.getMcpToolConsents(); }
  public setMcpToolConsent(params: any) { return this.backend.setMcpToolConsent(params); }
  public onMcpToolConsentRequest(handler: any) { return this.backend.onMcpToolConsentRequest(handler); }
  public respondToMcpConsentRequest(reqId: string, decision: any) { return this.backend.respondToMcpConsentRequest(reqId, decision); }

  public listSupabaseProjects() { return this.backend.listSupabaseProjects(); }
  public listSupabaseBranches(params: any) { return this.backend.listSupabaseBranches(params); }
  public setSupabaseAppProject(params: any) { return this.backend.setSupabaseAppProject(params); }
  public unsetSupabaseAppProject(app: number) { return this.backend.unsetSupabaseAppProject(app); }
  public fakeHandleSupabaseConnect(params: any) { return this.backend.fakeHandleSupabaseConnect(params); }
  public fakeHandleNeonConnect() { return this.backend.fakeHandleNeonConnect(); }
  public createNeonProject(params: any) { return this.backend.createNeonProject(params); }
  public getNeonProject(params: any) { return this.backend.getNeonProject(params); }

  public getAppVersion() { return this.backend.getAppVersion(); }
  public openExternalUrl(url: string) { return this.backend.openExternalUrl(url); }
  public uploadToSignedUrl(url: string, contentType: string, data: any) { return this.backend.uploadToSignedUrl(url, contentType, data); }
  public listLocalOllamaModels() { return this.backend.listLocalOllamaModels(); }
  public listLocalLMStudioModels() { return this.backend.listLocalLMStudioModels(); }
  public onDeepLinkReceived(cb: any) { return this.backend.onDeepLinkReceived(cb); }

  public minimizeWindow() { return this.backend.minimizeWindow(); }
  public maximizeWindow() { return this.backend.maximizeWindow(); }
  public closeWindow() { return this.backend.closeWindow(); }
  public takeScreenshot() { return this.backend.takeScreenshot(); }

  public checkAiRules(params: any) { return this.backend.checkAiRules(params); }
  public getLatestSecurityReview(appId: number) { return this.backend.getLatestSecurityReview(appId); }
  public importApp(params: ImportAppParams) { return this.backend.importApp(params); }
  public checkAppName(params: any) { return this.backend.checkAppName(params); }
  public getAppUpgrades(params: any) { return this.backend.getAppUpgrades(params); }
  public executeAppUpgrade(params: any) { return this.backend.executeAppUpgrade(params); }

  public isCapacitor(params: any) { return this.backend.isCapacitor(params); }
  public syncCapacitor(params: any) { return this.backend.syncCapacitor(params); }
  public openIos(params: any) { return this.backend.openIos(params); }
  public openAndroid(params: any) { return this.backend.openAndroid(params); }
  public checkProblems(params: any) { return this.backend.checkProblems(params); }

  public getTemplates() { return this.backend.getTemplates(); }
  public listPrompts() { return this.backend.listPrompts(); }
  public createPrompt(params: any) { return this.backend.createPrompt(params); }
  public updatePrompt(params: any) { return this.backend.updatePrompt(params); }
  public deletePrompt(id: number) { return this.backend.deletePrompt(id); }

  public selectNodeFolder() { return this.backend.selectNodeFolder(); }
  public getNodePath() { return this.backend.getNodePath(); }
  public getNodejsStatus() { return this.backend.getNodejsStatus(); }

  public startHelpChat(sessionId: string, message: string, options: any) { return this.backend.startHelpChat(sessionId, message, options); }
  public cancelHelpChat(sessionId: string) { return this.backend.cancelHelpChat(sessionId); }

  public getProposal(chatId: number) { return this.backend.getProposal(chatId); }
  public approveProposal(params: any) { return this.backend.approveProposal(params); }
  public rejectProposal(params: any) { return this.backend.rejectProposal(params); }

  public doesReleaseNoteExist(params: any) { return this.backend.doesReleaseNoteExist(params); }
  public getLanguageModelProviders() { return this.backend.getLanguageModelProviders(); }
  public getLanguageModels(params: any) { return this.backend.getLanguageModels(params); }
  public getLanguageModelsByProviders() { return this.backend.getLanguageModelsByProviders(); }
  public createCustomLanguageModelProvider(params: any) { return this.backend.createCustomLanguageModelProvider(params); }
  public editCustomLanguageModelProvider(params: any) { return this.backend.editCustomLanguageModelProvider(params); }
  public createCustomLanguageModel(params: any) { return this.backend.createCustomLanguageModel(params); }
  public deleteCustomLanguageModel(modelId: string) { return this.backend.deleteCustomLanguageModel(modelId); }
  public deleteCustomModel(params: any) { return this.backend.deleteCustomModel(params); }
  public deleteCustomLanguageModelProvider(providerId: string) { return this.backend.deleteCustomLanguageModelProvider(providerId); }
  public portalMigrateCreate(params: any) { return this.backend.portalMigrateCreate(params); }
}

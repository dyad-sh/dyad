import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// App Schemas
// =============================================================================

/**
 * Base app schema with fields from the database.
 * These are the core fields stored in the apps table.
 */
export const AppBaseSchema = z.object({
  id: z.number(),
  name: z.string(),
  path: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  githubOrg: z.string().nullable(),
  githubRepo: z.string().nullable(),
  githubBranch: z.string().nullable(),
  supabaseProjectId: z.string().nullable(),
  supabaseParentProjectId: z.string().nullable(),
  supabaseOrganizationSlug: z.string().nullable(),
  neonProjectId: z.string().nullable(),
  neonDevelopmentBranchId: z.string().nullable(),
  neonPreviewBranchId: z.string().nullable(),
  vercelProjectId: z.string().nullable(),
  vercelProjectName: z.string().nullable(),
  vercelDeploymentUrl: z.string().nullable(),
  vercelTeamId: z.string().nullable(),
  installCommand: z.string().nullable(),
  startCommand: z.string().nullable(),
  isFavorite: z.boolean(),
});

/**
 * Schema for a full App object as returned from the database with computed fields.
 * Used for getApp which returns the full app with resolved paths and files.
 */
export const AppSchema = AppBaseSchema.extend({
  files: z.array(z.string()),
  supabaseProjectName: z.string().nullable(),
  vercelTeamSlug: z.string().nullable(),
  resolvedPath: z.string().optional(),
});

export type App = z.infer<typeof AppSchema>;

/**
 * Schema for CreateApp parameters.
 */
export const CreateAppParamsSchema = z.object({
  name: z.string().min(1),
});

/**
 * Schema for CreateApp result.
 * Uses AppBaseSchema since computed fields are not available at creation time.
 */
export const CreateAppResultSchema = z.object({
  app: AppBaseSchema.extend({
    resolvedPath: z.string(),
  }),
  chatId: z.number(),
});

/**
 * Schema for delete app params.
 */
export const DeleteAppParamsSchema = z.object({
  appId: z.number(),
});

/**
 * Schema for copy app params.
 */
export const CopyAppParamsSchema = z.object({
  appId: z.number(),
  newAppName: z.string(),
  withHistory: z.boolean(),
});

/**
 * Schema for copy app result.
 * Uses AppBaseSchema since computed fields are not available at copy time.
 */
export const CopyAppResultSchema = z.object({
  app: AppBaseSchema.extend({
    resolvedPath: z.string().optional(),
  }),
});

/**
 * Schema for rename app params.
 */
export const RenameAppParamsSchema = z.object({
  appId: z.number(),
  appName: z.string(),
  appPath: z.string(),
});

/**
 * Schema for run/stop/restart app params.
 */
export const AppIdParamsSchema = z.object({
  appId: z.number(),
});

/**
 * Schema for restart app params (with optional removeNodeModules).
 */
export const RestartAppParamsSchema = z.object({
  appId: z.number(),
  removeNodeModules: z.boolean().optional(),
});

/**
 * Schema for edit app file params.
 */
export const EditAppFileParamsSchema = z.object({
  appId: z.number(),
  filePath: z.string(),
  content: z.string(),
});

/**
 * Schema for edit app file result.
 */
export const EditAppFileResultSchema = z.object({
  warning: z.string().optional(),
});

/**
 * Schema for read app file params.
 */
export const ReadAppFileParamsSchema = z.object({
  appId: z.number(),
  filePath: z.string(),
});

/**
 * Schema for respond to app input params.
 */
export const RespondToAppInputParamsSchema = z.object({
  appId: z.number(),
  response: z.string(),
});

/**
 * Schema for search app files params.
 */
export const SearchAppFilesParamsSchema = z.object({
  appId: z.number(),
  query: z.string(),
});

/**
 * Schema for file search result snippet.
 */
export const FileSearchSnippetSchema = z.object({
  before: z.string(),
  match: z.string(),
  after: z.string(),
  line: z.number(),
});

/**
 * Schema for app file search result.
 */
export const AppFileSearchResultSchema = z.object({
  path: z.string(),
  matchesContent: z.boolean(),
  snippets: z.array(FileSearchSnippetSchema).optional(),
});

/**
 * Schema for change app location params.
 */
export const ChangeAppLocationParamsSchema = z.object({
  appId: z.number(),
  parentDirectory: z.string(),
});

/**
 * Schema for change app location result.
 */
export const ChangeAppLocationResultSchema = z.object({
  resolvedPath: z.string(),
});

/**
 * Schema for a listed app - what listApps returns for each app.
 * This is AppBaseSchema plus resolvedPath, but without computed fields like files.
 */
export const ListedAppSchema = AppBaseSchema.extend({
  resolvedPath: z.string().optional(),
});

export type ListedApp = z.infer<typeof ListedAppSchema>;

/**
 * Schema for list apps response.
 * Uses ListedAppSchema since listing only has resolved path, not full computed fields.
 */
export const ListAppsResponseSchema = z.object({
  apps: z.array(ListedAppSchema),
});

/**
 * Schema for rename branch params.
 */
export const RenameBranchParamsSchema = z.object({
  appId: z.number(),
  oldBranchName: z.string(),
  newBranchName: z.string(),
});

/**
 * Schema for add to favorite result.
 */
export const AddToFavoriteResultSchema = z.object({
  isFavorite: z.boolean(),
});

/**
 * Schema for update app commands params.
 */
export const UpdateAppCommandsParamsSchema = z.object({
  appId: z.number(),
  installCommand: z.string().nullable(),
  startCommand: z.string().nullable(),
});

/**
 * Schema for select app location params.
 */
export const SelectAppLocationParamsSchema = z.object({
  defaultPath: z.string().optional(),
});

/**
 * Schema for select app location result.
 */
export const SelectAppLocationResultSchema = z.object({
  path: z.string().nullable(),
  canceled: z.boolean(),
});

/**
 * Schema for app search result.
 */
export const AppSearchResultSchema = z.object({
  id: z.number(),
  name: z.string(),
  createdAt: z.date(),
  matchedChatTitle: z.string().nullable(),
  matchedChatMessage: z.string().nullable(),
});

// =============================================================================
// App Contracts
// =============================================================================

export const appContracts = {
  createApp: defineContract({
    channel: "create-app",
    input: CreateAppParamsSchema,
    output: CreateAppResultSchema,
  }),

  getApp: defineContract({
    channel: "get-app",
    input: z.number(),
    output: AppSchema,
  }),

  listApps: defineContract({
    channel: "list-apps",
    input: z.void(),
    output: ListAppsResponseSchema,
  }),

  deleteApp: defineContract({
    channel: "delete-app",
    input: DeleteAppParamsSchema,
    output: z.void(),
  }),

  copyApp: defineContract({
    channel: "copy-app",
    input: CopyAppParamsSchema,
    output: CopyAppResultSchema,
  }),

  renameApp: defineContract({
    channel: "rename-app",
    input: RenameAppParamsSchema,
    output: z.void(),
  }),

  runApp: defineContract({
    channel: "run-app",
    input: AppIdParamsSchema,
    output: z.void(),
  }),

  stopApp: defineContract({
    channel: "stop-app",
    input: AppIdParamsSchema,
    output: z.void(),
  }),

  restartApp: defineContract({
    channel: "restart-app",
    input: RestartAppParamsSchema,
    output: z.void(),
  }),

  editAppFile: defineContract({
    channel: "edit-app-file",
    input: EditAppFileParamsSchema,
    output: EditAppFileResultSchema,
  }),

  readAppFile: defineContract({
    channel: "read-app-file",
    input: ReadAppFileParamsSchema,
    output: z.string(),
  }),

  respondToAppInput: defineContract({
    channel: "respond-to-app-input",
    input: RespondToAppInputParamsSchema,
    output: z.void(),
  }),

  searchAppFiles: defineContract({
    channel: "search-app-files",
    input: SearchAppFilesParamsSchema,
    output: z.array(AppFileSearchResultSchema),
  }),

  changeAppLocation: defineContract({
    channel: "change-app-location",
    input: ChangeAppLocationParamsSchema,
    output: ChangeAppLocationResultSchema,
  }),

  renameBranch: defineContract({
    channel: "rename-branch",
    input: RenameBranchParamsSchema,
    output: z.void(),
  }),

  addToFavorite: defineContract({
    channel: "add-to-favorite",
    input: AppIdParamsSchema,
    output: AddToFavoriteResultSchema,
  }),

  selectAppLocation: defineContract({
    channel: "select-app-location",
    input: SelectAppLocationParamsSchema,
    output: SelectAppLocationResultSchema,
  }),

  checkAppName: defineContract({
    channel: "check-app-name",
    input: z.object({ appName: z.string() }),
    output: z.object({ exists: z.boolean(), message: z.string().optional() }),
  }),

  searchApps: defineContract({
    channel: "search-app",
    input: z.string(),
    output: z.array(AppSearchResultSchema),
  }),

  updateAppCommands: defineContract({
    channel: "update-app-commands",
    input: UpdateAppCommandsParamsSchema,
    output: z.void(),
  }),
} as const;

// =============================================================================
// App Client
// =============================================================================

/**
 * Type-safe client for app IPC operations.
 * Auto-generated from contracts.
 *
 * @example
 * const { app, chatId } = await appClient.createApp({ name: "my-app" });
 * await appClient.deleteApp({ appId: app.id });
 */
export const appClient = createClient(appContracts);

// =============================================================================
// Type Exports (for backwards compatibility)
// =============================================================================

export type CreateAppParams = z.infer<typeof CreateAppParamsSchema>;
export type CreateAppResult = z.infer<typeof CreateAppResultSchema>;
export type CopyAppParams = z.infer<typeof CopyAppParamsSchema>;
export type EditAppFileReturnType = z.infer<typeof EditAppFileResultSchema>;
export type RespondToAppInputParams = z.infer<
  typeof RespondToAppInputParamsSchema
>;
export type AppFileSearchResult = z.infer<typeof AppFileSearchResultSchema>;
export type ChangeAppLocationParams = z.infer<
  typeof ChangeAppLocationParamsSchema
>;
export type ChangeAppLocationResult = z.infer<
  typeof ChangeAppLocationResultSchema
>;
export type ListAppsResponse = z.infer<typeof ListAppsResponseSchema>;
export type RenameBranchParams = z.infer<typeof RenameBranchParamsSchema>;
export type AppSearchResult = z.infer<typeof AppSearchResultSchema>;
export type UpdateAppCommandsParams = z.infer<
  typeof UpdateAppCommandsParamsSchema
>;

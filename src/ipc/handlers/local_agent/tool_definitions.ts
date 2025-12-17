/**
 * Tool definitions for Local Agent v2
 * Each tool includes a zod schema, description, and execute function
 */

import { z } from "zod";
import { IpcMainInvokeEvent } from "electron";
import { readSettings, writeSettings } from "../../../main/settings";
import {
  executeWriteFile,
  executeDeleteFile,
  executeRenameFile,
  executeSearchReplaceFile,
  executeAddDependencies,
  executeSupabaseSqlQuery,
  readFileForContext,
  listFilesInApp,
  getDatabaseSchema,
  type FileOperationContext,
} from "../../processors/file_operations";
import { toolCallToXml } from "./xml_tool_translator";

// ============================================================================
// Agent Tool Consent Types & Constants
// ============================================================================

export type Consent = "ask" | "always";

// ============================================================================
// Agent Tool Consent Management
// ============================================================================

const pendingConsentResolvers = new Map<
  string,
  (d: "accept-once" | "accept-always" | "decline") => void
>();

export function waitForAgentToolConsent(
  requestId: string,
): Promise<"accept-once" | "accept-always" | "decline"> {
  return new Promise((resolve) => {
    pendingConsentResolvers.set(requestId, resolve);
  });
}

export function resolveAgentToolConsent(
  requestId: string,
  decision: "accept-once" | "accept-always" | "decline",
) {
  const resolver = pendingConsentResolvers.get(requestId);
  if (resolver) {
    pendingConsentResolvers.delete(requestId);
    resolver(decision);
  }
}

export function getDefaultConsent(toolName: AgentToolName): Consent {
  const tool = TOOL_DEFINITIONS.find((t) => t.name === toolName);
  return tool?.defaultConsent ?? "ask";
}

export function getAgentToolConsent(toolName: AgentToolName): Consent {
  const settings = readSettings();
  const stored = settings.agentToolConsents?.[toolName];
  if (stored === "ask" || stored === "always") {
    return stored;
  }
  return getDefaultConsent(toolName);
}

export function setAgentToolConsent(
  toolName: AgentToolName,
  consent: Consent,
): void {
  const settings = readSettings();
  writeSettings({
    agentToolConsents: {
      ...settings.agentToolConsents,
      [toolName]: consent,
    },
  });
}

export function getAllAgentToolConsents(): Record<AgentToolName, Consent> {
  const settings = readSettings();
  const stored = settings.agentToolConsents ?? {};
  const result: Record<string, Consent> = {};

  // Start with defaults, override with stored values
  for (const tool of TOOL_DEFINITIONS) {
    const storedConsent = stored[tool.name];
    if (storedConsent === "ask" || storedConsent === "always") {
      result[tool.name] = storedConsent;
    } else {
      result[tool.name] = getDefaultConsent(tool.name);
    }
  }

  return result as Record<AgentToolName, Consent>;
}

export async function requireAgentToolConsent(
  event: IpcMainInvokeEvent,
  params: {
    toolName: AgentToolName;
    toolDescription?: string | null;
    inputPreview?: string | null;
  },
): Promise<boolean> {
  const current = getAgentToolConsent(params.toolName);

  if (current === "always") return true;

  // Ask renderer for a decision via event bridge
  const requestId = `agent:${params.toolName}:${Date.now()}`;
  (event.sender as any).send("agent-tool:consent-request", {
    requestId,
    ...params,
  });

  const response = await waitForAgentToolConsent(requestId);

  if (response === "accept-always") {
    setAgentToolConsent(params.toolName, "always");
    return true;
  }
  if (response === "decline") {
    return false;
  }
  return response === "accept-once";
}

// ============================================================================
// Tool Execute Context & Definitions
// ============================================================================

export interface ToolExecuteContext {
  event: IpcMainInvokeEvent;
  appPath: string;
  supabaseProjectId?: string | null;
  messageId?: number;
  onXmlChunk: (xml: string) => void;
}

interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<any>;
  readonly defaultConsent: Consent;
  execute: (args: any, ctx: ToolExecuteContext) => Promise<string>;
}

// Tool schemas
const writeFileSchema = z.object({
  path: z.string().describe("The file path relative to the app root"),
  content: z.string().describe("The content to write to the file"),
  description: z
    .string()
    .optional()
    .describe("Brief description of the change"),
});

const deleteFileSchema = z.object({
  path: z.string().describe("The file path to delete"),
});

const renameFileSchema = z.object({
  from: z.string().describe("The current file path"),
  to: z.string().describe("The new file path"),
});

const addDependencySchema = z.object({
  packages: z.array(z.string()).describe("Array of package names to install"),
});

const executeSqlSchema = z.object({
  query: z.string().describe("The SQL query to execute"),
  description: z.string().optional().describe("Brief description of the query"),
});

const searchReplaceSchema = z.object({
  path: z.string().describe("The file path to edit"),
  search: z
    .string()
    .describe(
      "Content to search for in the file. This should match the existing code that will be replaced",
    ),
  replace: z
    .string()
    .describe("New content to replace the search content with"),
  description: z
    .string()
    .optional()
    .describe("Brief description of the changes"),
});

const readFileSchema = z.object({
  path: z.string().describe("The file path to read"),
});

const listFilesSchema = z.object({
  directory: z.string().optional().describe("Optional subdirectory to list"),
});

const getDatabaseSchemaSchema = z.object({});

const setChatSummarySchema = z.object({
  summary: z.string().describe("A short summary/title for the chat"),
});

// Tool implementations
export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: "write_file",
    description: "Create or completely overwrite a file in the codebase",
    inputSchema: writeFileSchema,
    defaultConsent: "always",
    execute: async (args: z.infer<typeof writeFileSchema>, ctx) => {
      const allowed = await requireAgentToolConsent(ctx.event, {
        toolName: "write_file",
        toolDescription: "Create or overwrite a file",
        inputPreview: `Write to ${args.path}`,
      });
      if (!allowed) {
        throw new Error("User denied permission for write_file");
      }

      // Emit XML for UI
      ctx.onXmlChunk(
        toolCallToXml({
          toolName: "write_file",
          toolCallId: "",
          args,
        }),
      );

      const opCtx: FileOperationContext = {
        appPath: ctx.appPath,
        supabaseProjectId: ctx.supabaseProjectId,
      };

      const result = await executeWriteFile(opCtx, args.path, args.content);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.warning || `Successfully wrote ${args.path}`;
    },
  },
  {
    name: "delete_file",
    description: "Delete a file from the codebase",
    inputSchema: deleteFileSchema,
    defaultConsent: "always",
    execute: async (args: z.infer<typeof deleteFileSchema>, ctx) => {
      const allowed = await requireAgentToolConsent(ctx.event, {
        toolName: "delete_file",
        toolDescription: "Delete a file",
        inputPreview: `Delete ${args.path}`,
      });
      if (!allowed) {
        throw new Error("User denied permission for delete_file");
      }

      ctx.onXmlChunk(
        toolCallToXml({
          toolName: "delete_file",
          toolCallId: "",
          args,
        }),
      );

      const opCtx: FileOperationContext = {
        appPath: ctx.appPath,
        supabaseProjectId: ctx.supabaseProjectId,
      };

      const result = await executeDeleteFile(opCtx, args.path);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.warning || `Successfully deleted ${args.path}`;
    },
  },
  {
    name: "rename_file",
    description: "Rename or move a file in the codebase",
    inputSchema: renameFileSchema,
    defaultConsent: "always",
    execute: async (args: z.infer<typeof renameFileSchema>, ctx) => {
      const allowed = await requireAgentToolConsent(ctx.event, {
        toolName: "rename_file",
        toolDescription: "Rename or move a file",
        inputPreview: `Rename ${args.from} to ${args.to}`,
      });
      if (!allowed) {
        throw new Error("User denied permission for rename_file");
      }

      ctx.onXmlChunk(
        toolCallToXml({
          toolName: "rename_file",
          toolCallId: "",
          args,
        }),
      );

      const opCtx: FileOperationContext = {
        appPath: ctx.appPath,
        supabaseProjectId: ctx.supabaseProjectId,
      };

      const result = await executeRenameFile(opCtx, args.from, args.to);
      if (!result.success) {
        throw new Error(result.error);
      }
      return (
        result.warning || `Successfully renamed ${args.from} to ${args.to}`
      );
    },
  },
  {
    name: "add_dependency",
    description: "Install npm packages",
    inputSchema: addDependencySchema,
    defaultConsent: "ask",
    execute: async (args: z.infer<typeof addDependencySchema>, ctx) => {
      const allowed = await requireAgentToolConsent(ctx.event, {
        toolName: "add_dependency",
        toolDescription: "Install npm packages",
        inputPreview: `Install ${args.packages.join(", ")}`,
      });
      if (!allowed) {
        throw new Error("User denied permission for add_dependency");
      }

      ctx.onXmlChunk(
        toolCallToXml({
          toolName: "add_dependency",
          toolCallId: "",
          args,
        }),
      );

      const opCtx: FileOperationContext = {
        appPath: ctx.appPath,
        supabaseProjectId: ctx.supabaseProjectId,
      };

      const result = await executeAddDependencies(
        opCtx,
        args.packages,
        ctx.messageId,
      );
      if (!result.success) {
        throw new Error(result.error);
      }
      return (
        result.warning || `Successfully installed ${args.packages.join(", ")}`
      );
    },
  },
  {
    name: "execute_sql",
    description: "Execute SQL on the Supabase database",
    inputSchema: executeSqlSchema,
    defaultConsent: "ask",
    execute: async (args: z.infer<typeof executeSqlSchema>, ctx) => {
      if (!ctx.supabaseProjectId) {
        throw new Error("Supabase is not connected to this app");
      }

      const allowed = await requireAgentToolConsent(ctx.event, {
        toolName: "execute_sql",
        toolDescription: "Execute SQL on the database",
        inputPreview:
          args.query.slice(0, 100) + (args.query.length > 100 ? "..." : ""),
      });
      if (!allowed) {
        throw new Error("User denied permission for execute_sql");
      }

      ctx.onXmlChunk(
        toolCallToXml({
          toolName: "execute_sql",
          toolCallId: "",
          args,
        }),
      );

      const opCtx: FileOperationContext = {
        appPath: ctx.appPath,
        supabaseProjectId: ctx.supabaseProjectId,
      };

      const result = await executeSupabaseSqlQuery(
        opCtx,
        args.query,
        args.description,
      );
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.warning || "Successfully executed SQL query";
    },
  },
  {
    name: "search_replace",
    description:
      "Apply targeted search/replace edits to a file. This is the preferred tool for editing a file.",
    inputSchema: searchReplaceSchema,
    defaultConsent: "always",
    execute: async (args: z.infer<typeof searchReplaceSchema>, ctx) => {
      const allowed = await requireAgentToolConsent(ctx.event, {
        toolName: "search_replace",
        toolDescription: "Apply search/replace edits",
        inputPreview: `Edit ${args.path}`,
      });
      if (!allowed) {
        throw new Error("User denied permission for search_replace");
      }

      ctx.onXmlChunk(
        toolCallToXml({
          toolName: "search_replace",
          toolCallId: "",
          args,
        }),
      );

      const opCtx: FileOperationContext = {
        appPath: ctx.appPath,
        supabaseProjectId: ctx.supabaseProjectId,
      };

      const result = await executeSearchReplaceFile(
        opCtx,
        args.path,
        args.search,
        args.replace,
      );

      if (!result.success) {
        throw new Error(result.error);
      }
      return result.warning || `Successfully applied edits to ${args.path}`;
    },
  },
  {
    name: "read_file",
    description: "Read the content of a file from the codebase",
    inputSchema: readFileSchema,
    defaultConsent: "always",
    execute: async (args: z.infer<typeof readFileSchema>, ctx) => {
      const allowed = await requireAgentToolConsent(ctx.event, {
        toolName: "read_file",
        toolDescription: "Read a file",
        inputPreview: `Read ${args.path}`,
      });
      if (!allowed) {
        throw new Error("User denied permission for read_file");
      }

      ctx.onXmlChunk(
        toolCallToXml({
          toolName: "read_file",
          toolCallId: "",
          args,
        }),
      );

      const opCtx: FileOperationContext = {
        appPath: ctx.appPath,
        supabaseProjectId: ctx.supabaseProjectId,
      };

      const result = await readFileForContext(opCtx, args.path);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.content || "";
    },
  },
  {
    name: "list_files",
    description: "List all files in the application directory",
    inputSchema: listFilesSchema,
    defaultConsent: "always",
    execute: async (args: z.infer<typeof listFilesSchema>, ctx) => {
      const allowed = await requireAgentToolConsent(ctx.event, {
        toolName: "list_files",
        toolDescription: "List files in the app",
        inputPreview: args.directory
          ? `List ${args.directory}`
          : "List all files",
      });
      if (!allowed) {
        throw new Error("User denied permission for list_files");
      }

      ctx.onXmlChunk(
        toolCallToXml({
          toolName: "list_files",
          toolCallId: "",
          args,
        }),
      );

      const opCtx: FileOperationContext = {
        appPath: ctx.appPath,
        supabaseProjectId: ctx.supabaseProjectId,
      };

      const result = await listFilesInApp(opCtx, args.directory);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.files || "";
    },
  },
  {
    name: "get_database_schema",
    description: "Fetch the database schema from Supabase",
    inputSchema: getDatabaseSchemaSchema,
    defaultConsent: "always",
    execute: async (_args: z.infer<typeof getDatabaseSchemaSchema>, ctx) => {
      if (!ctx.supabaseProjectId) {
        throw new Error("Supabase is not connected to this app");
      }

      const allowed = await requireAgentToolConsent(ctx.event, {
        toolName: "get_database_schema",
        toolDescription: "Fetch database schema",
        inputPreview: "Get Supabase schema",
      });
      if (!allowed) {
        throw new Error("User denied permission for get_database_schema");
      }

      ctx.onXmlChunk(
        toolCallToXml({
          toolName: "get_database_schema",
          toolCallId: "",
          args: {},
        }),
      );

      const opCtx: FileOperationContext = {
        appPath: ctx.appPath,
        supabaseProjectId: ctx.supabaseProjectId,
      };

      const result = await getDatabaseSchema(opCtx);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.schema || "";
    },
  },
  {
    name: "set_chat_summary",
    description: "Set the title/summary for this chat",
    inputSchema: setChatSummarySchema,
    defaultConsent: "always",
    execute: async (args: z.infer<typeof setChatSummarySchema>, ctx) => {
      const allowed = await requireAgentToolConsent(ctx.event, {
        toolName: "set_chat_summary",
        toolDescription: "Set chat title",
        inputPreview: args.summary,
      });
      if (!allowed) {
        throw new Error("User denied permission for set_chat_summary");
      }

      ctx.onXmlChunk(
        toolCallToXml({
          toolName: "set_chat_summary",
          toolCallId: "",
          args,
        }),
      );

      // The actual chat title update is handled by the local_agent_handler
      // based on parsing the XML response
      return `Chat summary set to: ${args.summary}`;
    },
  },
];

// Derive AgentToolName from TOOL_DEFINITIONS
export type AgentToolName = (typeof TOOL_DEFINITIONS)[number]["name"];

/**
 * Build ToolSet for AI SDK from tool definitions
 */
export function buildAgentToolSet(ctx: ToolExecuteContext) {
  const toolSet: Record<string, any> = {};

  for (const tool of TOOL_DEFINITIONS) {
    toolSet[tool.name] = {
      description: tool.description,
      inputSchema: tool.inputSchema,
      execute: async (args: any) => {
        return tool.execute(args, ctx);
      },
    };
  }

  return toolSet;
}

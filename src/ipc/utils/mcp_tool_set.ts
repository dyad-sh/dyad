import type { IpcMainInvokeEvent } from "electron";
import type { ToolExecutionOptions, ToolSet } from "ai";
import log from "electron-log";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { mcpServers } from "../../db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { mcpManager } from "./mcp_manager";
import { requireMcpToolConsent } from "./mcp_consent";
import { buildMcpToolKey, sanitizeMcpName } from "./mcp_tool_utils";
import { isLovableMcpServerUrl } from "@/lib/lovableMcp";
import type { ChatAgentToolPresentation } from "../types/chat_agent";
import { buildLovableToolPresentation } from "./lovable_mcp_presentations";
import { isCanvaMcpServerUrl } from "@/lib/canvaMcp";
import { buildCanvaToolPresentation } from "./canva_mcp_presentations";
import { prepareCanvaGenerateDesignInput } from "./canva_mcp_generation";

const logger = log.scope("mcp_tool_set");

function previewToolInput(args: unknown): string {
  if (typeof args === "string") {
    return args.slice(0, 500);
  }
  if (Array.isArray(args)) {
    return args.join(" ").slice(0, 500);
  }
  return (JSON.stringify(args) ?? String(args)).slice(0, 500);
}

function previewToolResult(result: unknown): string {
  const text = typeof result === "string" ? result : JSON.stringify(result);
  return (text || String(result)).slice(0, 4000);
}

function parseToolResult(result: unknown): unknown {
  if (typeof result === "string") {
    try {
      return JSON.parse(result) as unknown;
    } catch {
      return result;
    }
  }
  return result;
}

function extractWorkflowId(args: unknown): string | null {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return null;
  }
  const record = args as Record<string, unknown>;
  const value =
    record.workflowId ?? record.workflow_id ?? record.workflowID ?? record.id;
  return value == null ? null : String(value);
}

function workflowIdFromResultItem(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id =
    record.id ?? record.workflowId ?? record.workflow_id ?? record.workflowID;
  return id == null ? null : String(id);
}

function isWorkflowExecutionSupportTool(toolName: string): boolean {
  return [
    "search_workflows",
    "get_workflow_details",
    "execute_workflow",
  ].includes(toolName);
}

function filterWorkflowSearchResult(
  result: unknown,
  allowedWorkflowIds: Set<string>,
): string {
  const parsed = parseToolResult(result);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return typeof result === "string" ? result : JSON.stringify(result);
  }

  const record = parsed as Record<string, unknown>;
  for (const key of ["workflows", "data", "results", "items"]) {
    const value = record[key];
    if (Array.isArray(value)) {
      return JSON.stringify({
        ...record,
        [key]: value.filter((item) => {
          const workflowId = workflowIdFromResultItem(item);
          return workflowId ? allowedWorkflowIds.has(workflowId) : false;
        }),
      });
    }
  }

  const workflowId = workflowIdFromResultItem(record);
  return workflowId && allowedWorkflowIds.has(workflowId)
    ? JSON.stringify(record)
    : JSON.stringify({
        workflows: [],
      });
}

export async function buildMcpToolSetForServerIds(
  event: IpcMainInvokeEvent,
  {
    serverIds,
    toolKeys,
    workflowKeys,
    chatId,
    onToolResult,
  }: {
    serverIds: number[];
    toolKeys?: string[];
    workflowKeys?: string[];
    chatId: number;
    onToolResult?: (result: {
      serverName: string;
      toolName: string;
      result: string;
      status: "completed" | "error";
      presentation?: ChatAgentToolPresentation;
    }) => void;
  },
): Promise<ToolSet> {
  const enabledServerIds = Array.from(
    new Set(serverIds.filter((id) => Number.isInteger(id))),
  );
  if (enabledServerIds.length === 0) {
    return {};
  }

  const mcpToolSet: ToolSet = {};
  const allowedToolKeys = toolKeys ? new Set(toolKeys) : null;
  const allowedWorkflowIdsByServer = new Map<number, Set<string>>();
  for (const key of workflowKeys ?? []) {
    const [serverIdPart, ...workflowIdParts] = key.split(":");
    const serverId = Number(serverIdPart);
    const workflowId = workflowIdParts.join(":");
    if (!Number.isInteger(serverId) || !workflowId) continue;
    const existing = allowedWorkflowIdsByServer.get(serverId) ?? new Set();
    existing.add(workflowId);
    allowedWorkflowIdsByServer.set(serverId, existing);
  }

  try {
    const servers = await db
      .select()
      .from(mcpServers)
      .where(
        and(
          inArray(mcpServers.id, enabledServerIds),
          eq(mcpServers.enabled, true as any),
        ),
      );

    for (const server of servers) {
      const client = await mcpManager.getClient(server.id);
      const remoteTools = await client.tools();
      const isCanvaServer = isCanvaMcpServerUrl(server.url);
      let canvaGenerationAttempt = 0;
      if (isLovableMcpServerUrl(server.url)) {
        logger.info("Lovable MCP tools available to assistant", {
          tools: Object.keys(remoteTools),
        });
      }
      const hasWorkflowAccess =
        (allowedWorkflowIdsByServer.get(server.id)?.size ?? 0) > 0;

      for (const [name, mcpTool] of Object.entries(remoteTools)) {
        const selectedTool = allowedToolKeys?.has(`${server.id}:${name}`);
        const workflowSupportTool =
          hasWorkflowAccess && isWorkflowExecutionSupportTool(name);
        if (allowedToolKeys && !selectedTool && !workflowSupportTool) {
          continue;
        }

        const baseKey = buildMcpToolKey(
          sanitizeMcpName(server.name || `server-${server.id}`),
          sanitizeMcpName(name),
        );
        const key =
          mcpToolSet[baseKey] == null
            ? baseKey
            : buildMcpToolKey(
                sanitizeMcpName(`${server.name || "server"}-${server.id}`),
                sanitizeMcpName(name),
              );

        mcpToolSet[key] = {
          description: mcpTool.description,
          inputSchema: mcpTool.inputSchema,
          execute: async (args: unknown, execCtx: ToolExecutionOptions) => {
            const executionArgs =
              isCanvaServer && name === "generate-design"
                ? prepareCanvaGenerateDesignInput(
                    args,
                    (canvaGenerationAttempt += 1),
                  )
                : args;
            const allowedWorkflowIds = workflowKeys
              ? (allowedWorkflowIdsByServer.get(server.id) ?? new Set())
              : undefined;
            if (allowedWorkflowIds) {
              if (name.includes("workflow")) {
                const workflowId = extractWorkflowId(args);
                if (workflowId && !allowedWorkflowIds.has(String(workflowId))) {
                  throw new DyadError(
                    `Workflow ${workflowId} is not enabled for Chat Agent`,
                    DyadErrorKind.UserCancelled,
                  );
                }
              }
            }

            const ok = await requireMcpToolConsent(event, {
              serverId: server.id,
              serverName: server.name,
              toolName: name,
              toolDescription: mcpTool.description,
              inputPreview: previewToolInput(executionArgs),
              chatId,
            });

            if (!ok) {
              throw new DyadError(
                `User declined running tool ${key}`,
                DyadErrorKind.UserCancelled,
              );
            }

            try {
              if (isCanvaServer && name === "generate-design") {
                const inputRecord =
                  executionArgs && typeof executionArgs === "object"
                    ? (executionArgs as Record<string, unknown>)
                    : null;
                logger.info("Running Canva design generation", {
                  attempt: canvaGenerationAttempt,
                  designType: inputRecord?.design_type,
                  queryLength:
                    typeof inputRecord?.query === "string"
                      ? inputRecord.query.length
                      : undefined,
                });
              }
              const result = await mcpTool.execute(executionArgs, execCtx);
              const finalResult =
                allowedWorkflowIds && name === "search_workflows"
                  ? filterWorkflowSearchResult(result, allowedWorkflowIds)
                  : typeof result === "string"
                    ? result
                    : JSON.stringify(result);
              onToolResult?.({
                serverName: server.name,
                toolName: name,
                result: previewToolResult(finalResult),
                status: "completed",
                presentation: isLovableMcpServerUrl(server.url)
                  ? buildLovableToolPresentation(name, finalResult)
                  : isCanvaMcpServerUrl(server.url)
                    ? buildCanvaToolPresentation(name, finalResult)
                    : undefined,
              });
              return finalResult;
            } catch (error) {
              onToolResult?.({
                serverName: server.name,
                toolName: name,
                result: error instanceof Error ? error.message : String(error),
                status: "error",
              });
              throw error;
            }
          },
        };
      }
    }
  } catch (error) {
    logger.warn("Failed building MCP toolset", error);
  }

  return mcpToolSet;
}

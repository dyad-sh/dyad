import type {
  AgentAnalysis,
  AgentExecutionLogType,
  AgentPlan,
  AgentTodoUpdate,
  AgentWorkflowStatus,
} from "./types";
import {
  AgentAnalysisSchema,
  AgentExecutionLogTypeSchema,
  AgentPlanSchema,
  AgentTodoUpdateSchema,
  AgentWorkflowStatusSchema,
} from "./types";

export interface AgentParsedArtifacts {
  analysis?: AgentAnalysis;
  plan?: AgentPlan;
  todoUpdates: AgentTodoUpdate[];
  logs: Array<{
    todoId?: string | null;
    todoKey?: string | null;
    logType: AgentExecutionLogType;
    content: string;
    dyadTagRefs?: string[];
    metadata?: Record<string, unknown>;
  }>;
  workflowStatus?: AgentWorkflowStatus;
  currentTodoId?: string | null;
  autoAdvance?: boolean;
  warnings: string[];
}

const NESTED_TAG_REGEX = /<dyad-agent-([a-z-]+)([^>]*)>([\s\S]*?)<\/dyad-agent-\1>/gi;
const SELF_CLOSING_REGEX = /<dyad-agent-([a-z-]+)([^>]*)\/>/gi;

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z0-9_-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(raw)) !== null) {
    const key = match[1];
    const value = match[3] ?? match[4] ?? "";
    attrs[key] = value;
  }
  return attrs;
}

function parseDyadTagRefs(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  const tokens = raw
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  return tokens.length ? tokens : undefined;
}

function parseJsonContent<T>(
  content: string,
  warnings: string[],
  context: string,
  schema: { parse: (value: unknown) => T },
): T | undefined {
  try {
    const trimmed = content.trim();
    if (!trimmed) return undefined;
    const parsed = JSON.parse(trimmed);
    return schema.parse(parsed);
  } catch (error) {
    warnings.push(`Failed to parse JSON for ${context}: ${String(error)}`);
    return undefined;
  }
}

export function parseAgentArtifacts(content: string): AgentParsedArtifacts {
  const todoUpdates: AgentTodoUpdate[] = [];
  const logs: AgentParsedArtifacts["logs"] = [];
  const warnings: string[] = [];
  let analysis: AgentAnalysis | undefined;
  let plan: AgentPlan | undefined;
  let workflowStatus: AgentWorkflowStatus | undefined;
  let currentTodoId: string | null | undefined;
  let autoAdvance: boolean | undefined;

  const handleTag = (
    tagName: string,
    attrs: Record<string, string>,
    body: string,
  ) => {
    switch (tagName) {
      case "analysis": {
        const parsed = parseJsonContent(body, warnings, "analysis", AgentAnalysisSchema);
        if (parsed) {
          analysis = parsed;
        }
        break;
      }
      case "plan": {
        const parsed = parseJsonContent(body, warnings, "plan", AgentPlanSchema);
        if (parsed) {
          plan = parsed;
          if (attrs.version) {
            const version = Number.parseInt(attrs.version, 10);
            if (!Number.isNaN(version)) {
              plan = { ...plan, version };
            }
          }
          if (!plan.dyadTagRefs) {
            plan = { ...plan, dyadTagRefs: parseDyadTagRefs(attrs.dyadTagRefs) ?? [] };
          }
          if (!plan.dyadTagContext) {
            plan = {
              ...plan,
              dyadTagContext: parseDyadTagRefs(attrs.dyadTagContext) ?? [],
            };
          }
        }
        break;
      }
      case "todo-update": {
        const todoUpdate = AgentTodoUpdateSchema.safeParse({
          todoId: attrs.todoId ?? attrs.id,
          status: attrs.status,
          dyadTagRefs: parseDyadTagRefs(attrs.dyadTagRefs),
          note: body.trim() || undefined,
        });
        if (todoUpdate.success) {
          todoUpdates.push(todoUpdate.data);
        } else {
          warnings.push(`Invalid todo update payload: ${todoUpdate.error.message}`);
        }
        break;
      }
      case "log": {
        const logTypeResult = AgentExecutionLogTypeSchema.safeParse(
          attrs.type ?? attrs.logType ?? "execution",
        );
        if (!logTypeResult.success) {
          warnings.push(`Unknown log type: ${attrs.type ?? attrs.logType}`);
          break;
        }
        const metadata = body.trim().startsWith("{")
          ? (() => {
              try {
                return JSON.parse(body.trim());
              } catch {
                return undefined;
              }
            })()
          : undefined;
        logs.push({
          todoId: attrs.todoId ?? attrs.id ?? undefined,
          todoKey: attrs.todoKey ?? undefined,
          logType: logTypeResult.data,
          content: body.trim(),
          dyadTagRefs: parseDyadTagRefs(attrs.dyadTagRefs),
          metadata,
        });
        break;
      }
      case "status": {
        const statusResult = AgentWorkflowStatusSchema.safeParse(
          attrs.state ?? body.trim(),
        );
        if (statusResult.success) {
          workflowStatus = statusResult.data;
        } else {
          warnings.push(`Invalid workflow status value: ${attrs.state ?? body}`);
        }
        break;
      }
      case "focus": {
        currentTodoId = attrs.todoId ?? attrs.id ?? null;
        break;
      }
      case "auto": {
        if (attrs.enabled) {
          autoAdvance = attrs.enabled === "true" || attrs.enabled === "1";
        } else if (body.trim()) {
          autoAdvance = body.trim().toLowerCase() === "true";
        }
        break;
      }
      case "error": {
        logs.push({
          logType: "system",
          content: body.trim(),
          todoId: attrs.todoId ?? undefined,
          dyadTagRefs: parseDyadTagRefs(attrs.dyadTagRefs),
        });
        break;
      }
      case "todo":
      case "summary":
        break;
      default: {
        warnings.push(`Unhandled agent tag: ${tagName}`);
      }
    }
  };

  let match: RegExpExecArray | null;
  while ((match = NESTED_TAG_REGEX.exec(content)) !== null) {
    const [, rawName, rawAttrs, rawBody] = match;
    handleTag(rawName.toLowerCase(), parseAttributes(rawAttrs), rawBody ?? "");
  }

  while ((match = SELF_CLOSING_REGEX.exec(content)) !== null) {
    const [, rawName, rawAttrs] = match;
    handleTag(rawName.toLowerCase(), parseAttributes(rawAttrs), "");
  }

  return {
    analysis,
    plan,
    todoUpdates,
    logs,
    workflowStatus,
    currentTodoId,
    autoAdvance,
    warnings,
  };
}

/**
 * Dyad ToolDefinition -> pi AgentTool adapter.
 *
 * Rather than rewrite every Dyad agent tool against pi's `AgentTool`
 * interface, we wrap the existing `ToolDefinition` implementations. Each
 * ToolDefinition already carries a zod schema + `execute(args, ctx)`; this
 * adapter:
 *   - converts the zod schema to a typebox `TSchema` (via JSON Schema) that
 *     pi's `validateToolArguments` accepts (see memory: pi-migration-tool-adapter);
 *   - builds a per-run `AgentContext` from an injected factory so each agent
 *     run gets fresh turn-scoped state;
 *   - runs the existing consent gate before executing;
 *   - captures the tool's `<dyad-*>` XML stream into the pi tool result's
 *     `details` so the chat handler can forward it to the renderer.
 *
 * Selection by chat mode (readOnly / planModeOnly) uses the shared
 * `shouldIncludeTool` predicate.
 */

import { z } from "zod";
import { Type, type TSchema } from "typebox";
import type {
  AgentTool,
  AgentToolResult,
  AgentToolUpdateCallback,
} from "@earendil-works/pi-agent-core";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { ExecuteAddDependencyError } from "@/ipc/processors/executeAddDependency";
import { getNeonClientCode } from "@/neon_admin/neon_context";
import { getSupabaseClientCode } from "@/supabase_admin/supabase_context";
import { escapeXmlAttr, escapeXmlContent } from "../../../../shared/xmlEscape";
import {
  toolModifiesState,
  type AgentContext,
  type ToolDefinition,
  type ToolResult,
} from "./dyad/types";
import {
  assertAppBlueprintApproved,
  requireToolConsentOrThrow,
  shouldTrackToolMutation,
  trackAppMutation,
  trackFileEditTool,
} from "./dyad/tool_invocation";

const BLUEPRINT_GATE_EXEMPT_TOOLS = new Set([
  "write_app_blueprint",
  "planning_questionnaire",
  "write_plan",
  "exit_plan",
]);

async function processArgPlaceholders<T>(
  args: T,
  ctx: AgentContext,
): Promise<T> {
  const serialized = JSON.stringify(args);
  const hasSupabase = serialized.includes("$$SUPABASE_CLIENT_CODE$$");
  const hasNeon = serialized.includes("$$NEON_CLIENT_CODE$$");
  if (!hasSupabase && !hasNeon) return args;

  const supabaseClientCode =
    hasSupabase && ctx.supabaseProjectId
      ? await getSupabaseClientCode({
          projectId: ctx.supabaseProjectId,
          organizationSlug: ctx.supabaseOrganizationSlug ?? null,
        })
      : undefined;
  const neonClientCode = hasNeon
    ? ctx.neonProjectId
      ? getNeonClientCode(ctx.frameworkType)
      : ""
    : undefined;

  const processValue = (value: unknown): unknown => {
    if (typeof value === "string") {
      let result = value;
      if (supabaseClientCode) {
        result = result.replace(
          /\$\$SUPABASE_CLIENT_CODE\$\$/g,
          supabaseClientCode,
        );
      }
      if (neonClientCode !== undefined) {
        result = result.replace(/\$\$NEON_CLIENT_CODE\$\$/g, neonClientCode);
      }
      return result;
    }
    if (Array.isArray(value)) return value.map(processValue);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [
          key,
          processValue(nested),
        ]),
      );
    }
    return value;
  };

  return processValue(args) as T;
}

/**
 * Details attached to every adapted tool result so the chat handler can
 * reconstruct the Dyad renderer view. `xml` is the last value the tool passed
 * to `ctx.onXmlComplete` (or the accumulated `onXmlStream`), if any.
 */
export interface AdaptedToolDetails {
  toolName: string;
  /** Final XML the tool emitted via onXmlComplete, if it produced any. */
  xml?: string;
  /** Extra user-message content the tool queued (e.g. generated images). */
  appendedUserMessages: unknown[];
}

/**
 * Convert a Dyad tool's zod schema into a typebox schema pi can validate.
 *
 * pi only structurally checks the JSON Schema shape (it does not require real
 * typebox constructors), so wrapping the emitted JSON Schema in `Type.Unsafe`
 * is sufficient and lossless for validation + provider serialization.
 */
export function zodToTypebox(schema: z.ZodType): TSchema {
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-7" }) as Record<
    string,
    unknown
  >;
  // pi/provider serialization doesn't want the $schema meta key.
  delete jsonSchema.$schema;
  return Type.Unsafe<unknown>(jsonSchema);
}

/**
 * Factory that produces a fresh `AgentContext` for one tool invocation.
 *
 * The chat handler owns the real context construction (DB ids, consent bridge,
 * XML streaming into the renderer). The factory seam keeps the adapter
 * testable with a stub context.
 */
export type AgentContextFactory = (invocation: {
  toolCallId: string;
  toolName: string;
  signal?: AbortSignal;
  /** Sink the adapter installs so it can capture onXmlComplete output. */
  onXml: (xml: string) => void;
  /** Sink for appended user-message content parts. */
  onAppendUserMessage: (content: unknown) => void;
}) => AgentContext;

export interface AdaptToolOptions {
  contextFactory: AgentContextFactory;
  onToolErrorXml?: (toolCallId: string, xml: string) => void;
}

function getToolErrorDisplayDetails(error: unknown): string {
  if (error instanceof ExecuteAddDependencyError) {
    return error.displayDetails;
  }

  return error instanceof Error ? error.message : String(error);
}

function getToolErrorSummary(error: unknown): string {
  if (error instanceof ExecuteAddDependencyError) {
    return error.displaySummary;
  }

  return error instanceof Error ? error.message : String(error);
}

function buildToolErrorXml(toolName: string, error: unknown): string {
  const summary = getToolErrorSummary(error);
  const details = getToolErrorDisplayDetails(error);
  return `<dyad-output type="error" message="Tool '${toolName}' failed: ${escapeXmlAttr(summary)}">${escapeXmlContent(details)}</dyad-output>`;
}

/**
 * Wrap one Dyad `ToolDefinition` as a pi `AgentTool`.
 */
export function adaptTool<T>(
  toolDef: ToolDefinition<T>,
  options: AdaptToolOptions,
): AgentTool<TSchema, AdaptedToolDetails> {
  const parameters = zodToTypebox(toolDef.inputSchema as z.ZodType);

  return {
    name: toolDef.name,
    label: toolDef.name,
    description: toolDef.description,
    parameters,
    async execute(
      toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback<AdaptedToolDetails>,
    ): Promise<AgentToolResult<AdaptedToolDetails>> {
      let capturedXml: string | undefined;
      let toolEmittedXml = false;
      const appendedUserMessages: unknown[] = [];

      const captureXml = (xml: string) => {
        capturedXml = xml;
        onUpdate?.({
          content: [],
          details: {
            toolName: toolDef.name,
            xml,
            appendedUserMessages: [...appendedUserMessages],
          },
        });
      };

      const ctx = options.contextFactory({
        toolCallId,
        toolName: toolDef.name,
        signal,
        onXml: (xml) => {
          toolEmittedXml = true;
          captureXml(xml);
        },
        onAppendUserMessage: (content) => {
          appendedUserMessages.push(content);
        },
      });

      try {
        // Validate against the tool's own zod schema. pi already validated the
        // JSON-Schema shape, but the zod schema may carry refinements (min/max,
        // enums) the JSON-Schema round-trip dropped.
        const parsed = toolDef.inputSchema.safeParse(params);
        if (!parsed.success) {
          throw new DyadError(
            `Invalid arguments for tool "${toolDef.name}": ${parsed.error.message}`,
            DyadErrorKind.Validation,
          );
        }
        const args = await processArgPlaceholders(parsed.data, ctx);
        const initialXml = toolDef.buildXml?.(args, false);
        if (initialXml) {
          captureXml(initialXml);
        }

        if (
          toolModifiesState(toolDef, ctx) &&
          !BLUEPRINT_GATE_EXEMPT_TOOLS.has(toolDef.name)
        ) {
          assertAppBlueprintApproved({
            toolName: toolDef.name,
            chatId: ctx.chatId,
            enabled: ctx.enableAppBlueprint !== false,
          });
        }

        // Consent is enforced exactly once at the pi adapter boundary.
        await requireToolConsentOrThrow(toolDef, args, ctx);

        trackFileEditTool(
          ctx,
          toolDef.name,
          args as { file_path?: string; path?: string },
        );
        const result: ToolResult = await toolDef.execute(args, ctx);
        trackAppMutation(
          ctx,
          toolDef.name,
          shouldTrackToolMutation(toolDef, args, result, ctx),
        );
        if (!toolEmittedXml) {
          capturedXml = toolDef.buildXml?.(args, true) ?? capturedXml;
        }

        return {
          content: [{ type: "text", text: result }],
          details: {
            toolName: toolDef.name,
            xml: capturedXml,
            appendedUserMessages,
          },
        };
      } catch (error) {
        options.onToolErrorXml?.(
          toolCallId,
          buildToolErrorXml(toolDef.name, error),
        );
        throw error;
      }
    },
  };
}

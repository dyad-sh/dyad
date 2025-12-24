/**
 * Shared types and utilities for Local Agent tools
 */

import { z } from "zod";
import { IpcMainInvokeEvent } from "electron";
import { jsonrepair } from "jsonrepair";
import { AgentToolConsent } from "@/ipc/ipc_types";

// ============================================================================
// XML Escape Helpers
// ============================================================================

export function escapeXmlAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeXmlContent(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface AgentContext {
  event: IpcMainInvokeEvent;
  appPath: string;
  chatId: number;
  supabaseProjectId: string | null;
  supabaseOrganizationSlug: string | null;
  messageId: number;
  isSharedModulesChanged: boolean;
  chatSummary?: string;
  /**
   * Streams accumulated XML to UI without persisting to DB (for live preview).
   * Call this repeatedly with the full accumulated XML so far.
   */
  onXmlStream: (accumulatedXml: string) => void;
  /**
   * Writes final XML to UI and persists to DB.
   * Call this once when the tool's XML output is complete.
   */
  onXmlComplete: (finalXml: string) => void;
  requireConsent: (params: {
    toolName: string;
    toolDescription?: string | null;
    inputPreview?: string | null;
  }) => Promise<boolean>;
}

// ============================================================================
// Partial JSON Parser
// ============================================================================

/**
 * Parse partial/streaming JSON into a partial object using jsonrepair.
 * Handles incomplete JSON gracefully during streaming.
 */
export function parsePartialJson<T extends Record<string, unknown>>(
  jsonText: string,
): Partial<T> {
  if (!jsonText.trim()) {
    return {} as Partial<T>;
  }

  try {
    const repaired = jsonrepair(jsonText);
    return JSON.parse(repaired) as Partial<T>;
  } catch {
    // If jsonrepair fails, return empty object
    return {} as Partial<T>;
  }
}

// ============================================================================
// Tool Definition Interface
// ============================================================================

export interface ToolDefinition<T = any> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<T>;
  readonly defaultConsent: AgentToolConsent;
  execute: (args: T, ctx: AgentContext) => Promise<string>;

  /**
   * If defined, returns whether the tool should be available in the current context.
   * If it returns false, the tool will be filtered out.
   */
  isEnabled?: (ctx: AgentContext) => boolean;

  /**
   * Returns a preview string describing what the tool will do with the given args.
   * Used for consent prompts. If not provided, no inputPreview will be shown.
   *
   * @param args - The parsed args for the tool call
   * @returns A human-readable description of the operation
   */
  getConsentPreview?: (args: T) => string;

  /**
   * Build XML from parsed partial args.
   * Called by the handler during streaming and on completion.
   *
   * @param args - Partial args parsed from accumulated JSON (type inferred from inputSchema)
   * @param isComplete - True if this is the final call (include closing tags)
   * @returns The XML string, or undefined if not enough args yet
   */
  buildXml?: (args: Partial<T>, isComplete: boolean) => string | undefined;
}

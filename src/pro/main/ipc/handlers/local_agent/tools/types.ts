/**
 * Shared types and utilities for Local Agent tools
 */

import { z } from "zod";
import { IpcMainInvokeEvent } from "electron";
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
  supabaseProjectId?: string | null;
  messageId?: number;
  isSharedModulesChanged?: boolean;
  onXmlChunk: (xml: string) => void;
  requireConsent: (params: {
    toolName: string;
    toolDescription?: string | null;
    inputPreview?: string | null;
  }) => Promise<boolean>;
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
}

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
// Streaming Args Parser
// ============================================================================

/**
 * Helper class for parsing streaming JSON arguments.
 * Accumulates JSON text and extracts field values as they become available.
 */
export class StreamingArgsParser {
  private accumulated = "";
  private lastContentLength = 0;

  /**
   * Push a delta chunk of JSON text
   */
  push(delta: string): void {
    this.accumulated += delta;
  }

  /**
   * Get the full accumulated JSON text
   */
  getAccumulated(): string {
    return this.accumulated;
  }

  /**
   * Try to extract a string field value from the partial JSON.
   * Returns undefined if the field hasn't started yet.
   * Returns the partial value if the field is being streamed.
   */
  tryGetStringField(field: string): string | undefined {
    // Look for "field": "value or "field":"value
    const pattern = new RegExp(`"${field}"\\s*:\\s*"`);
    const match = this.accumulated.match(pattern);
    if (!match) return undefined;

    const startIndex = match.index! + match[0].length;
    const rest = this.accumulated.slice(startIndex);

    // Find the end of the string (unescaped quote)
    let value = "";
    let i = 0;
    while (i < rest.length) {
      if (rest[i] === "\\") {
        // Escaped character - include both the backslash and next char
        value += rest[i] + (rest[i + 1] || "");
        i += 2;
      } else if (rest[i] === '"') {
        // End of string
        break;
      } else {
        value += rest[i];
        i++;
      }
    }

    // Unescape common JSON escapes
    return value
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }

  /**
   * Get new content since last call.
   * Useful for streaming the "content" field progressively.
   */
  getContentDelta(field: string): string | undefined {
    const fullContent = this.tryGetStringField(field);
    if (fullContent === undefined) return undefined;

    const delta = fullContent.slice(this.lastContentLength);
    this.lastContentLength = fullContent.length;
    return delta;
  }

  /**
   * Check if a field has started streaming (the key is present)
   */
  hasField(field: string): boolean {
    return this.accumulated.includes(`"${field}"`);
  }

  /**
   * Reset the parser state
   */
  reset(): void {
    this.accumulated = "";
    this.lastContentLength = 0;
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
   * Build XML from accumulated JSON args.
   * Called by the handler during streaming and on completion.
   *
   * @param argsText - The accumulated JSON args text so far
   * @param isComplete - True if this is the final call (include closing tags)
   * @returns The XML string, or undefined if not enough args yet
   */
  buildXml?: (argsText: string, isComplete: boolean) => string | undefined;
}

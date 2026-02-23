/**
 * XML Tool Emulation Layer for Local Models
 *
 * Many local models (Ollama, LM Studio) don't support native function calling.
 * This module provides:
 *   1. A system prompt insert that describes available tools in XML format
 *   2. A parser that extracts tool invocations from the model's free-text response
 *   3. A formatter for tool results that gets fed back to the model
 *
 * The XML format is:
 *   <tool-call name="tool_name">
 *     <param name="param_name">value</param>
 *   </tool-call>
 *
 * Tool results are returned as:
 *   <tool-result name="tool_name">
 *     result text
 *   </tool-result>
 */

import type { ToolDefinition } from "./tools/types";

// ============================================================================
// System Prompt Generation — describe available tools as XML
// ============================================================================

/**
 * Generate system prompt documentation for all available tools in XML format.
 * This is injected into the system prompt for local models so they know
 * what tools are available and how to invoke them.
 */
export function generateXmlToolDocumentation(
  tools: readonly ToolDefinition[],
): string {
  let doc = `<available_tools>
You have the following tools available. To use a tool, output a <tool-call> XML block.
After each tool call, you will receive a <tool-result> block with the output.
You may call multiple tools in sequence. When you are done with tool calls, provide your final response text.

FORMAT:
<tool-call name="tool_name">
  <param name="parameter_name">parameter value</param>
  <param name="another_param">another value</param>
</tool-call>

IMPORTANT:
- Always use the exact tool and parameter names shown below.
- Parameter values are plain text (not JSON) unless noted otherwise.
- You can call multiple tools in a single response — put each <tool-call> on its own line.
- After you receive tool results, continue your response with more tool calls or your final answer.

`;

  for (const tool of tools) {
    doc += `<tool name="${tool.name}" consent="${tool.defaultConsent}">
  <description>${tool.description}</description>
  <parameters>
`;

    // Extract parameter info from the zod schema
    const shape = getZodShape(tool.inputSchema);
    for (const [paramName, paramInfo] of Object.entries(shape)) {
      const required = paramInfo.required ? ' required="true"' : "";
      doc += `    <param name="${paramName}" type="${paramInfo.type}"${required}>${paramInfo.description}</param>\n`;
    }

    doc += `  </parameters>
</tool>

`;
  }

  doc += `</available_tools>`;
  return doc;
}

// ============================================================================
// Response Parser — extract tool calls from free-text model output
// ============================================================================

export interface ParsedToolInvocation {
  toolName: string;
  args: Record<string, string>;
  /** The raw XML that was matched, for tracking positions */
  rawXml: string;
}

/**
 * Parse tool invocations from the model's free-text response.
 * Returns an array of parsed tool calls and the remaining text content.
 */
export function parseXmlToolCalls(response: string): {
  toolCalls: ParsedToolInvocation[];
  textSegments: string[];
} {
  const toolCalls: ParsedToolInvocation[] = [];
  const textSegments: string[] = [];

  // Regex to match <tool-call name="...">...</tool-call>
  const toolCallRegex =
    /<tool-call\s+name="([^"]+)">([\s\S]*?)<\/tool-call>/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = toolCallRegex.exec(response)) !== null) {
    // Capture text before this tool call
    const textBefore = response.slice(lastIndex, match.index).trim();
    if (textBefore) {
      textSegments.push(textBefore);
    }
    lastIndex = match.index + match[0].length;

    const toolName = match[1];
    const paramsXml = match[2];

    // Parse <param name="...">value</param> tags
    const args: Record<string, string> = {};
    const paramRegex = /<param\s+name="([^"]+)">([\s\S]*?)<\/param>/g;
    let paramMatch: RegExpExecArray | null;
    while ((paramMatch = paramRegex.exec(paramsXml)) !== null) {
      args[paramMatch[1]] = unescapeXml(paramMatch[2].trim());
    }

    toolCalls.push({
      toolName,
      args,
      rawXml: match[0],
    });
  }

  // Capture remaining text after the last tool call
  const textAfter = response.slice(lastIndex).trim();
  if (textAfter) {
    textSegments.push(textAfter);
  }

  return { toolCalls, textSegments };
}

/**
 * Check if the response contains any tool call invocations.
 */
export function hasToolCalls(response: string): boolean {
  return /<tool-call\s+name="[^"]+">/.test(response);
}

// ============================================================================
// Result Formatter — format tool results for feeding back to the model
// ============================================================================

/**
 * Format a tool result for inclusion in the conversation.
 */
export function formatToolResult(
  toolName: string,
  result: string,
  isError = false,
): string {
  const typeAttr = isError ? ' type="error"' : "";
  return `<tool-result name="${toolName}"${typeAttr}>\n${result}\n</tool-result>`;
}

/**
 * Format multiple tool results into a single block.
 */
export function formatToolResults(
  results: Array<{ toolName: string; result: string; isError?: boolean }>,
): string {
  return results.map((r) => formatToolResult(r.toolName, r.result, r.isError)).join("\n\n");
}

// ============================================================================
// Helpers
// ============================================================================

function unescapeXml(str: string): string {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

interface ParamInfo {
  type: string;
  description: string;
  required: boolean;
}

/**
 * Extract parameter info from a Zod schema for documentation.
 * This is a best-effort extraction that handles common patterns.
 */
function getZodShape(
  schema: any,
): Record<string, ParamInfo> {
  const result: Record<string, ParamInfo> = {};

  try {
    // Zod objects have a .shape property
    let shape: Record<string, any> | undefined;

    if (schema?._def?.typeName === "ZodObject") {
      shape = schema.shape;
    } else if (schema?.shape) {
      shape = schema.shape;
    } else if (schema?._def?.shape) {
      shape = typeof schema._def.shape === "function" ? schema._def.shape() : schema._def.shape;
    }

    if (!shape) return result;

    for (const [key, fieldSchema] of Object.entries<any>(shape)) {
      let type = "string";
      let description = "";
      let required = true;

      // Walk through wrappers (ZodOptional, ZodDefault, etc.)
      let current = fieldSchema;
      while (current?._def) {
        if (current._def.typeName === "ZodOptional") {
          required = false;
          current = current._def.innerType;
          continue;
        }
        if (current._def.typeName === "ZodDefault") {
          required = false;
          current = current._def.innerType;
          continue;
        }
        if (current._def.description) {
          description = current._def.description;
        }
        break;
      }

      // Determine type
      if (current?._def?.typeName) {
        const tn = current._def.typeName;
        if (tn === "ZodString") type = "string";
        else if (tn === "ZodNumber") type = "number";
        else if (tn === "ZodBoolean") type = "boolean";
        else if (tn === "ZodArray") type = "array";
        else type = "string";
      }

      // Check for description on the unwrapped type too
      if (!description && current?._def?.description) {
        description = current._def.description;
      }
      // Also check the original field for description
      if (!description && fieldSchema?.description) {
        description = fieldSchema.description;
      }

      result[key] = { type, description, required };
    }
  } catch {
    // If schema introspection fails, return empty
  }

  return result;
}

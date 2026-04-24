/**
 * Plugin → ToolDefinition Adapter
 *
 * Surfaces every command registered by an enabled plugin as an agent-callable
 * tool. The plugin system already maintains an internal `commands` map; this
 * adapter wraps the command map at lookup time so newly enabled plugins are
 * reflected the next time tools are listed.
 *
 * Tool naming convention: `plugin_<pluginId>_<command>` (sanitized).
 */

import { z } from "zod";
import log from "electron-log";
import { getPluginSystem } from "@/lib/plugin_system";
import type { ToolDefinition } from "./types";

const logger = log.scope("plugin_tools_adapter");

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, "_");
}

export function getPluginAgentTools(): ToolDefinition[] {
  const sys = getPluginSystem();
  // PluginSystem exposes `getCommands()` if available; fall back to internal map.
  const commands: Array<{ id: string; pluginId: string; title?: string }> = [];
  try {
    const anySys = sys as unknown as {
      getRegisteredCommands?: () => Array<{ id: string; pluginId: string; title?: string }>;
      commands?: Map<string, { pluginId: string; handler: (...a: unknown[]) => unknown }>;
    };
    if (typeof anySys.getRegisteredCommands === "function") {
      commands.push(...anySys.getRegisteredCommands());
    } else if (anySys.commands instanceof Map) {
      for (const [id, entry] of anySys.commands.entries()) {
        commands.push({ id, pluginId: String(entry.pluginId) });
      }
    }
  } catch (err) {
    logger.warn(`Could not enumerate plugin commands: ${err}`);
    return [];
  }

  return commands.map((cmd) => {
    const name = `plugin_${sanitize(cmd.pluginId)}_${sanitize(cmd.id)}`;
    return {
      name,
      description:
        cmd.title ??
        `Run plugin command \"${cmd.id}\" contributed by plugin ${cmd.pluginId}.`,
      inputSchema: z.object({ args: z.array(z.unknown()).optional() }),
      defaultConsent: "ask",
      getConsentPreview: (args) => `${name}(${JSON.stringify(args.args ?? []).slice(0, 80)})`,
      execute: async (args) => {
        const result = await sys.executeCommand(cmd.id, ...(args.args ?? []));
        return typeof result === "string" ? result : JSON.stringify(result ?? null);
      },
    } satisfies ToolDefinition;
  });
}

export function getPluginAgentToolNames(): string[] {
  return getPluginAgentTools().map((t) => t.name);
}

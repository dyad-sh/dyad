/**
 * MCP ↔ AI SDK Bridge
 * --------------------------------------------------------------------------
 * Converts every connected MCP server's tools into a Vercel AI SDK ToolSet
 * so any feature in JoyCreate that uses `streamText` / `generateText`
 * (Joy Assistant, Agent Orchestrator, Document Studio, n8n agent nodes,
 *  voice assistant, etc.) automatically gets access to all configured
 * MCP servers (GitHub, Slack, Notion, Postgres, Brave, Filesystem, …).
 *
 * Design:
 *   • Pulls all `enabled` rows from `mcpServers`.
 *   • Connects (lazily) via the singleton `mcpHubManager`.
 *   • Lists each server's tools, converts the JSON-Schema input schema
 *     into a permissive Zod schema (best-effort), and wraps each as a
 *     Vercel AI SDK `tool()`.
 *   • Tool names are namespaced: `mcp__<sanitizedServer>__<tool>`
 *     so they never collide with native JoyCreate tools.
 *   • `execute()` honors the existing consent system: `denied` throws,
 *     `ask`/`always` are surfaced through the renderer consent prompt
 *     when a `BrowserWindow` is supplied; for headless callers
 *     (orchestrator, n8n) we fall back to "always" semantics ONLY if
 *     `allowHeadless` is true.
 *
 * Single source of truth — every studio in JoyCreate just calls
 * `await buildMcpToolSet(opts)` and merges the result into its `tools`
 * map before invoking the model.
 *
 * If the hub manager cannot connect a particular server, we LOG and
 * skip it instead of throwing — one broken MCP server should never
 * take down the whole AI pipeline.
 */

import { tool, type ToolSet } from "ai";
import { z, type ZodTypeAny } from "zod";
import log from "electron-log";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { db } from "../db";
import { mcpServers } from "../db/schema";
import { mcpHubManager } from "../ipc/utils/mcp_hub_manager";
import { getStoredConsent, requireMcpToolConsent } from "../ipc/utils/mcp_consent";

const logger = log.scope("mcp_ai_bridge");

export interface BuildMcpToolSetOptions {
  /** Restrict to a subset of server ids. Default: all enabled servers. */
  serverIds?: number[];
  /**
   * If true, headless callers (no BrowserWindow available) are allowed
   * to invoke MCP tools that would normally require interactive consent.
   * Use only for trusted internal callers (agent orchestrator, n8n).
   * `denied` consents are STILL respected.
   */
  allowHeadless?: boolean;
  /** Optional renderer window used for interactive consent prompts. */
  consentWindow?: BrowserWindow;
  /** Optional allow-list of fully-qualified tool names (`mcp__server__tool`). */
  toolAllowList?: string[];
  /** Optional deny-list of fully-qualified tool names. */
  toolDenyList?: string[];
  /** Skip auto-connect; only include already-connected servers. */
  skipAutoConnect?: boolean;
}

export interface McpBridgeResult {
  tools: ToolSet;
  /** Diagnostic info: which servers contributed, which failed, counts. */
  summary: {
    serversIncluded: { id: number; name: string; toolCount: number }[];
    serversFailed: { id: number; name: string; error: string }[];
    totalTools: number;
  };
}

/**
 * Sanitize a server name into a tool-name-safe slug.
 * AI SDK tool names must match `/^[a-zA-Z0-9_-]+$/`.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

export function namespaceToolName(serverName: string, toolName: string): string {
  return `mcp__${slugify(serverName)}__${slugify(toolName)}`;
}

/**
 * Decide how a per-agent / per-surface `mcpToolsAllow` allow-list maps onto
 * `BuildMcpToolSetOptions`. Centralizing this here means callers (the
 * autonomous agent runtime, document AI, voice assistant, etc.) can share
 * exactly one definition of "undefined = unrestricted, [] = none, [...]
 * = explicit allow-list" — and tests can drive the real helper instead of
 * reimplementing it.
 *
 *   undefined  → { skip: false, options: {} }       ("unrestricted")
 *   []         → { skip: true }                     ("explicit opt-out")
 *   [...names] → { skip: false, options: { toolAllowList } }
 */
export type McpAllowListPlan =
  | { skip: true }
  | { skip: false; options: Pick<BuildMcpToolSetOptions, "toolAllowList"> };

export function planMcpAllowList(
  mcpToolsAllow: readonly string[] | undefined,
): McpAllowListPlan {
  if (mcpToolsAllow === undefined) {
    return { skip: false, options: {} };
  }
  if (Array.isArray(mcpToolsAllow) && mcpToolsAllow.length === 0) {
    return { skip: true };
  }
  return {
    skip: false,
    options: { toolAllowList: [...mcpToolsAllow] },
  };
}

/**
 * Best-effort JSON-Schema → Zod converter. We don't need full fidelity —
 * the AI SDK only uses the schema to (a) describe parameters to the model
 * and (b) validate tool-call arguments. A permissive `z.any()` fallback
 * is acceptable for unrecognized constructs.
 */
function jsonSchemaToZod(schema: unknown): ZodTypeAny {
  if (!schema || typeof schema !== "object") return z.any();
  const s = schema as Record<string, any>;

  if (Array.isArray(s.anyOf)) {
    const opts = s.anyOf.map(jsonSchemaToZod);
    return opts.length > 0
      ? (opts as [ZodTypeAny, ...ZodTypeAny[]]).reduce((acc, cur) => acc.or(cur))
      : z.any();
  }
  if (Array.isArray(s.oneOf)) {
    const opts = s.oneOf.map(jsonSchemaToZod);
    return opts.length > 0
      ? (opts as [ZodTypeAny, ...ZodTypeAny[]]).reduce((acc, cur) => acc.or(cur))
      : z.any();
  }
  if (Array.isArray(s.enum) && s.enum.length > 0) {
    // Preserve original literal types (numbers, booleans, etc.).
    const allStrings = s.enum.every((v: unknown) => typeof v === "string");
    if (allStrings) {
      return z.enum(s.enum as [string, ...string[]]);
    }
    const literals = s.enum.map((v: unknown) =>
      z.literal(v as string | number | boolean),
    );
    return literals.length === 1
      ? literals[0]
      : z.union(literals as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
  }

  const type = s.type;
  if (type === "string") {
    let zs: ZodTypeAny = z.string();
    if (s.description) zs = zs.describe(String(s.description));
    return zs;
  }
  if (type === "number" || type === "integer") {
    let zn: ZodTypeAny = type === "integer" ? z.number().int() : z.number();
    if (s.description) zn = zn.describe(String(s.description));
    return zn;
  }
  if (type === "boolean") {
    let zb: ZodTypeAny = z.boolean();
    if (s.description) zb = zb.describe(String(s.description));
    return zb;
  }
  if (type === "array") {
    const item = s.items ? jsonSchemaToZod(s.items) : z.any();
    return z.array(item);
  }
  if (type === "object" || s.properties) {
    const props = (s.properties as Record<string, unknown>) ?? {};
    const required = new Set<string>(Array.isArray(s.required) ? s.required : []);
    const shape: Record<string, ZodTypeAny> = {};
    for (const [key, sub] of Object.entries(props)) {
      const z0 = jsonSchemaToZod(sub);
      shape[key] = required.has(key) ? z0 : z0.optional();
    }
    // JSON Schema default is permissive — only enforce strict shape when
    // the server explicitly sets additionalProperties=false.
    const base = z.object(shape);
    let obj: ZodTypeAny =
      s.additionalProperties === false ? base.strict() : base.passthrough();
    if (s.description) obj = obj.describe(String(s.description));
    return obj;
  }
  // Unknown / mixed-type — accept anything.
  return z.any();
}

/**
 * Build a Vercel AI SDK ToolSet that exposes every (allowed) tool from
 * every (enabled, requested) MCP server registered in JoyCreate.
 *
 * Safe to call multiple times; results are not cached because tool lists
 * can change as servers connect/disconnect, but each invocation only
 * makes one round-trip per server.
 */
export async function buildMcpToolSet(
  opts: BuildMcpToolSetOptions = {},
): Promise<McpBridgeResult> {
  const allow = opts.toolAllowList ? new Set(opts.toolAllowList) : null;
  const deny = opts.toolDenyList ? new Set(opts.toolDenyList) : new Set<string>();

  // 1. Pick the servers we care about.
  let rows = await db.select().from(mcpServers);
  rows = rows.filter((r) => r.enabled);
  if (opts.serverIds && opts.serverIds.length > 0) {
    const want = new Set(opts.serverIds);
    rows = rows.filter((r) => want.has(r.id));
  }

  const tools: ToolSet = {};
  const serversIncluded: McpBridgeResult["summary"]["serversIncluded"] = [];
  const serversFailed: McpBridgeResult["summary"]["serversFailed"] = [];
  let totalTools = 0;

  // 2. For each server, try to (lazy-)connect and pull its tool list.
  for (const server of rows) {
    try {
      const status = mcpHubManager.getStatus(server.id);
      if (status.status !== "connected") {
        if (opts.skipAutoConnect) {
          logger.debug(
            `Skipping ${server.name} (id=${server.id}): not connected and skipAutoConnect=true`,
          );
          continue;
        }
        await mcpHubManager.connect(server.id);
      }

      const remoteTools = await mcpHubManager.listTools(server.id);
      let serverToolCount = 0;

      for (const remote of remoteTools) {
        // 1) Compute the *final* fully-qualified name first — including
        //    collision disambiguation — so persisted allow/deny entries
        //    from the picker/catalog can target the disambiguated name.
        let fqName = namespaceToolName(server.name, remote.name);

        // Guard against silent overwrites — slugify+truncate can collide
        // (e.g. two long tool names that share the first 48 chars).
        if (Object.prototype.hasOwnProperty.call(tools, fqName)) {
          const disambiguated = `${fqName}__${server.id}_${remote.name}`
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, "_")
            .slice(0, 64);
          logger.warn(
            `MCP tool name collision for '${fqName}' (server=${server.name}); ` +
              `renaming new entry to '${disambiguated}'.`,
          );
          fqName = disambiguated;
          // If the disambiguated name STILL collides, skip rather than overwrite.
          if (Object.prototype.hasOwnProperty.call(tools, fqName)) {
            logger.error(
              `Skipping MCP tool '${remote.name}' on '${server.name}': ` +
                `disambiguated name '${fqName}' still collides.`,
            );
            continue;
          }
        }

        // 2) Now apply allow/deny against the final name. Doing this AFTER
        //    disambiguation means catalog clients (the McpToolPicker) will
        //    see the same identifier that allow-lists are keyed against.
        if (allow && !allow.has(fqName)) continue;
        if (deny.has(fqName)) continue;

        const params = jsonSchemaToZod(remote.inputSchema ?? {});
        const desc = `[${server.name}] ${remote.description ?? remote.name}`;

        // Narrow shape of an MCP CallToolResult so we don't sprinkle
        // `as any` over the response handler. Mirrors @modelcontextprotocol/sdk.
        type McpContentItem = { type?: string; text?: string } & Record<
          string,
          unknown
        >;
        type McpCallToolResult = {
          isError?: boolean;
          content?: McpContentItem[];
        } & Record<string, unknown>;

        // The Vercel AI SDK accepts a Zod schema as `inputSchema`. We get
        // back a `ZodTypeAny` from `jsonSchemaToZod` — hand it through
        // without an `as any` shim.
        tools[fqName] = tool({
          description: desc,
          inputSchema: params,
          execute: async (args: unknown): Promise<McpCallToolResult> => {
            // Consent gate.
            const stored = await getStoredConsent(server.id, remote.name);
            if (stored === "denied") {
              throw new Error(
                `MCP tool '${remote.name}' on '${server.name}' is denied by user consent.`,
              );
            }
            if (stored !== "always") {
              if (opts.consentWindow) {
                // Manufacture an IpcMainInvokeEvent-shaped object — only
                // `sender` is used by `requireMcpToolConsent`. Picking the
                // exact field keeps us TypeScript-honest.
                const fakeEvent: Pick<IpcMainInvokeEvent, "sender"> = {
                  sender: opts.consentWindow.webContents,
                };
                const inputPreview =
                  typeof args === "string"
                    ? args
                    : JSON.stringify(args ?? {}).slice(0, 500);
                const ok = await requireMcpToolConsent(
                  fakeEvent as IpcMainInvokeEvent,
                  {
                    serverId: server.id,
                    serverName: server.name,
                    toolName: remote.name,
                    inputPreview,
                  },
                );
                if (!ok) {
                  throw new Error(
                    `MCP tool '${remote.name}' on '${server.name}' was denied by the user.`,
                  );
                }
              } else if (!opts.allowHeadless) {
                throw new Error(
                  `MCP tool '${remote.name}' on '${server.name}' requires user consent ` +
                    `but no consent window was provided. Pass { allowHeadless: true } ` +
                    `for trusted internal callers, or supply { consentWindow }.`,
                );
              }
              // headless + allowHeadless=true: proceed without prompting.
            }

            const raw = await mcpHubManager.callTool(
              server.id,
              remote.name,
              args,
            );
            const result =
              raw && typeof raw === "object"
                ? (raw as McpCallToolResult)
                : ({} as McpCallToolResult);
            // The MCP CallToolResult shape is `{ content: [...], isError? }`.
            // Surface errors so the model can recover.
            if (result.isError) {
              const text =
                result.content
                  ?.map((c) =>
                    typeof c?.text === "string" ? c.text : JSON.stringify(c),
                  )
                  .join("\n") ?? "MCP tool returned an error";
              throw new Error(`MCP tool error: ${text}`);
            }
            return result;
          },
        });

        totalTools++;
        serverToolCount++;
      }

      serversIncluded.push({
        id: server.id,
        name: server.name,
        toolCount: serverToolCount,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        `Skipping MCP server '${server.name}' (id=${server.id}): ${msg}`,
      );
      serversFailed.push({ id: server.id, name: server.name, error: msg });
    }
  }

  return {
    tools,
    summary: { serversIncluded, serversFailed, totalTools },
  };
}

/**
 * Convenience helper for callers that just want the ToolSet and
 * don't care about diagnostics.
 */
export async function getMcpTools(
  opts: BuildMcpToolSetOptions = {},
): Promise<ToolSet> {
  const { tools } = await buildMcpToolSet(opts);
  return tools;
}

import { randomUUID } from "node:crypto";
import log from "electron-log";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { agentOsAgents } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { createTypedHandler } from "./base";
import { safeSend } from "../utils/safe_sender";
import {
  parseAgentReply,
  resolveImageBaseUrl,
} from "../utils/hermes_image_urls";
import {
  agentOsContracts,
  type AgentOsAgentDto,
  type AgentOsChatMessage,
  type AgentOsStatus,
  type AgentOsType,
} from "../types/agent_os";

const logger = log.scope("agent_os_handlers");

// Active streaming chat requests, keyed by streamId, so they can be cancelled.
const activeChatStreams = new Map<string, AbortController>();

/** Resolve an agent's OpenAI-compatible chat-completions URL + payload. */
function buildChatRequest(
  row: AgentRow,
  messages: AgentOsChatMessage[],
): { url: string; body: Record<string, unknown> } {
  const base = (row.endpoint ?? "").trim().replace(/\/+$/, "");
  const url = /\/chat\/completions$/i.test(base)
    ? base
    : `${base}/chat/completions`;
  const hasSystem = messages[0]?.role === "system";
  // The agent may run on another machine, so a path on *its* filesystem is
  // useless here. Ask for the bytes instead.
  const imageBaseUrl = resolveImageBaseUrl(row.endpoint, row.imageBaseUrl);
  const systemPrompt = [
    `You are ${row.name}${row.description ? `, ${row.description}` : ""}.`,
    "Respond helpfully and concisely.",
    "When you produce an image, return it inline as a markdown image.",
    imageBaseUrl
      ? `Images you cache locally are served at ${imageBaseUrl}/<filename>, so write ![alt](${imageBaseUrl}/your-file.png).`
      : "Use a data URL (![alt](data:image/png;base64,...)) or a reachable https URL.",
    "Never answer with only a local filesystem path such as /home/you/cache/image.png: the person reading your reply is on a different machine and cannot open it.",
  ].join(" ");
  const payloadMessages = hasSystem
    ? messages
    : [{ role: "system" as const, content: systemPrompt }, ...messages];
  return {
    url,
    body: {
      ...(row.model ? { model: row.model } : {}),
      messages: payloadMessages,
    },
  };
}

function setAgentStatus(id: string, status: AgentOsStatus, bumpTask = false) {
  const patch: Partial<AgentRow> = {
    status,
    lastActivityAt: new Date(),
    updatedAt: new Date(),
  };
  if (bumpTask) {
    const cur = db
      .select()
      .from(agentOsAgents)
      .where(eq(agentOsAgents.id, id))
      .get();
    patch.taskCount = (cur?.taskCount ?? 0) + 1;
  }
  db.update(agentOsAgents).set(patch).where(eq(agentOsAgents.id, id)).run();
}

type AgentRow = typeof agentOsAgents.$inferSelect;

function parseCapabilities(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((c): c is string => typeof c === "string")
      : [];
  } catch {
    return [];
  }
}

function toDto(row: AgentRow): AgentOsAgentDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as AgentOsType,
    endpoint: row.endpoint,
    imageBaseUrl: row.imageBaseUrl,
    model: row.model,
    capabilities: parseCapabilities(row.capabilities),
    icon: row.icon,
    enabled: row.enabled,
    status: row.status as AgentOsStatus,
    taskCount: row.taskCount,
    hasApiKey: Boolean(row.apiKey && row.apiKey.length > 0),
    lastActivityAt: row.lastActivityAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Node's global `fetch` rejects with a generic `TypeError: fetch failed` and
 * hides the real reason on `.cause`. Unwrap it into an actionable message.
 */
function explainNetworkError(e: unknown): string {
  let root: unknown = e;
  for (
    let i = 0;
    i < 4 && root && typeof root === "object" && "cause" in root;
    i++
  ) {
    root = (root as { cause?: unknown }).cause;
  }
  const code =
    (root as { code?: string } | undefined)?.code ??
    (e as { code?: string } | undefined)?.code;
  const base =
    (root as { message?: string } | undefined)?.message ??
    (e instanceof Error ? e.message : String(e));
  const hints: Record<string, string> = {
    ECONNREFUSED:
      "Connection refused — nothing is listening there. If the server runs on this machine, point the endpoint at 127.0.0.1, or configure the server to listen on 0.0.0.0 (all interfaces); otherwise verify the port and firewall.",
    ETIMEDOUT:
      "Timed out — check the IP/port, that the host is on the same network, and that no firewall is blocking it.",
    UND_ERR_CONNECT_TIMEOUT:
      "Connection timed out — check the IP/port and firewall.",
    EHOSTUNREACH:
      "Host unreachable — check the IP and that the host is on the same network.",
    ENETUNREACH: "Network unreachable — check your network connection.",
    ENOTFOUND: "Host not found — double-check the address.",
    ECONNRESET: "The server reset the connection.",
  };
  const hint = code && hints[code] ? ` ${hints[code]}` : "";
  return `${base}${hint}`;
}

function getRowOrThrow(id: string): AgentRow {
  const row = db
    .select()
    .from(agentOsAgents)
    .where(eq(agentOsAgents.id, id))
    .get();
  if (!row) {
    throw new DyadError(`Agent ${id} not found`, DyadErrorKind.External);
  }
  return row;
}

/**
 * Cleans up an endpoint before it is stored.
 *
 * People paste from documentation, and what comes across is often the label
 * as well as the value: "URL https://…", "Endpoint: https://…", or the whole
 * thing wrapped in angle brackets. Each of those saves happily and then fails
 * at chat time with a message about the endpoint being missing, which is both
 * true and unhelpful, because the field visibly contains one.
 *
 * So the label is stripped here rather than the user being asked to spot it.
 */
export function normaliseAgentEndpoint(raw: string): string {
  return (
    raw
      .trim()
      // A leading label, with or without a colon.
      .replace(/^(url|endpoint|base\s*url|api)\s*:?\s+/i, "")
      // Markdown or angle-bracket wrapping.
      .replace(/^<+|>+$/g, "")
      .replace(/^\[|\]$/g, "")
      .trim()
  );
}

export function registerAgentOsHandlers() {
  createTypedHandler(agentOsContracts.list, async () => {
    const rows = db.select().from(agentOsAgents).all();
    // Newest first.
    rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return rows.map(toDto);
  });

  createTypedHandler(agentOsContracts.create, async (_, params) => {
    const name = params.name?.trim();
    if (!name) {
      throw new DyadError("Agent name is required", DyadErrorKind.External);
    }
    const id = `agt_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    db.insert(agentOsAgents)
      .values({
        id,
        name,
        description: params.description?.trim() ?? "",
        type: params.type ?? "Custom",
        endpoint: normaliseAgentEndpoint(params.endpoint ?? ""),
        imageBaseUrl: params.imageBaseUrl?.trim() ?? "",
        model: params.model?.trim() ?? "",
        apiKey: params.apiKey?.trim() ? params.apiKey.trim() : null,
        capabilities: JSON.stringify(
          (params.capabilities ?? [])
            .map((c) => c.trim())
            .filter((c) => c.length > 0),
        ),
        icon: params.icon?.trim() || "🤖",
        enabled: true,
        status: "idle",
        taskCount: 0,
      })
      .run();
    logger.log(`Created agent ${id} (${name})`);
    return toDto(getRowOrThrow(id));
  });

  createTypedHandler(agentOsContracts.update, async (_, params) => {
    const existing = getRowOrThrow(params.id);
    const update: Partial<AgentRow> = { updatedAt: new Date() };
    if (params.name !== undefined) update.name = params.name.trim();
    if (params.description !== undefined)
      update.description = params.description.trim();
    if (params.type !== undefined) update.type = params.type;
    if (params.endpoint !== undefined)
      update.endpoint = normaliseAgentEndpoint(params.endpoint);
    if (params.imageBaseUrl !== undefined)
      update.imageBaseUrl = params.imageBaseUrl.trim();
    if (params.model !== undefined) update.model = params.model.trim();
    if (params.icon !== undefined) update.icon = params.icon.trim() || "🤖";
    if (params.capabilities !== undefined) {
      update.capabilities = JSON.stringify(
        params.capabilities.map((c) => c.trim()).filter((c) => c.length > 0),
      );
    }
    // apiKey: undefined => leave untouched; "" => clear; value => set.
    if (params.apiKey !== undefined) {
      update.apiKey = params.apiKey.trim() ? params.apiKey.trim() : null;
    }
    db.update(agentOsAgents)
      .set(update)
      .where(eq(agentOsAgents.id, existing.id))
      .run();
    return toDto(getRowOrThrow(existing.id));
  });

  createTypedHandler(agentOsContracts.toggle, async (_, params) => {
    const existing = getRowOrThrow(params.id);
    db.update(agentOsAgents)
      .set({
        enabled: params.enabled,
        status: params.enabled ? "idle" : "offline",
        lastActivityAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentOsAgents.id, existing.id))
      .run();
    return toDto(getRowOrThrow(existing.id));
  });

  createTypedHandler(
    agentOsContracts.chat,
    async (_, { agentId, messages }) => {
      const row = getRowOrThrow(agentId);
      const endpoint = row.endpoint?.trim();
      if (!endpoint || !/^https?:\/\//i.test(endpoint)) {
        throw new DyadError(
          `Agent "${row.name}" has no HTTP endpoint configured. Add an https:// endpoint (an OpenAI-compatible /chat/completions API) in the agent settings.`,
          DyadErrorKind.External,
        );
      }

      // Resolve the chat-completions URL (accept either a base URL or a full one).
      const base = endpoint.replace(/\/+$/, "");
      const url = /\/chat\/completions$/i.test(base)
        ? base
        : `${base}/chat/completions`;

      // Ensure a system prompt grounds the agent persona.
      const hasSystem = messages[0]?.role === "system";
      const systemPrompt = `You are ${row.name}${
        row.description ? `, ${row.description}` : ""
      }. Respond helpfully and concisely.`;
      const payloadMessages = hasSystem
        ? messages
        : [{ role: "system" as const, content: systemPrompt }, ...messages];

      const markError = () =>
        db
          .update(agentOsAgents)
          .set({
            status: "error",
            lastActivityAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(agentOsAgents.id, row.id))
          .run();

      const timeoutMs = 120_000;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let resp: Response;
      try {
        resp = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(row.apiKey ? { Authorization: `Bearer ${row.apiKey}` } : {}),
          },
          body: JSON.stringify({
            ...(row.model ? { model: row.model } : {}),
            messages: payloadMessages,
            stream: false,
          }),
          signal: controller.signal,
        });
      } catch (e) {
        markError();
        if ((e as { name?: string })?.name === "AbortError") {
          throw new DyadError(
            `Request to ${url} timed out after ${
              timeoutMs / 1000
            }s. The endpoint may be slow, blocked, or unreachable.`,
            DyadErrorKind.External,
          );
        }
        logger.error(`agent-os chat fetch failed for ${url}:`, e);
        throw new DyadError(
          `Could not reach ${url} — ${explainNetworkError(e)}`,
          DyadErrorKind.External,
        );
      } finally {
        clearTimeout(timer);
      }

      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        markError();
        throw new DyadError(
          `Agent endpoint returned ${resp.status} ${resp.statusText}. ${body.slice(
            0,
            400,
          )}`,
          DyadErrorKind.External,
        );
      }

      const data = (await resp.json().catch(() => null)) as {
        model?: string;
        choices?: {
          message?: { content?: unknown; images?: unknown };
          text?: unknown;
        }[];
      } | null;
      const choice = data?.choices?.[0];
      const parsed = parseAgentReply(
        choice?.message?.content ?? choice?.text ?? "",
        choice?.message?.images,
        resolveImageBaseUrl(row.endpoint, row.imageBaseUrl),
      );

      // Successful real call — mark the agent online and count the task.
      db.update(agentOsAgents)
        .set({
          status: "online",
          lastActivityAt: new Date(),
          taskCount: row.taskCount + 1,
          updatedAt: new Date(),
        })
        .where(eq(agentOsAgents.id, row.id))
        .run();

      return {
        content: parsed.text,
        images: parsed.images,
        model: data?.model ?? row.model ?? "",
      };
    },
  );

  // Streaming chat — emits tokens as they arrive (SSE) for low perceived latency.
  createTypedHandler(
    agentOsContracts.chatStart,
    async (event, { streamId, agentId, messages }) => {
      const sender = event.sender;
      const chunkCh = "agent-os:chat:chunk";
      const endCh = "agent-os:chat:end";
      const errCh = "agent-os:chat:error";
      const fail = (error: string) =>
        safeSend(sender, errCh, { streamId, error });

      let row: AgentRow;
      try {
        row = getRowOrThrow(agentId);
      } catch {
        fail("Agent not found.");
        return { ok: true as const };
      }

      const endpoint = row.endpoint?.trim();
      if (!endpoint || !/^https?:\/\//i.test(endpoint)) {
        fail(
          `Agent "${row.name}" has no HTTP endpoint configured. Add an https:// endpoint (an OpenAI-compatible /chat/completions API) in the agent settings.`,
        );
        return { ok: true as const };
      }

      const imageBaseUrl = resolveImageBaseUrl(row.endpoint, row.imageBaseUrl);
      const { url, body } = buildChatRequest(row, messages);
      const controller = new AbortController();
      activeChatStreams.set(streamId, controller);
      // Guard only the connection phase; streaming itself may run long.
      let connected = false;
      const connectTimer = setTimeout(() => {
        if (!connected) controller.abort();
      }, 60_000);

      let full = "";
      let model = row.model ?? "";
      const images: string[] = [];
      const addImages = (nextImages: string[]) => {
        for (const image of nextImages) {
          if (!images.includes(image)) images.push(image);
        }
      };
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            ...(row.apiKey ? { Authorization: `Bearer ${row.apiKey}` } : {}),
          },
          body: JSON.stringify({ ...body, stream: true }),
          signal: controller.signal,
        });
        connected = true;
        clearTimeout(connectTimer);

        if (!resp.ok) {
          const errBody = await resp.text().catch(() => "");
          setAgentStatus(row.id, "error");
          fail(
            `Agent endpoint returned ${resp.status} ${resp.statusText}. ${errBody.slice(
              0,
              400,
            )}`,
          );
          return { ok: true as const };
        }

        const ctype = resp.headers.get("content-type") ?? "";
        if (ctype.includes("text/event-stream") && resp.body) {
          // Parse Server-Sent Events: lines of `data: {json}` / `data: [DONE]`.
          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              const t = line.trim();
              if (!t.startsWith("data:")) continue;
              const payload = t.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              try {
                const json = JSON.parse(payload);
                model = json.model ?? model;
                const choice = json.choices?.[0];
                const parsed = parseAgentReply(
                  choice?.delta?.content ??
                    choice?.message?.content ??
                    choice?.text ??
                    "",
                  choice?.delta?.images ??
                    choice?.message?.images ??
                    json.images,
                  imageBaseUrl,
                );
                addImages(parsed.images);
                if (parsed.text) {
                  full += parsed.text;
                  safeSend(sender, chunkCh, {
                    streamId,
                    delta: parsed.text,
                  });
                }
              } catch {
                // Ignore partial / non-JSON keepalive lines.
              }
            }
          }
        } else {
          // Endpoint ignored stream:true — fall back to a single JSON response.
          const data = (await resp.json().catch(() => null)) as {
            model?: string;
            images?: unknown;
            choices?: {
              message?: { content?: unknown; images?: unknown };
              text?: unknown;
            }[];
          } | null;
          model = data?.model ?? model;
          const choice = data?.choices?.[0];
          const parsed = parseAgentReply(
            choice?.message?.content ?? choice?.text ?? "",
            choice?.message?.images ?? data?.images,
            imageBaseUrl,
          );
          full = parsed.text;
          addImages(parsed.images);
          if (full) safeSend(sender, chunkCh, { streamId, delta: full });
        }

        setAgentStatus(row.id, "online", true);
        safeSend(sender, endCh, {
          streamId,
          content: full,
          model,
          images,
        });
      } catch (e) {
        clearTimeout(connectTimer);
        setAgentStatus(row.id, "error");
        if ((e as { name?: string })?.name === "AbortError") {
          // Cancelled by the user, or connection timed out before first byte.
          if (connected) {
            safeSend(sender, endCh, {
              streamId,
              content: full,
              model,
              images,
            });
          } else {
            fail(`Request to ${url} timed out before the endpoint responded.`);
          }
        } else {
          logger.error(`agent-os chat stream failed for ${url}:`, e);
          fail(`Could not reach ${url} — ${explainNetworkError(e)}`);
        }
      } finally {
        clearTimeout(connectTimer);
        activeChatStreams.delete(streamId);
      }

      return { ok: true as const };
    },
  );

  createTypedHandler(agentOsContracts.chatCancel, async (_, streamId) => {
    activeChatStreams.get(streamId)?.abort();
    activeChatStreams.delete(streamId);
    return { ok: true as const };
  });

  createTypedHandler(agentOsContracts.delete, async (_, id) => {
    db.delete(agentOsAgents).where(eq(agentOsAgents.id, id)).run();
    logger.log(`Deleted agent ${id}`);
  });
}

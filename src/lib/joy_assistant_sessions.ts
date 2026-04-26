/**
 * Joy Assistant — Persistent Session Store
 *
 * File-backed storage for assistant conversation sessions, so threads survive
 * app restarts. Backed by `userData/joy-assistant/sessions.json`.
 *
 * Layout on disk:
 *   {
 *     "version": 1,
 *     "sessions": [ AssistantSession, ... ]
 *   }
 *
 * Writes are debounced (250 ms) to avoid hammering disk during streaming.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import log from "electron-log";
import { getUserDataPath } from "../paths/paths";
import type {
  AssistantMessage,
  AssistantMode,
  AssistantSession,
} from "@/types/joy_assistant_types";

const logger = log.scope("joy-assistant-sessions");

const STORE_VERSION = 1;
const MAX_SESSIONS = 100;
const MAX_MESSAGES_PER_SESSION = 200;

interface SessionMeta {
  /** Optional human-friendly title (auto-derived from first user message) */
  title?: string;
  /** Last activity (ms since epoch) */
  lastActiveAt?: number;
}

export interface PersistentAssistantSession extends AssistantSession {
  meta: SessionMeta;
}

interface StoreFile {
  version: number;
  sessions: PersistentAssistantSession[];
}

// ── State ───────────────────────────────────────────────────────────────────

const cache = new Map<string, PersistentAssistantSession>();
let loaded = false;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function getStorePath(): string {
  return path.join(getUserDataPath(), "joy-assistant", "sessions.json");
}

function loadFromDisk(): void {
  if (loaded) return;
  loaded = true;
  const file = getStorePath();
  try {
    if (!fs.existsSync(file)) return;
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw) as StoreFile;
    if (parsed?.version !== STORE_VERSION || !Array.isArray(parsed.sessions)) return;
    for (const s of parsed.sessions) {
      if (!s?.id) continue;
      cache.set(s.id, {
        id: s.id,
        messages: Array.isArray(s.messages) ? s.messages : [],
        mode: (s.mode as AssistantMode) ?? "auto",
        createdAt: s.createdAt ?? Date.now(),
        meta: {
          title: s.meta?.title,
          lastActiveAt: s.meta?.lastActiveAt ?? s.createdAt ?? Date.now(),
        },
      });
    }
    logger.info(`Loaded ${cache.size} assistant session(s) from disk`);
  } catch (err) {
    logger.warn("Failed to load assistant sessions from disk:", err);
  }
}

function scheduleWrite(): void {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    writeNow();
  }, 250);
}

function writeNow(): void {
  const file = getStorePath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Trim history per-session and overall session count (oldest first)
    const all = Array.from(cache.values())
      .sort(
        (a, b) =>
          (b.meta.lastActiveAt ?? b.createdAt) - (a.meta.lastActiveAt ?? a.createdAt),
      )
      .slice(0, MAX_SESSIONS)
      .map((s) => ({
        ...s,
        messages: s.messages.slice(-MAX_MESSAGES_PER_SESSION),
      }));
    const data: StoreFile = { version: STORE_VERSION, sessions: all };
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    logger.warn("Failed to persist assistant sessions:", err);
  }
}

function deriveTitle(messages: AssistantMessage[]): string | undefined {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser?.content) return undefined;
  const t = firstUser.content.trim().replace(/\s+/g, " ");
  return t.length > 60 ? `${t.slice(0, 60)}…` : t;
}

// ── Public API ──────────────────────────────────────────────────────────────

export function getOrCreateSession(sessionId: string): PersistentAssistantSession {
  loadFromDisk();
  let s = cache.get(sessionId);
  if (!s) {
    s = {
      id: sessionId,
      messages: [],
      mode: "auto",
      createdAt: Date.now(),
      meta: { lastActiveAt: Date.now() },
    };
    cache.set(sessionId, s);
    scheduleWrite();
  }
  return s;
}

export function getSessionById(
  sessionId: string,
): PersistentAssistantSession | undefined {
  loadFromDisk();
  return cache.get(sessionId);
}

export function touchSession(sessionId: string): void {
  const s = cache.get(sessionId);
  if (!s) return;
  s.meta.lastActiveAt = Date.now();
  if (!s.meta.title) {
    s.meta.title = deriveTitle(s.messages);
  }
  scheduleWrite();
}

export function deleteSessionById(sessionId: string): void {
  loadFromDisk();
  if (cache.delete(sessionId)) scheduleWrite();
}

export function clearSessionMessages(sessionId: string): void {
  loadFromDisk();
  const s = cache.get(sessionId);
  if (!s) return;
  s.messages = [];
  s.meta.title = undefined;
  s.meta.lastActiveAt = Date.now();
  scheduleWrite();
}

export function setSessionTitle(sessionId: string, title: string): void {
  loadFromDisk();
  const s = cache.get(sessionId);
  if (!s) return;
  s.meta.title = title.trim().slice(0, 100) || undefined;
  scheduleWrite();
}

export function listSessions(): Array<{
  id: string;
  title: string;
  mode: AssistantMode;
  createdAt: number;
  lastActiveAt: number;
  messageCount: number;
}> {
  loadFromDisk();
  return Array.from(cache.values())
    .map((s) => ({
      id: s.id,
      title: s.meta.title || deriveTitle(s.messages) || "New conversation",
      mode: s.mode,
      createdAt: s.createdAt,
      lastActiveAt: s.meta.lastActiveAt ?? s.createdAt,
      messageCount: s.messages.length,
    }))
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}

/** Drop the trailing assistant message (used for regenerate). Returns the prior user message text, if any. */
export function popLastAssistantMessage(sessionId: string): string | undefined {
  loadFromDisk();
  const s = cache.get(sessionId);
  if (!s || s.messages.length === 0) return undefined;
  const last = s.messages[s.messages.length - 1];
  if (last.role !== "assistant") return undefined;
  s.messages.pop();
  // Find the most recent user message (now at the tail)
  const userMsg = [...s.messages].reverse().find((m) => m.role === "user");
  s.meta.lastActiveAt = Date.now();
  scheduleWrite();
  return userMsg?.content;
}

/** Force flush — useful before app quit. */
export function flushSessions(): void {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  writeNow();
}

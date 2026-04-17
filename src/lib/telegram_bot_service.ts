/**
 * Native Telegram Bot Service
 *
 * Connects directly to the Telegram Bot API using long-polling for incoming
 * messages and the sendMessage/sendPhoto/sendDocument endpoints for outbound.
 *
 * Stores the bot token in the OpenClaw gateway config (persisted to disk).
 * Emits events that integrate with the existing OpenClaw event pipeline.
 */

import { EventEmitter } from "node:events";
import log from "electron-log";

const logger = log.scope("telegram-bot");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TelegramBotConfig {
  /** Bot token from @BotFather */
  token: string;
  /** Whether to auto-start polling on initialize() */
  enabled: boolean;
  /** Optional allowed chat IDs (empty = allow all) */
  allowedChatIds?: string[];
}

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  reply_to_message?: TelegramMessage;
  photo?: Array<{ file_id: string; file_unique_id: string; width: number; height: number; file_size?: number }>;
  document?: { file_id: string; file_unique_id: string; file_name?: string; mime_type?: string; file_size?: number };
  voice?: { file_id: string; file_unique_id: string; duration: number; mime_type?: string; file_size?: number };
  audio?: { file_id: string; file_unique_id: string; duration: number; performer?: string; title?: string; mime_type?: string; file_size?: number };
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
}

export interface TelegramBotStatus {
  running: boolean;
  botUsername?: string;
  botId?: number;
  lastPollAt?: number;
  totalMessagesReceived: number;
  totalMessagesSent: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class TelegramBotService extends EventEmitter {
  private static instance: TelegramBotService;

  private config: TelegramBotConfig = { token: "", enabled: false };
  private polling = false;
  private pollAbort: AbortController | null = null;
  private lastUpdateId = 0;
  private botUser: TelegramUser | null = null;
  private totalReceived = 0;
  private totalSent = 0;
  private lastPollAt?: number;
  private lastError?: string;
  private consecutiveErrors = 0;
  private consecutive409Reclaims = 0;
  private restarting = false;

  private constructor() {
    super();
  }

  static getInstance(): TelegramBotService {
    if (!TelegramBotService.instance) {
      TelegramBotService.instance = new TelegramBotService();
    }
    return TelegramBotService.instance;
  }

  // =========================================================================
  // LIFECYCLE
  // =========================================================================

  /** Update config and optionally (re-)start polling */
  async configure(config: Partial<TelegramBotConfig>): Promise<void> {
    const tokenChanged = config.token !== undefined && config.token !== this.config.token;
    this.config = { ...this.config, ...config };

    if (tokenChanged && this.config.token) {
      // Stop existing polling if token changed
      await this.stop();
      // Reset bot user so start() re-validates
      this.botUser = null;
      // Validate the new token immediately
      await this.validateToken();
    }

    if (this.config.enabled && this.config.token && !this.polling) {
      await this.start();
    } else if (!this.config.enabled && this.polling) {
      await this.stop();
    }
  }

  /** Validate the bot token by calling getMe */
  async validateToken(): Promise<TelegramUser> {
    if (!this.config.token) throw new Error("Telegram bot token is not set");
    const me = await this.apiCall<TelegramUser>("getMe");
    this.botUser = me;
    logger.info(`Telegram bot validated: @${me.username} (ID: ${me.id})`);
    return me;
  }

  /** Start long-polling */
  async start(): Promise<void> {
    if (this.polling || this.restarting) return;
    if (!this.config.token) throw new Error("Cannot start: no bot token configured");

    this.restarting = true;
    try {
      // Validate token first if we haven't yet
      if (!this.botUser) {
        await this.validateToken();
      }

      // Claim the polling session: clear any webhook and terminate stale
      // long-poll connections held by a previous process / instance.
      await this.claimPollingSession();

      this.polling = true;
      this.consecutiveErrors = 0;
      this.lastError = undefined;
      logger.info(`Telegram bot polling started (@${this.botUser?.username})`);
      this.emit("started", { username: this.botUser?.username });

      // Fire and forget — runs in background
      this.pollLoop();
    } finally {
      this.restarting = false;
    }
  }

  /**
   * Claim the Telegram polling session by:
   * 1. Deleting any active webhook (so long-polling is allowed).
   * 2. Sending a short getUpdates (timeout=0) to terminate stale long-poll
   *    connections from a previous process using the same token.
   * This prevents the dreaded 409 "Conflict: terminated by other getUpdates
   * request" error on startup.
   */
  private async claimPollingSession(): Promise<void> {
    try {
      await this.apiCall("deleteWebhook", { drop_pending_updates: false });
      logger.info("Cleared any existing Telegram webhook");
    } catch (err) {
      logger.warn("deleteWebhook failed (non-fatal):", err);
    }

    try {
      // Short non-blocking getUpdates terminates any stale long-poll
      await this.apiCall("getUpdates", { offset: -1, limit: 1, timeout: 0 });
      logger.info("Terminated stale polling session (if any)");
    } catch (err) {
      logger.warn("Session-claim getUpdates failed (non-fatal):", err);
    }
  }

  /** Stop long-polling */
  async stop(): Promise<void> {
    if (!this.polling) return;
    this.polling = false;
    this.restarting = false;
    this.pollAbort?.abort();
    this.pollAbort = null;
    logger.info("Telegram bot polling stopped");
    this.emit("stopped");
  }

  getStatus(): TelegramBotStatus {
    return {
      running: this.polling,
      botUsername: this.botUser?.username,
      botId: this.botUser?.id,
      lastPollAt: this.lastPollAt,
      totalMessagesReceived: this.totalReceived,
      totalMessagesSent: this.totalSent,
      error: this.lastError,
    };
  }

  getConfig(): TelegramBotConfig {
    return {
      ...this.config,
      // Never expose the full token — mask it
      token: this.config.token
        ? `${this.config.token.slice(0, 6)}...${this.config.token.slice(-4)}`
        : "",
    };
  }

  /** Returns true if bot has a valid token configured (even if not polling) */
  isConfigured(): boolean {
    return !!this.config.token && this.config.token.length > 20;
  }

  /** Load the raw token (only for internal use by handlers) */
  getRawToken(): string {
    return this.config.token;
  }

  // =========================================================================
  // SEND
  // =========================================================================

  /** Send a text message to a Telegram chat */
  async sendMessage(chatId: string | number, text: string, options?: {
    parseMode?: "HTML" | "Markdown" | "MarkdownV2";
    replyToMessageId?: number;
    disableNotification?: boolean;
  }): Promise<TelegramMessage> {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
    };
    if (options?.parseMode) body.parse_mode = options.parseMode;
    if (options?.replyToMessageId) body.reply_to_message_id = options.replyToMessageId;
    if (options?.disableNotification) body.disable_notification = true;

    const result = await this.apiCall<TelegramMessage>("sendMessage", body);
    this.totalSent++;
    this.emit("message-sent", {
      chatId,
      messageId: result.message_id,
      text,
    });
    return result;
  }

  /** Send a chat action (e.g. "typing") to indicate the bot is processing */
  async sendChatAction(chatId: string | number, action: "typing" | "upload_photo" | "upload_video" | "upload_document" = "typing"): Promise<void> {
    await this.apiCall<boolean>("sendChatAction", {
      chat_id: chatId,
      action,
    });
  }

  /** Send a photo to a Telegram chat via URL */
  async sendPhoto(chatId: string | number, photoUrl: string, caption?: string): Promise<TelegramMessage> {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      photo: photoUrl,
    };
    if (caption) body.caption = caption;

    const result = await this.apiCall<TelegramMessage>("sendPhoto", body);
    this.totalSent++;
    return result;
  }

  /** Send a local image file to a Telegram chat via multipart upload */
  async sendPhotoFile(chatId: string | number, filePath: string, caption?: string): Promise<TelegramMessage> {
    const { readFile } = await import("node:fs/promises");
    const { basename } = await import("node:path");

    const fileBuffer = await readFile(filePath);
    const filename = basename(filePath);

    const formData = new FormData();
    formData.append("chat_id", String(chatId));
    formData.append("photo", new Blob([fileBuffer], { type: "image/png" }), filename);
    if (caption) formData.append("caption", caption);

    const url = `https://api.telegram.org/bot${this.config.token}/sendPhoto`;
    const resp = await fetch(url, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Telegram sendPhoto (file) failed (${resp.status}): ${text}`);
    }

    const json = (await resp.json()) as { ok: boolean; result: TelegramMessage; description?: string };
    if (!json.ok) throw new Error(`Telegram sendPhoto error: ${json.description || "unknown"}`);

    this.totalSent++;
    return json.result;
  }

  /** Send a video file to a Telegram chat via multipart upload */
  async sendVideoFile(chatId: string | number, filePath: string, caption?: string): Promise<TelegramMessage> {
    const { readFile } = await import("node:fs/promises");
    const { basename, extname } = await import("node:path");

    const fileBuffer = await readFile(filePath);
    const filename = basename(filePath);
    const ext = extname(filename).toLowerCase();
    const mimeType = ext === ".mp4" ? "video/mp4" : ext === ".gif" ? "image/gif" : "video/mp4";
    const endpoint = ext === ".gif" ? "sendAnimation" : "sendVideo";

    const formData = new FormData();
    formData.append("chat_id", String(chatId));
    formData.append(ext === ".gif" ? "animation" : "video", new Blob([fileBuffer], { type: mimeType }), filename);
    if (caption) formData.append("caption", caption);

    const url = `https://api.telegram.org/bot${this.config.token}/${endpoint}`;
    const resp = await fetch(url, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(120000),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Telegram ${endpoint} (file) failed (${resp.status}): ${text}`);
    }

    const json = (await resp.json()) as { ok: boolean; result: TelegramMessage; description?: string };
    if (!json.ok) throw new Error(`Telegram ${endpoint} error: ${json.description || "unknown"}`);

    this.totalSent++;
    return json.result;
  }

  // =========================================================================
  // INTERNAL — Polling
  // =========================================================================

  private async pollLoop(): Promise<void> {
    while (this.polling) {
      try {
        this.pollAbort = new AbortController();
        const updates = await this.apiCall<TelegramUpdate[]>("getUpdates", {
          offset: this.lastUpdateId + 1,
          timeout: 25,
          allowed_updates: ["message", "edited_message", "channel_post"],
        }, this.pollAbort.signal);

        this.lastPollAt = Date.now();
        this.consecutiveErrors = 0; // reset on success
        this.consecutive409Reclaims = 0; // reset on success

        for (const update of updates) {
          this.lastUpdateId = update.update_id;
          const msg = update.message || update.edited_message || update.channel_post;
          if (!msg) continue;

          // Enforce chat allowlist if configured
          if (
            this.config.allowedChatIds?.length &&
            !this.config.allowedChatIds.includes(String(msg.chat.id))
          ) {
            continue;
          }

          this.totalReceived++;
          this.handleIncoming(msg);
        }
      } catch (err: any) {
        if (err?.name === "AbortError" || !this.polling) break;

        this.consecutiveErrors++;
        this.lastError = err?.message || String(err);
        logger.error(`Telegram poll error (#${this.consecutiveErrors}):`, this.lastError);
        this.emit("error", { error: this.lastError });

        // Detect fatal errors — stop polling, let the watchdog decide whether to restart
        const errMsg: string = this.lastError || "";
        const status = this.extractHttpStatus(errMsg);
        if (status === 401 || status === 403) {
          logger.error("Telegram bot token is invalid or revoked (HTTP " + status + ") — stopping polling");
          this.polling = false;
          this.emit("fatal-error", { error: this.lastError, status });
          break;
        }
        if (status === 409) {
          this.consecutive409Reclaims++;
          if (this.consecutive409Reclaims >= 3) {
            logger.error(`409 Conflict persisted after ${this.consecutive409Reclaims} reclaim attempts — another bot instance is running on the same token. Stopping.`);
            this.polling = false;
            this.lastError = "409 Conflict: another bot instance is running on the same token. Stop the other instance or disable the local bot.";
            this.emit("conflict", { error: this.lastError });
            break;
          }
          // Another poller is active on the same token — try to reclaim
          logger.warn(`Telegram 409 Conflict — reclaim attempt ${this.consecutive409Reclaims}/3…`);
          try {
            await this.claimPollingSession();
            // Wait a moment before retrying to let the other poller's connection fully terminate
            await new Promise((r) => setTimeout(r, 2000));
            logger.info("Session reclaimed after 409 — resuming polling");
            continue; // retry the poll loop
          } catch {
            logger.error("Failed to reclaim session — stopping. Watchdog will retry later.");
            this.polling = false;
            this.emit("conflict", { error: this.lastError });
            break;
          }
        }

        // Exponential backoff: 5s, 10s, 20s, 40s ... capped at 60s
        const backoff = Math.min(5000 * Math.pow(2, this.consecutiveErrors - 1), 60000);
        logger.warn(`Telegram poll backoff: ${Math.round(backoff / 1000)}s (attempt ${this.consecutiveErrors})`);
        await new Promise((r) => setTimeout(r, backoff));

        // After too many consecutive errors, stop and let the watchdog try later
        if (this.consecutiveErrors >= 10) {
          logger.error("Telegram bot exceeded 10 consecutive poll errors — stopping for watchdog recovery");
          this.polling = false;
          this.emit("error", { error: "Exceeded max consecutive errors — stopped polling" });
          break;
        }
      }
    }

    // If pollLoop exits while polling flag is still true, something unexpected
    // happened — log it but don't self-restart. The 60s watchdog in main.ts
    // will detect the bot is down and restart it cleanly.
    if (this.polling) {
      logger.warn("Telegram pollLoop exited unexpectedly while polling=true — marking as stopped for watchdog recovery");
      this.polling = false;
      this.emit("stopped");
    }
  }

  private handleIncoming(msg: TelegramMessage): void {
    const text = msg.text || msg.caption || "";
    const sender = msg.from || { id: 0, is_bot: false, first_name: "Unknown" };

    const chatName =
      msg.chat.title ||
      [msg.chat.first_name, msg.chat.last_name].filter(Boolean).join(" ") ||
      String(msg.chat.id);

    const event = {
      type: "message:received" as const,
      channel: "telegram" as const,
      platform: "telegram",
      messageId: msg.message_id,
      chatId: String(msg.chat.id),
      chatName,
      chatType: msg.chat.type,
      content: text,
      contentType: msg.voice ? "voice" : msg.audio ? "audio" : msg.photo ? "photo" : msg.document ? "document" : "text",
      from: {
        id: sender.id,
        userId: String(sender.id),
        username: sender.username || "",
        displayName: [sender.first_name, sender.last_name].filter(Boolean).join(" "),
        isBot: sender.is_bot,
      },
      replyTo: msg.reply_to_message
        ? {
            id: msg.reply_to_message.message_id,
            content: msg.reply_to_message.text || msg.reply_to_message.caption || "",
          }
        : undefined,
      timestamp: msg.date * 1000,
      voiceFileId: msg.voice?.file_id || msg.audio?.file_id || undefined,
    };

    logger.info(`[Telegram] Message from @${sender.username || sender.first_name} in ${chatName}: ${text.slice(0, 80)}`);

    this.emit("message", event);
    // Also emit using the OpenClaw event format for the gateway to pick up
    this.emit("openclaw:channel-message", event);
  }

  /** Extract an HTTP status code from an error message, if present */
  private extractHttpStatus(msg: string): number | null {
    const match = msg?.match(/\((\d{3})\)/);
    return match ? Number(match[1]) : null;
  }

  // =========================================================================
  // INTERNAL — API
  // =========================================================================

  private async apiCall<T>(
    method: string,
    body?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const url = `https://api.telegram.org/bot${this.config.token}/${method}`;

    // Use a generous timeout for long-polling (getUpdates uses 25s server timeout)
    const timeoutMs = method === "getUpdates" ? 60000 : 15000;

    // Combine external signal + timeout: if either fires, the request aborts
    const timeoutAbort = AbortSignal.timeout(timeoutMs);
    const effectiveSignal = signal
      ? AbortSignal.any([signal, timeoutAbort])
      : timeoutAbort;

    const fetchOpts: RequestInit = {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      signal: effectiveSignal,
    };
    if (body) fetchOpts.body = JSON.stringify(body);

    const resp = await fetch(url, fetchOpts);

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Telegram API ${method} failed (${resp.status}): ${text}`);
    }

    const json = (await resp.json()) as { ok: boolean; result: T; description?: string };
    if (!json.ok) {
      throw new Error(`Telegram API ${method} error: ${json.description || "unknown"}`);
    }
    return json.result;
  }

  /**
   * Download a file from Telegram by file_id.
   * Uses getFile API to get the file path, then fetches the file content.
   */
  async downloadFile(fileId: string, outputPath: string): Promise<void> {
    const fileInfo = await this.apiCall<{ file_id: string; file_path: string }>("getFile", { file_id: fileId });
    const fileUrl = `https://api.telegram.org/file/bot${this.config.token}/${fileInfo.file_path}`;

    const resp = await fetch(fileUrl);
    if (!resp.ok) throw new Error(`Failed to download Telegram file: ${resp.status}`);

    const buffer = Buffer.from(await resp.arrayBuffer());
    const fs = await import("fs/promises");
    await fs.writeFile(outputPath, buffer);
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const getTelegramBot = () => TelegramBotService.getInstance();
export default TelegramBotService;

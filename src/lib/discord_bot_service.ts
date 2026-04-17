/**
 * Native Discord Bot Service
 *
 * Connects to Discord via discord.js using the Gateway WebSocket.
 * Listens for messages, routes them through the OpenClaw event pipeline,
 * and provides send/reply methods for outbound messages.
 *
 * Stores the bot token in the OpenClaw gateway config (persisted to disk).
 * Emits events that integrate with the existing OpenClaw event pipeline.
 */

import { EventEmitter } from "node:events";
import log from "electron-log";

const logger = log.scope("discord-bot");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscordBotConfig {
  /** Bot token from Discord Developer Portal */
  token: string;
  /** Whether to auto-login on initialize() */
  enabled: boolean;
  /** Optional allowed guild IDs (empty = allow all) */
  allowedGuildIds?: string[];
  /** Optional allowed channel IDs (empty = allow all) */
  allowedChannelIds?: string[];
}

export interface DiscordBotStatus {
  running: boolean;
  botUsername?: string;
  botId?: string;
  botDiscriminator?: string;
  guildCount: number;
  lastMessageAt?: number;
  totalMessagesReceived: number;
  totalMessagesSent: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class DiscordBotService extends EventEmitter {
  private static instance: DiscordBotService;

  private config: DiscordBotConfig = { token: "", enabled: false };
  private client: any = null; // discord.js Client — lazy loaded
  private running = false;
  private totalReceived = 0;
  private totalSent = 0;
  private lastMessageAt?: number;
  private lastError?: string;
  private botUsername?: string;
  private botId?: string;
  private botDiscriminator?: string;
  private guildCount = 0;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnecting = false;

  private constructor() {
    super();
  }

  static getInstance(): DiscordBotService {
    if (!DiscordBotService.instance) {
      DiscordBotService.instance = new DiscordBotService();
    }
    return DiscordBotService.instance;
  }

  // =========================================================================
  // LIFECYCLE
  // =========================================================================

  /** Update config and optionally (re-)start the bot */
  async configure(config: Partial<DiscordBotConfig>): Promise<void> {
    const tokenChanged = config.token !== undefined && config.token !== this.config.token;
    this.config = { ...this.config, ...config };

    if (tokenChanged && this.config.token) {
      await this.stop();
    }

    if (this.config.enabled && this.config.token && !this.running) {
      await this.start();
    } else if (!this.config.enabled && this.running) {
      await this.stop();
    }
  }

  /** Validate the bot token by attempting to fetch the bot user */
  async validateToken(token?: string): Promise<{ id: string; username: string; discriminator: string }> {
    const t = token || this.config.token;
    if (!t) throw new Error("Discord bot token is not set");

    const resp = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bot ${t}` },
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Invalid Discord bot token (${resp.status}): ${text}`);
    }

    const user = (await resp.json()) as { id: string; username: string; discriminator: string };
    logger.info(`Discord bot validated: ${user.username}#${user.discriminator} (ID: ${user.id})`);
    return user;
  }

  /** Start the Discord bot (login + listen for messages) */
  async start(): Promise<void> {
    if (this.running) return;
    if (!this.config.token) throw new Error("Cannot start: no bot token configured");

    try {
      // Lazy-load discord.js to avoid bundling issues
      const { Client, GatewayIntentBits, Partials } = await import("discord.js");

      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.DirectMessages,
        ],
        partials: [Partials.Channel, Partials.Message],
      });

      // ── Ready ──
      this.client.once("ready", () => {
        const user = this.client.user;
        this.botUsername = user?.username;
        this.botId = user?.id;
        this.botDiscriminator = user?.discriminator;
        this.guildCount = this.client.guilds?.cache?.size ?? 0;
        this.running = true;
        this.lastError = undefined;

        logger.info(
          `Discord bot online: ${this.botUsername}#${this.botDiscriminator} (${this.guildCount} guilds)`,
        );
        this.emit("started", {
          username: this.botUsername,
          id: this.botId,
          guildCount: this.guildCount,
        });
      });

      // ── Message Create ──
      this.client.on("messageCreate", (message: any) => {
        this.handleIncoming(message);
      });

      // ── Error / Disconnect ──
      this.client.on("error", (err: Error) => {
        this.lastError = err.message;
        logger.error("Discord client error:", err.message);
        this.emit("error", { error: err.message });
      });

      this.client.on("shardDisconnect", (event: any, shardId: number) => {
        logger.warn(`Discord shard ${shardId} disconnected (code: ${event?.code})`);
        // discord.js auto-reconnects on most disconnect codes, but if the
        // client becomes completely dead we need to detect and restart.
        // Schedule a check after 30s to see if it recovered.
        setTimeout(() => {
          if (this.config.enabled && !this.running && !this.reconnecting) {
            logger.warn("Discord did not auto-recover after shard disconnect — attempting reconnect");
            this.attemptReconnect();
          }
        }, 30000);
      });

      this.client.on("shardReconnecting", () => {
        logger.info("Discord shard reconnecting...");
      });

      // Track when discord.js successfully resumes after a disconnect
      this.client.on("shardResume", (_id: number, replayedEvents: number) => {
        logger.info(`Discord shard resumed (replayed ${replayedEvents} events)`);
        this.reconnectAttempts = 0; // reset backoff on successful reconnect
      });

      await this.client.login(this.config.token);

      // Wait for the 'ready' event to fire before returning
      if (!this.running) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Discord bot timed out waiting for ready event"));
          }, 30000);
          this.once("started", () => {
            clearTimeout(timeout);
            resolve();
          });
          this.once("error", (err) => {
            clearTimeout(timeout);
            reject(new Error(err?.error || "Discord login failed"));
          });
        });
      }
    } catch (err: any) {
      this.lastError = err?.message || String(err);
      logger.error("Discord bot login failed:", this.lastError);
      this.emit("error", { error: this.lastError });
      throw err;
    }
  }

  /** Stop the Discord bot */
  async stop(): Promise<void> {
    if (!this.running && !this.client) return;
    this.running = false;
    try {
      if (this.client) {
        this.client.destroy();
        this.client = null;
      }
    } catch {
      // ignore destroy errors
    }
    logger.info("Discord bot stopped");
    this.emit("stopped");
  }

  /**
   * Attempt to reconnect the bot with exponential backoff.
   * Called automatically when the bot dies unexpectedly.
   */
  async attemptReconnect(): Promise<void> {
    if (this.reconnecting) return;
    if (!this.config.enabled || !this.config.token) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error(`Discord bot: exhausted ${this.maxReconnectAttempts} reconnect attempts — giving up until manual restart`);
      return;
    }

    this.reconnecting = true;
    this.reconnectAttempts++;
    const backoff = Math.min(5000 * Math.pow(2, this.reconnectAttempts - 1), 120000); // 5s, 10s, 20s, ... up to 2min
    logger.info(`Discord bot reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${Math.round(backoff / 1000)}s`);

    await new Promise((r) => setTimeout(r, backoff));

    try {
      // Clean up old client
      try {
        if (this.client) {
          this.client.destroy();
          this.client = null;
        }
      } catch { /* ignore */ }

      this.running = false;
      await this.start();
      this.reconnectAttempts = 0; // reset on success
      logger.info("Discord bot reconnected successfully");
    } catch (err: any) {
      logger.error(`Discord bot reconnect attempt ${this.reconnectAttempts} failed:`, err?.message);
    } finally {
      this.reconnecting = false;
    }
  }

  getStatus(): DiscordBotStatus {
    return {
      running: this.running,
      botUsername: this.botUsername,
      botId: this.botId,
      botDiscriminator: this.botDiscriminator,
      guildCount: this.guildCount,
      lastMessageAt: this.lastMessageAt,
      totalMessagesReceived: this.totalReceived,
      totalMessagesSent: this.totalSent,
      error: this.lastError,
    };
  }

  getConfig(): DiscordBotConfig {
    return {
      ...this.config,
      // Never expose the full token — mask it
      token: this.config.token
        ? `${this.config.token.slice(0, 10)}...${this.config.token.slice(-4)}`
        : "",
    };
  }

  /** Returns true if bot has a valid token configured */
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

  /** Send a text message to a Discord channel */
  async sendMessage(
    channelId: string,
    text: string,
    options?: { replyToMessageId?: string },
  ): Promise<{ id: string; content: string }> {
    if (!this.client) throw new Error("Discord bot is not running");

    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !("send" in channel)) {
      throw new Error(`Cannot send to channel ${channelId} — not a text channel`);
    }

    let result: any;
    if (options?.replyToMessageId) {
      try {
        const replyMsg = await (channel as any).messages.fetch(options.replyToMessageId);
        result = await replyMsg.reply(text);
      } catch {
        // Fallback to normal send if reply target not found
        result = await (channel as any).send(text);
      }
    } else {
      result = await (channel as any).send(text);
    }

    this.totalSent++;
    this.emit("message-sent", {
      channelId,
      messageId: result.id,
      text,
    });
    return { id: result.id, content: result.content };
  }

  /** Send a file/image to a Discord channel */
  async sendFile(
    channelId: string,
    filePath: string,
    description?: string,
  ): Promise<{ id: string }> {
    if (!this.client) throw new Error("Discord bot is not running");
    const { AttachmentBuilder } = await import("discord.js");

    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !("send" in channel)) {
      throw new Error(`Cannot send to channel ${channelId} — not a text channel`);
    }

    const attachment = new AttachmentBuilder(filePath);
    const result = await (channel as any).send({
      content: description || undefined,
      files: [attachment],
    });

    this.totalSent++;
    return { id: result.id };
  }

  /** Show typing indicator in a channel */
  async sendTyping(channelId: string): Promise<void> {
    if (!this.client) return;
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (channel && "sendTyping" in channel) {
        await (channel as any).sendTyping();
      }
    } catch {
      // non-critical
    }
  }

  // =========================================================================
  // INTERNAL — Message Handling
  // =========================================================================

  private handleIncoming(message: any): void {
    // Ignore bot messages (including our own)
    if (message.author?.bot) return;

    const guildId = message.guild?.id;
    const channelId = message.channel?.id;

    // Enforce guild allowlist if configured
    if (
      this.config.allowedGuildIds?.length &&
      guildId &&
      !this.config.allowedGuildIds.includes(guildId)
    ) {
      return;
    }

    // Enforce channel allowlist if configured
    if (
      this.config.allowedChannelIds?.length &&
      channelId &&
      !this.config.allowedChannelIds.includes(channelId)
    ) {
      return;
    }

    const text = message.content || "";
    this.totalReceived++;
    this.lastMessageAt = Date.now();

    const isDM = !message.guild;
    const channelName = isDM
      ? `DM:${message.author?.username || "unknown"}`
      : `#${(message.channel as any)?.name || channelId}`;
    const guildName = message.guild?.name || "DM";

    const event = {
      type: "message:received" as const,
      channel: "discord" as const,
      platform: "discord",
      messageId: message.id,
      chatId: channelId,
      chatName: channelName,
      chatType: isDM ? "private" : "guild",
      guildId: guildId || undefined,
      guildName,
      content: text,
      contentType: this.detectContentType(message),
      audioAttachmentUrl: this.findAudioAttachment(message),
      from: {
        id: message.author?.id,
        userId: message.author?.id,
        username: message.author?.username || "",
        displayName: message.member?.displayName || message.author?.globalName || message.author?.username || "",
        isBot: false,
      },
      replyTo: message.reference?.messageId
        ? {
            id: message.reference.messageId,
            content: "",
          }
        : undefined,
      timestamp: message.createdTimestamp || Date.now(),
    };

    logger.info(
      `[Discord] Message from ${event.from.username} in ${guildName}/${channelName}: ${text.slice(0, 80)}`,
    );

    this.emit("message", event);
    // Also emit using the OpenClaw event format for the gateway to pick up
    this.emit("openclaw:channel-message", event);
  }

  private detectContentType(message: any): string {
    if (message.attachments?.size > 0) {
      const audioAttach = message.attachments.find((a: any) =>
        a.contentType?.startsWith("audio/") || a.name?.match(/\.(ogg|mp3|wav|m4a|flac|opus)$/i),
      );
      if (audioAttach) return "voice";
      return "attachment";
    }
    return "text";
  }

  private findAudioAttachment(message: any): string | undefined {
    if (!message.attachments?.size) return undefined;
    const audioAttach = message.attachments.find((a: any) =>
      a.contentType?.startsWith("audio/") || a.name?.match(/\.(ogg|mp3|wav|m4a|flac|opus)$/i),
    );
    return audioAttach?.url || undefined;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const getDiscordBot = () => DiscordBotService.getInstance();
export default DiscordBotService;

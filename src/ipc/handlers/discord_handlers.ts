/**
 * Discord Bot IPC Handlers
 *
 * Manages the in-process Discord bot via DiscordBotService.
 * Incoming messages are forwarded to the OpenClaw gateway pipeline
 * for AI routing, app creation, and multi-channel integration.
 */

import { ipcMain, type IpcMainInvokeEvent, BrowserWindow, app } from "electron";
import log from "electron-log";
import * as path from "path";
import * as fs from "fs/promises";
import { getDiscordBot } from "@/lib/discord_bot_service";
import { getOpenClawGateway } from "@/lib/openclaw_gateway_service";
import { getOpenClawAutonomous } from "@/lib/openclaw_autonomous";
import { voiceAssistant } from "@/lib/voice_assistant";
import { homedir } from "node:os";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const logger = log.scope("discord-ipc");

const DISCORD_MSG_LIMIT = 2000; // Discord's message limit

/** Split a long message into chunks at line/paragraph boundaries. */
function chunkMessage(text: string): string[] {
  if (text.length <= DISCORD_MSG_LIMIT) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= DISCORD_MSG_LIMIT) {
      chunks.push(remaining);
      break;
    }
    const slice = remaining.slice(0, DISCORD_MSG_LIMIT);
    // Try to split at a double newline (paragraph), then single newline, then space
    let splitAt = slice.lastIndexOf("\n\n");
    if (splitAt < DISCORD_MSG_LIMIT * 0.3) splitAt = slice.lastIndexOf("\n");
    if (splitAt < DISCORD_MSG_LIMIT * 0.3) splitAt = slice.lastIndexOf(" ");
    if (splitAt < DISCORD_MSG_LIMIT * 0.3) splitAt = DISCORD_MSG_LIMIT;
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

/** Send a potentially long message, splitting into chunks if needed. */
async function sendChunkedMessage(
  bot: ReturnType<typeof getDiscordBot>,
  channelId: string,
  text: string,
): Promise<void> {
  const chunks = chunkMessage(text);
  for (const chunk of chunks) {
    await bot.sendMessage(channelId, chunk);
  }
}

// =============================================================================
// HANDLER REGISTRATION
// =============================================================================

export function registerDiscordHandlers() {
  const bot = getDiscordBot();

  // ── Forward bot events to renderer windows ──
  bot.on("message", (event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("openclaw:event", {
        type: "message:received",
        timestamp: Date.now(),
        data: event,
        source: "discord",
      });
    }
  });

  bot.on("message-sent", (event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("openclaw:event", {
        type: "message:sent",
        timestamp: Date.now(),
        data: event,
        source: "discord",
      });
    }
  });

  bot.on("started", () => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("openclaw:event", {
        type: "bot:started",
        timestamp: Date.now(),
        source: "discord",
      });
    }
  });

  bot.on("stopped", () => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("openclaw:event", {
        type: "bot:stopped",
        timestamp: Date.now(),
        source: "discord",
      });
    }
  });

  bot.on("error", (event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("openclaw:event", {
        type: "bot:error",
        timestamp: Date.now(),
        data: event,
        source: "discord",
      });
    }
  });

  // ── Intent detection — action request vs plain chat ──
  function detectIntent(text: string): "action" | "image" | "video" | "chat" {
    const t = text.toLowerCase();
    // App building / deployment
    if (/\b(create|build|make|setup|set up|deploy|publish|launch|scaffold|start|generate)\b[\w\s,]{0,60}\b(app|application|site|website|web app|project|page|store|shop|portfolio|landing|dashboard|marketplace|platform|service|api|blog|ecommerce|e-commerce)\b/i.test(t))
      return "action";
    if (/\b(push to|deploy to|publish to)\b[\w\s]{0,30}\b(github|vercel|ipfs|arweave|fleek|4everland|spheron|pinata)\b/i.test(t))
      return "action";
    // Agents, workflows, pipelines, neural networks, models, documents
    if (/\b(create|build|add|configure|setup|delete|remove|update|train|execute|run|test|export|import|deploy|activate|deactivate|duplicate|share)\b[\w\s]{0,30}\b(workflow|pipeline|agent|swarm|orchestrat|neural|network|model|document|email|trigger|skill|calendar|secret|asset|annotation|taxonomy)\b/i.test(t))
      return "action";
    // CI/CD, services, compute
    if (/\b(create|run|list|start|stop|check|get|cancel)\b[\w\s]{0,30}\b(ci\/cd|cicd|pipeline run|service|compute|training|fine.?tun)\b/i.test(t))
      return "action";
    // Download / install models
    if (/\b(download|install|pull)\b[\w\s]{0,30}\b(model|ai model|llm|whisper)\b/i.test(t))
      return "action";
    // List / status queries for managed features
    if (/\b(list|show|get|check|status|browse)\b[\w\s]{0,30}\b(agents?|workflows?|pipelines?|models?|documents?|events?|calendar|services?|secrets?|assets?|reports?|analytics|dashboard|jobs?|swarms?|triggers?|skills?|stores?|tokens?|balances?|purchases?|networks?|orchestrat|trained models?|taxonomy|taxonomies|annotations?)\b/i.test(t))
      return "action";
    // Calendar events
    if (/\b(schedule|create|add|update|delete|sync)\b[\w\s]{0,30}\b(event|meeting|appointment|calendar|reminder)\b/i.test(t))
      return "action";
    // Blockchain / NFT
    if (/\b(check|get|list|browse|show|view)\b[\w\s]{0,30}\b(blockchain|nft|token|wallet|balance|purchase|listing|store|marketplace stat)\b/i.test(t))
      return "action";
    // Voice / transcription
    if (/\b(transcribe|speak|text.?to.?speech|voice)\b/i.test(t))
      return "action";
    // Analytics / reporting
    if (/\b(generate|create|get)\b[\w\s]{0,30}\b(report|analytics|dashboard|digest)\b/i.test(t))
      return "action";
    // Secrets vault
    if (/\b(store|save|get|delete|list)\b[\w\s]{0,30}\b(secret|api.?key|credential|password|vault)\b/i.test(t))
      return "action";
    // Media processing
    if (/\b(process|convert|resize|transcode|extract|thumbnail|metadata|waveform|scenes?)\b[\w\s]{0,30}\b(image|video|audio|media|photo)\b/i.test(t))
      return "action";
    // Images
    if (/\b(generate|create|make|draw|paint|design|render|show me|sketch|illustrate)\b[\w\s,]{0,60}\b(image|photo|picture|artwork|illustration|painting|portrait|wallpaper|poster|logo|icon|art|graphic)\b/i.test(t))
      return "image";
    // Videos
    if (/\b(generate|create|make|render|animate|film)\b[\w\s,]{0,60}\b(video|animation|clip|gif|movie)\b/i.test(t))
      return "video";
    return "chat";
  }

  const OPENCLAW_SYSTEM_PROMPT = `You are ClawBot — a world-class AI assistant powered by OpenClaw, the decentralized AI platform built into JoyCreate.

## Your Personality
You're warm, sharp-witted, and genuinely helpful. Think of yourself as the brilliant friend who happens to know everything about tech, AI, and building things — but never talks down to anyone. You:
- Use humor naturally (not forced — a well-placed joke, a playful observation, never corny)
- Are enthusiastic about helping without being sycophantic
- Celebrate wins with users ("That turned out amazing!")
- Are honest when something won't work, but always offer alternatives
- Use casual language — contractions, conversational tone, occasional emoji where it fits
- Keep it concise — respect people's time. Be thorough when the topic demands it, brief when it doesn't
- Have a confident but humble vibe — you know you're powerful, but you're here to serve
- Remember context from earlier in the conversation and refer back to it naturally

## Your Capabilities (190+ Autonomous Actions)
You don't just talk about doing things — you actually do them. When someone asks you to build, create, or manage something, you plan it out and execute it step by step.

**Build:** Full-stack web apps (React, TypeScript, Tailwind, Vite). Scaffold → generate code → push to GitHub → deploy to Vercel/IPFS/Arweave — the whole pipeline.
**Agents:** Create, train, test, deploy, and share AI agents. Multi-agent swarms and orchestration. Agent factory with fine-tuning on custom data.
**AI/ML:** Download AI models, build neural networks, fine-tune on datasets, data annotation, A/B testing.
**Content:** Generate images & videos via AI. Create Word docs, PDFs, presentations. Process media (resize, transcode, thumbnails, metadata extraction).
**Automate:** n8n workflows, CI/CD pipelines, agent triggers, scheduled tasks, background missions.
**Data:** Vector search (RAG), web scraping, analytics dashboards, reports. Asset studio for algorithms, prompts, APIs.
**Infra:** Manage services (Ollama, n8n, PostgreSQL). Distributed compute network. Encrypted secrets vault. Calendar sync.
**Web3:** Deploy to IPFS, Arweave, Spheron. Query blockchain assets, tokens, NFTs, marketplace listings and stats.
**Communicate:** Draft & send emails with AI triage. Voice transcription (Whisper) and text-to-speech.

## Interaction Style
- For casual chat: be warm, witty, knowledgeable. Don't list capabilities unless asked.
- For action requests: acknowledge clearly ("On it!"), then execute autonomously.
- For errors: be transparent but reassuring ("Hmm, that didn't work — let me try another approach.").
- For complex questions: think through it step by step, share your reasoning.
- Never start with "As an AI..." or "I'm just a bot..." — you're ClawBot, act like it.
- When you don't know something, say so with personality ("That one's got me stumped! Let me see what I can dig up.").
- Adapt your tone to the user — match their energy. Casual user? Be casual. Technical question? Go deep.`;

  // ── Route incoming messages to OpenClaw ──
  const pendingApprovals = new Map<string, string>(); // executionId → channelId

  bot.on("openclaw:channel-message", async (event) => {
    const channelId = String(event.chatId);
    const content = event.content?.trim();

    // ── Voice/audio attachment transcription ──
    if (event.contentType === "voice" && event.audioAttachmentUrl) {
      bot.sendTyping(channelId).catch(() => {});
      transcribeAndRoute(channelId, event).catch((err) => {
        logger.error("Discord voice transcription failed:", err);
        bot.sendMessage(channelId, "Sorry, I couldn't transcribe that audio.").catch(() => {});
      });
      return;
    }

    if (!content) return;

    // ── Approval commands ──
    const approveMatch = content.match(/^!approve\s+(.+)$/);
    const rejectMatch = content.match(/^!reject\s+(.+)$/);
    if (approveMatch || rejectMatch) {
      const execId = (approveMatch || rejectMatch)![1];
      if (!pendingApprovals.has(execId)) {
        bot.sendMessage(channelId, "⚠️ No pending task found with that ID.").catch(() => {});
        return;
      }
      const autonomous = getOpenClawAutonomous();
      if (approveMatch) {
        autonomous.approve(execId).then(() => {
          pendingApprovals.delete(execId);
          bot.sendMessage(channelId, "✅ Approved! Resuming execution...").catch(() => {});
        }).catch((err) => {
          bot.sendMessage(channelId, `❌ Approve failed: ${(err as Error).message}`).catch(() => {});
        });
      } else {
        autonomous.cancel(execId);
        pendingApprovals.delete(execId);
        bot.sendMessage(channelId, "🚫 Task cancelled.").catch(() => {});
      }
      return;
    }

    // ── Skill commands ──
    if (content === "!skills") {
      handleSkillsCommand(channelId).catch(() => {});
      return;
    }
    const teachMatch = content.match(/^!teach\s+(.+)$/i);
    if (teachMatch) {
      handleTeachCommand(channelId, teachMatch[1]).catch(() => {});
      return;
    }

    // ── Skill matching — skills get first crack before intent detection ──
    try {
      const { matchSkill, executeSkill } = await import("@/lib/skill_engine");
      const skillMatch = await matchSkill(content);
      if (skillMatch && skillMatch.confidence >= 0.6) {
        bot.sendTyping(channelId).catch(() => {});
        logger.info(`Discord skill match: "${skillMatch.skill.name}" (${skillMatch.confidence}) for: "${content.slice(0, 80)}"`);
        const result = await executeSkill({ skillId: skillMatch.skillId, input: content });
        if (result.success) {
          await bot.sendMessage(channelId, result.output);
        } else {
          await bot.sendMessage(channelId, `Skill error: ${result.error}`);
        }
        return;
      }
    } catch (skillErr) {
      logger.warn("Skill matching failed, falling through to intent:", skillErr);
    }

    const intent = detectIntent(content);
    logger.info(`Discord intent: ${intent} for: "${content.slice(0, 80)}"`);

    if (intent === "action" || intent === "image" || intent === "video") {
      bot.sendTyping(channelId).catch(() => {});
      handleAutonomousRequest(channelId, content, event).catch((err) => {
        logger.error("Autonomous execution failed:", err);
        bot.sendMessage(channelId, `Sorry, I encountered an error: ${(err as Error).message}`).catch(() => {});
      });
    } else {
      bot.sendTyping(channelId).catch(() => {});
      handleChatMessage(channelId, content, event).catch((err) => {
        logger.error("Chat response failed:", err);
        bot.sendMessage(channelId, "Sorry, I had trouble processing that.").catch(() => {});
      });
      // Fire-and-forget: self-learning — check if this looks like a repeatable skill
      import("@/lib/skill_engine")
        .then((m) => m.learnSkillFromMessage(content))
        .catch(() => {});
    }
  });

  // ── Voice message transcription ──
  async function transcribeAndRoute(channelId: string, event: Record<string, unknown>) {
    const audioUrl = event.audioAttachmentUrl as string;
    const voiceDir = path.join(app.getPath("userData"), "voice", "recordings");
    await fs.mkdir(voiceDir, { recursive: true });

    const ext = audioUrl.match(/\.(ogg|mp3|wav|m4a|flac|opus)/i)?.[1] || "ogg";
    const tempPath = path.join(voiceDir, `dc_${Date.now()}.${ext}`);
    const wavPath = tempPath.replace(new RegExp(`\\.${ext}$`), ".wav");

    // Download audio from Discord CDN
    const resp = await fetch(audioUrl);
    if (!resp.ok) throw new Error(`Failed to download Discord audio: ${resp.status}`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    await fs.writeFile(tempPath, buffer);

    // Convert to WAV using FFmpeg
    const { spawn } = await import("child_process");
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("ffmpeg", ["-y", "-i", tempPath, "-ar", "16000", "-ac", "1", wavPath]);
      proc.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg exit ${code}`)));
      proc.on("error", reject);
    });

    // Transcribe with Whisper
    await voiceAssistant.initialize();
    const result = await voiceAssistant.transcribe(wavPath);
    const transcribedText = result.text.trim();

    if (!transcribedText) {
      await bot.sendMessage(channelId, "🎤 I heard that but couldn't make out any words.");
      return;
    }

    // Notify user of transcription
    await bot.sendMessage(channelId, `🎤 **Heard:** "${transcribedText}"`);

    // Route through normal intent pipeline
    const intent = detectIntent(transcribedText);
    logger.info(`Discord voice intent: ${intent} for: "${transcribedText.slice(0, 80)}"`);

    if (intent === "action" || intent === "image" || intent === "video") {
      await handleAutonomousRequest(channelId, transcribedText, { ...event, content: transcribedText });
    } else {
      await handleChatMessage(channelId, transcribedText, { ...event, content: transcribedText });
    }

    // Cleanup temp files
    await fs.unlink(tempPath).catch(() => {});
    await fs.unlink(wavPath).catch(() => {});
  }

  // ── Skill bot commands ──
  async function handleSkillsCommand(channelId: string) {
    try {
      const { listSkills } = await import("@/lib/skill_engine");
      const allSkills = await listSkills({ enabled: true, limit: 20 });
      if (!allSkills.length) {
        await bot.sendMessage(channelId, "No skills available yet. Use `!teach <description>` to create one!");
        return;
      }
      const lines = allSkills.map(
        (s, i) => `${i + 1}. **${s.name}** — ${s.description}\n   _${s.category}_ | triggers: ${s.triggerPatterns.map((t) => t.pattern).join(", ") || "none"}`,
      );
      await bot.sendMessage(channelId, `🧠 **Available Skills**\n\n${lines.join("\n\n")}`);
    } catch (err) {
      logger.error("Failed to list skills:", err);
      await bot.sendMessage(channelId, "Failed to list skills.").catch(() => {});
    }
  }

  async function handleTeachCommand(channelId: string, description: string) {
    try {
      await bot.sendMessage(channelId, `🧠 Learning new skill: "${description}"...`);
      bot.sendTyping(channelId).catch(() => {});
      const { generateSkill, createSkill } = await import("@/lib/skill_engine");
      const result = await generateSkill({ description });
      const skill = await createSkill(result.skill);
      await bot.sendMessage(
        channelId,
        `✅ **New skill learned!**\n\n**${skill.name}**\n${skill.description}\nCategory: ${skill.category}\nType: ${skill.implementationType}\nTriggers: ${skill.triggerPatterns.map((t) => t.pattern).join(", ") || "auto"}`,
      );
    } catch (err) {
      logger.error("Failed to teach skill:", err);
      await bot.sendMessage(channelId, `Failed to learn skill: ${(err as Error).message}`).catch(() => {});
    }
  }

  // ── Autonomous brain handler (create apps, deploy, etc.) ──
  async function handleAutonomousRequest(channelId: string, content: string, event: Record<string, unknown>) {
    const autonomous = getOpenClawAutonomous();

    bot.sendMessage(channelId, "🦞 Got it! Planning your request...").catch(() => {});

    try {
      const execution = await autonomous.execute({
        input: content,
        requireApproval: false,
      });

      if (execution.status === "completed") {
        const successCount = execution.results.filter((r: any) => r.success).length;
        const failCount = execution.results.filter((r: any) => !r.success).length;
        let summary = `✅ Done! Completed ${successCount} step${successCount !== 1 ? "s" : ""}`;
        if (execution.plan?.objective) {
          summary = `✅ ${execution.plan.objective}\n\nCompleted ${successCount} step${successCount !== 1 ? "s" : ""}`;
        }
        if (failCount > 0) {
          summary += ` (${failCount} failed)`;
        }

        for (const result of execution.results) {
          const icon = result.success ? "✓" : "✗";
          summary += `\n  ${icon} ${result.actionId}`;
          if (!result.success && result.error) {
            summary += `: ${result.error.slice(0, 100)}`;
          }
        }

        await sendChunkedMessage(bot, channelId, summary);
        await sendMediaResults(bot, channelId, execution.results);
      } else if (execution.status === "failed") {
        await bot.sendMessage(channelId, `❌ Failed: ${execution.error || "Unknown error"}`);
      } else if (execution.status === "paused") {
        await bot.sendMessage(
          channelId,
          `⏸ Task paused — needs approval.\n${execution.plan?.objective || ""}\n\nType \`!approve ${execution.id}\` or \`!reject ${execution.id}\``,
        );
        pendingApprovals.set(execution.id, channelId);
      } else {
        await bot.sendMessage(channelId, `🔄 Task status: ${execution.status}\n${execution.plan?.objective || ""}`);
      }
    } catch (err) {
      logger.error("Autonomous execution error:", err);
      await bot.sendMessage(channelId, `❌ Error: ${(err as Error).message}`);
    }
  }

  /** Deliver image/video media results from autonomous steps to Discord. */
  async function sendMediaResults(
    bot: ReturnType<typeof getDiscordBot>,
    channelId: string,
    results: Array<{ actionId: string; success: boolean; output?: unknown }>,
  ): Promise<void> {
    for (const result of results) {
      if (!result.success || !result.output) continue;
      try {
        if (result.actionId === "image.generate") {
          const rows = Array.isArray(result.output) ? result.output : [result.output];
          for (const row of rows) {
            const fp = (row as Record<string, unknown>)?.filePath as string | undefined;
            if (fp && existsSync(fp)) {
              await bot.sendFile(channelId, fp, (row as Record<string, unknown>)?.prompt as string);
            }
          }
        } else if (result.actionId === "video.generate") {
          const rows = Array.isArray(result.output) ? result.output : [result.output];
          for (const row of rows) {
            const fp = (row as Record<string, unknown>)?.filePath as string | undefined;
            if (fp && existsSync(fp)) {
              await bot.sendFile(channelId, fp, (row as Record<string, unknown>)?.prompt as string);
            }
          }
        }
      } catch (err) {
        logger.warn(`Failed to send media for ${result.actionId}:`, err);
      }
    }
  }

  // ── Conversation history per channel (ring buffer, max 50 messages) ──
  const MAX_HISTORY = 50;
  const chatHistories = new Map<string, Array<{ role: "user" | "assistant"; content: string }>>();

  function getChatHistory(channelId: string): Array<{ role: "user" | "assistant"; content: string }> {
    if (!chatHistories.has(channelId)) chatHistories.set(channelId, []);
    return chatHistories.get(channelId)!;
  }

  function addToHistory(channelId: string, role: "user" | "assistant", content: string) {
    const history = getChatHistory(channelId);
    history.push({ role, content: content.slice(0, 2000) });
    while (history.length > MAX_HISTORY) history.shift();
  }

  // ── Plain chat handler (with conversation memory) ──
  async function handleChatMessage(channelId: string, content: string, _event: Record<string, unknown>) {
    try {
      const { generateText } = await import("ai");
      const { getModelClient } = await import("@/ipc/utils/get_model_client");
      const { readSettings } = await import("@/main/settings");

      const settings = readSettings();
      const selectedModel = settings.selectedModel;
      const { modelClient } = await getModelClient(selectedModel, settings);

      // Build user context from event
      const from = _event.from as Record<string, unknown> | undefined;
      const userName = (from?.displayName as string) || (from?.username as string) || "";

      // Add user message to history
      addToHistory(channelId, "user", content);

      // Build messages array with conversation history
      const history = getChatHistory(channelId);
      const systemWithContext = userName
        ? `${OPENCLAW_SYSTEM_PROMPT}\n\nThe user's name is ${userName}. Use it naturally in conversation (not every message — just when it feels right, like a friend would).`
        : OPENCLAW_SYSTEM_PROMPT;

      const messages = [
        { role: "system" as const, content: systemWithContext },
        ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      ];

      const result = await generateText({
        model: modelClient.model,
        messages,
        maxOutputTokens: 4096,
      });

      const text = result.text?.trim();
      if (text) {
        addToHistory(channelId, "assistant", text);
        await sendChunkedMessage(bot, channelId, text);
      } else {
        await bot.sendMessage(channelId, "Hmm, I got nothing back from the AI model. Mind trying that again? 🤔");
      }
    } catch (err) {
      logger.warn("Failed to generate chat response:", err);
      throw err;
    }
  }

  // ── Listen for AI responses destined for Discord clients ──
  const gw = getOpenClawGateway();
  const streamBuffers = new Map<string, string>();

  gw.on("response:external", ({ clientId, message }: { clientId: string; message: Record<string, unknown> }) => {
    if (!clientId.startsWith("discord-")) return;
    const channelId = clientId.replace("discord-", "");

    try {
      const payload = message.payload as Record<string, unknown> | undefined;
      let text: string | undefined;

      // Streaming chunk — accumulate and send on completion
      if (payload?.stream && payload?.chunk) {
        const chunk = payload.chunk as Record<string, unknown>;
        const delta = chunk.delta as string | undefined;
        if (delta) {
          const existing = streamBuffers.get(clientId) || "";
          streamBuffers.set(clientId, existing + delta);
        }
        if (chunk.finishReason === "stop") {
          text = streamBuffers.get(clientId);
          streamBuffers.delete(clientId);
        } else {
          return; // Wait for more chunks
        }
      }

      // Non-streaming response
      if (!text && payload?.message && typeof payload.message === "object") {
        const msg = payload.message as Record<string, unknown>;
        text = msg.content as string | undefined;
      }

      // Error response
      if (!text && message.type === "error" && payload?.error) {
        text = `Error: ${payload.error}`;
      }

      if (text && text.trim()) {
        logger.info(`Sending AI response to Discord channel ${channelId} (${text.length} chars)`);
        sendChunkedMessage(bot, channelId, text).catch((err) => {
          logger.error(`Failed to send reply to Discord channel ${channelId}:`, err);
        });
      }
    } catch (err) {
      logger.error("Failed to forward gateway response to Discord:", err);
    }
  });

  // -------------------------------------------------------------------------
  // Configure the bot token and settings
  // -------------------------------------------------------------------------
  ipcMain.handle(
    "discord:configure",
    async (
      _event: IpcMainInvokeEvent,
      config: {
        token?: string;
        enabled?: boolean;
        allowedGuildIds?: string[];
        allowedChannelIds?: string[];
      },
    ) => {
      // Persist the token into the openclaw config file
      if (config.token) {
        const gw = getOpenClawGateway();
        const currentConfig = gw.getConfig() as unknown as Record<string, unknown>;
        const existingChannels = (currentConfig.channels || {}) as Record<string, unknown>;
        await gw.updateConfig({
          ...currentConfig,
          channels: {
            ...existingChannels,
            discord: {
              ...((existingChannels.discord as Record<string, unknown>) || {}),
              token: config.token,
              enabled: config.enabled ?? true,
              allowedGuildIds: config.allowedGuildIds,
              allowedChannelIds: config.allowedChannelIds,
            },
          },
        } as Record<string, unknown>);
      }

      await bot.configure({
        token: config.token,
        enabled: config.enabled,
        allowedGuildIds: config.allowedGuildIds,
        allowedChannelIds: config.allowedChannelIds,
      });

      return { success: true, status: bot.getStatus() };
    },
  );

  // -------------------------------------------------------------------------
  // Validate bot token without starting
  // -------------------------------------------------------------------------
  ipcMain.handle(
    "discord:validate-token",
    async (_event: IpcMainInvokeEvent, token: string) => {
      if (!token) throw new Error("Token is required");
      const user = await bot.validateToken(token);
      return { valid: true, bot: user };
    },
  );

  // -------------------------------------------------------------------------
  // Start / Stop / Status
  // -------------------------------------------------------------------------
  ipcMain.handle("discord:start", async () => {
    await bot.start();
    return bot.getStatus();
  });

  ipcMain.handle("discord:stop", async () => {
    await bot.stop();
    return { running: false };
  });

  ipcMain.handle("discord:status", async () => {
    return bot.getStatus();
  });

  ipcMain.handle("discord:config", async () => {
    return bot.getConfig();
  });

  // -------------------------------------------------------------------------
  // Send message
  // -------------------------------------------------------------------------
  ipcMain.handle(
    "discord:send-message",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        channelId: string;
        text: string;
        replyToMessageId?: string;
      },
    ) => {
      if (!params.channelId) throw new Error("channelId is required");
      if (!params.text) throw new Error("text is required");

      return bot.sendMessage(params.channelId, params.text, {
        replyToMessageId: params.replyToMessageId,
      });
    },
  );
}

// =============================================================================
// AUTO-START HELPER — called from main.ts after app is ready
// =============================================================================

export async function tryAutoStartDiscordBot(): Promise<void> {
  try {
    // If the daemon is running AND explicitly handling Discord, skip the local
    // bot to avoid token conflicts from two clients on the same token.
    const gw = getOpenClawGateway();
    if (gw.isBridged()) {
      // Only skip if the daemon actually has a Discord channel configured
      try {
        const daemonPort = (gw.getConfig() as any)?.gateway?.daemonPort ?? 18790;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 2000);
        const resp = await fetch(`http://127.0.0.1:${daemonPort}/health`, { signal: ctrl.signal });
        clearTimeout(timer);
        if (resp.ok) {
          const health = await resp.json().catch(() => ({}));
          // Only skip if daemon explicitly reports discord as active
          if (health?.channels?.discord || health?.discord?.active) {
            logger.info("Daemon is bridged and handling Discord — skipping local bot");
            return;
          }
        }
      } catch {
        // Daemon not reachable or no channel info — start local bot
      }
    }

    let token: string | undefined;

    // 1. Check the gateway's in-memory config (app userData path)
    const config = gw.getConfig() as unknown as Record<string, unknown>;
    const channels = config.channels as Record<string, unknown> | undefined;
    const dcChannel = channels?.discord as Record<string, unknown> | undefined;
    if (dcChannel?.token) {
      token = dcChannel.token as string;
    }

    // 2. Fallback: read directly from ~/.openclaw/openclaw.json (daemon config)
    if (!token) {
      try {
        const daemonConfigPath = join(homedir(), ".openclaw", "openclaw.json");
        const raw = readFileSync(daemonConfigPath, "utf8");
        const daemonConfig = JSON.parse(raw);
        token = daemonConfig?.channels?.discord?.token
          || daemonConfig?.discord?.token;
      } catch {
        // File doesn't exist or isn't valid JSON — that's fine
      }
    }

    if (!token) {
      logger.info("No Discord bot token configured — skipping auto-start");
      return;
    }

    const bot = getDiscordBot();
    await bot.configure({ token, enabled: true });
    logger.info(`Discord bot auto-started: ${bot.getStatus().botUsername}`);
  } catch (err) {
    logger.warn("Discord bot auto-start failed:", err);
  }
}

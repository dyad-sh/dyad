/**
 * Telegram Bot IPC Handlers
 *
 * Manages the in-process Telegram bot via TelegramBotService.
 * Incoming messages are forwarded to the OpenClaw gateway pipeline
 * for AI routing, app creation, and multi-channel integration.
 */

import { ipcMain, type IpcMainInvokeEvent, BrowserWindow, app } from "electron";
import log from "electron-log";
import * as path from "path";
import * as fs from "fs/promises";
import { getTelegramBot } from "@/lib/telegram_bot_service";
import { getOpenClawGateway } from "@/lib/openclaw_gateway_service";
import { getOpenClawAutonomous } from "@/lib/openclaw_autonomous";
import { voiceAssistant } from "@/lib/voice_assistant";
import { homedir } from "node:os";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const logger = log.scope("telegram-ipc");

const TELEGRAM_MSG_LIMIT = 4000; // safe margin below 4096

/** Split a long message into chunks at line/paragraph boundaries. */
function chunkMessage(text: string): string[] {
  if (text.length <= TELEGRAM_MSG_LIMIT) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= TELEGRAM_MSG_LIMIT) {
      chunks.push(remaining);
      break;
    }
    let slice = remaining.slice(0, TELEGRAM_MSG_LIMIT);
    // Try to split at a double newline (paragraph), then single newline, then space
    let splitAt = slice.lastIndexOf("\n\n");
    if (splitAt < TELEGRAM_MSG_LIMIT * 0.3) splitAt = slice.lastIndexOf("\n");
    if (splitAt < TELEGRAM_MSG_LIMIT * 0.3) splitAt = slice.lastIndexOf(" ");
    if (splitAt < TELEGRAM_MSG_LIMIT * 0.3) splitAt = TELEGRAM_MSG_LIMIT;
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

/** Send a potentially long message, splitting into chunks if needed. */
async function sendChunkedMessage(
  bot: ReturnType<typeof getTelegramBot>,
  chatId: string,
  text: string,
): Promise<void> {
  const chunks = chunkMessage(text);
  for (const chunk of chunks) {
    await bot.sendMessage(chatId, chunk);
  }
}

// =============================================================================
// HANDLER REGISTRATION
// =============================================================================

export function registerTelegramHandlers() {
  const bot = getTelegramBot();

  // ── Forward bot events to renderer windows ──
  bot.on("message", (event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("openclaw:event", {
        type: "message:received",
        timestamp: Date.now(),
        data: event,
        source: "telegram",
      });
    }
  });

  bot.on("message-sent", (event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("openclaw:event", {
        type: "message:sent",
        timestamp: Date.now(),
        data: event,
        source: "telegram",
      });
    }
  });

  bot.on("started", () => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("openclaw:event", {
        type: "bot:started",
        timestamp: Date.now(),
        source: "telegram",
      });
    }
  });

  bot.on("stopped", () => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("openclaw:event", {
        type: "bot:stopped",
        timestamp: Date.now(),
        source: "telegram",
      });
    }
  });

  bot.on("error", (event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("openclaw:event", {
        type: "bot:error",
        timestamp: Date.now(),
        data: event,
        source: "telegram",
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
  const pendingApprovals = new Map<string, string>(); // executionId → chatId

  bot.on("openclaw:channel-message", async (event) => {
    const chatId = String(event.chatId);
    const content = event.content?.trim();

    // ── Voice/audio message transcription ──
    if ((event.contentType === "voice" || event.contentType === "audio") && event.voiceFileId) {
      bot.sendChatAction(chatId, "typing").catch(() => {});
      transcribeAndRoute(chatId, event).catch((err) => {
        logger.error("Voice transcription failed:", err);
        bot.sendMessage(chatId, "Sorry, I couldn't transcribe that voice message.").catch(() => {});
      });
      return;
    }

    if (!content) return;

    // ── Approval commands ──
    const approveMatch = content.match(/^\/approve_(.+)$/);
    const rejectMatch = content.match(/^\/reject_(.+)$/);
    if (approveMatch || rejectMatch) {
      const execId = (approveMatch || rejectMatch)![1];
      if (!pendingApprovals.has(execId)) {
        bot.sendMessage(chatId, "⚠️ No pending task found with that ID.").catch(() => {});
        return;
      }
      const autonomous = getOpenClawAutonomous();
      if (approveMatch) {
        autonomous.approve(execId).then(() => {
          pendingApprovals.delete(execId);
          bot.sendMessage(chatId, "✅ Approved! Resuming execution...").catch(() => {});
        }).catch((err) => {
          bot.sendMessage(chatId, `❌ Approve failed: ${(err as Error).message}`).catch(() => {});
        });
      } else {
        autonomous.cancel(execId);
        pendingApprovals.delete(execId);
        bot.sendMessage(chatId, "🚫 Task cancelled.").catch(() => {});
      }
      return;
    }

    // ── Skill commands ──
    if (content === "/skills") {
      handleSkillsCommand(chatId).catch(() => {});
      return;
    }
    const teachMatch = content.match(/^\/teach\s+(.+)$/i);
    if (teachMatch) {
      handleTeachCommand(chatId, teachMatch[1]).catch(() => {});
      return;
    }

    // ── Skill matching — skills get first crack before intent detection ──
    try {
      const { matchSkill, executeSkill } = await import("@/lib/skill_engine");
      const skillMatch = await matchSkill(content);
      if (skillMatch && skillMatch.confidence >= 0.6) {
        bot.sendChatAction(chatId, "typing").catch(() => {});
        logger.info(`Telegram skill match: "${skillMatch.skill.name}" (${skillMatch.confidence}) for: "${content.slice(0, 80)}"`);
        const result = await executeSkill({ skillId: skillMatch.skillId, input: content });
        if (result.success) {
          await bot.sendMessage(chatId, result.output);
        } else {
          await bot.sendMessage(chatId, `Skill error: ${result.error}`);
        }
        return;
      }
    } catch (skillErr) {
      logger.warn("Skill matching failed, falling through to intent:", skillErr);
    }

    const intent = detectIntent(content);
    logger.info(`Telegram intent: ${intent} for: "${content.slice(0, 80)}"`);

    if (intent === "action" || intent === "image" || intent === "video") {
      // Show typing indicator while processing
      bot.sendChatAction(chatId, "typing").catch(() => {});
      // Route through autonomous brain — can plan and execute real actions
      handleAutonomousRequest(chatId, content, event).catch((err) => {
        logger.error("Autonomous execution failed:", err);
        bot.sendMessage(chatId, `Sorry, I encountered an error: ${(err as Error).message}`).catch(() => {});
      });
    } else {
      // Show typing indicator while processing
      bot.sendChatAction(chatId, "typing").catch(() => {});
      // Plain chat — route through gateway with system prompt
      handleChatMessage(chatId, content, event).catch((err) => {
        logger.error("Chat response failed:", err);
        bot.sendMessage(chatId, "Sorry, I had trouble processing that.").catch(() => {});
      });
      // Fire-and-forget: self-learning — check if this looks like a repeatable skill
      import("@/lib/skill_engine")
        .then((m) => m.learnSkillFromMessage(content))
        .catch(() => {});
    }
  });

  // ── Skill bot commands ──
  async function handleSkillsCommand(chatId: string) {
    try {
      const { listSkills } = await import("@/lib/skill_engine");
      const allSkills = await listSkills({ enabled: true, limit: 20 });
      if (!allSkills.length) {
        await bot.sendMessage(chatId, "No skills available yet. Use /teach <description> to create one!");
        return;
      }
      const lines = allSkills.map(
        (s, i) => `${i + 1}. *${s.name}* — ${s.description}\n   _${s.category}_ | triggers: ${s.triggerPatterns.map((t) => t.pattern).join(", ") || "none"}`,
      );
      await bot.sendMessage(chatId, `🧠 *Available Skills*\n\n${lines.join("\n\n")}`, { parseMode: "Markdown" });
    } catch (err) {
      logger.error("Failed to list skills:", err);
      await bot.sendMessage(chatId, "Failed to list skills.").catch(() => {});
    }
  }

  async function handleTeachCommand(chatId: string, description: string) {
    try {
      await bot.sendMessage(chatId, `🧠 Learning new skill: "${description}"...`);
      bot.sendChatAction(chatId, "typing").catch(() => {});
      const { generateSkill, createSkill } = await import("@/lib/skill_engine");
      const result = await generateSkill({ description });
      const skill = await createSkill(result.skill);
      await bot.sendMessage(
        chatId,
        `✅ *New skill learned!*\n\n*${skill.name}*\n${skill.description}\nCategory: ${skill.category}\nType: ${skill.implementationType}\nTriggers: ${skill.triggerPatterns.map((t) => t.pattern).join(", ") || "auto"}`,
        { parseMode: "Markdown" },
      );
    } catch (err) {
      logger.error("Failed to teach skill:", err);
      await bot.sendMessage(chatId, `Failed to learn skill: ${(err as Error).message}`).catch(() => {});
    }
  }

  // ── Autonomous brain handler (create apps, deploy, etc.) ──
  async function handleAutonomousRequest(chatId: string, content: string, event: Record<string, unknown>) {
    const autonomous = getOpenClawAutonomous();

    // Acknowledge the request
    bot.sendMessage(chatId, "🦞 Got it! Planning your request...").catch(() => {});

    try {
      const execution = await autonomous.execute({
        input: content,
        requireApproval: false,
      });

      if (execution.status === "completed") {
        const successCount = execution.results.filter((r) => r.success).length;
        const failCount = execution.results.filter((r) => !r.success).length;
        let summary = `✅ Done! Completed ${successCount} step${successCount !== 1 ? "s" : ""}`;
        if (execution.plan?.objective) {
          summary = `✅ ${execution.plan.objective}\n\nCompleted ${successCount} step${successCount !== 1 ? "s" : ""}`;
        }
        if (failCount > 0) {
          summary += ` (${failCount} failed)`;
        }

        // Add step details
        for (const result of execution.results) {
          const icon = result.success ? "✓" : "✗";
          summary += `\n  ${icon} ${result.actionId}`;
          if (!result.success && result.error) {
            summary += `: ${result.error.slice(0, 100)}`;
          }
        }

        await sendChunkedMessage(bot, chatId, summary);

        // Send any generated images/videos as media
        await sendMediaResults(bot, chatId, execution.results);
      } else if (execution.status === "failed") {
        await bot.sendMessage(chatId, `❌ Failed: ${execution.error || "Unknown error"}`);
      } else if (execution.status === "paused") {
        // Send approval inline keyboard
        await bot.sendMessage(
          chatId,
          `⏸ Task paused — needs approval.\n${execution.plan?.objective || ""}\n\nReply with /approve_${execution.id} or /reject_${execution.id}`,
        );
        pendingApprovals.set(execution.id, chatId);
      } else {
        await bot.sendMessage(chatId, `🔄 Task status: ${execution.status}\n${execution.plan?.objective || ""}`);
      }
    } catch (err) {
      logger.error("Autonomous execution error:", err);
      await bot.sendMessage(chatId, `❌ Error: ${(err as Error).message}`);
    }
  }

  /** Deliver image/video media results from autonomous steps to Telegram. */
  async function sendMediaResults(
    bot: ReturnType<typeof getTelegramBot>,
    chatId: string,
    results: Array<{ actionId: string; success: boolean; output?: unknown }>,
  ): Promise<void> {
    for (const result of results) {
      if (!result.success || !result.output) continue;
      try {
        if (result.actionId === "image.generate") {
          // Output is array of DB rows with filePath
          const rows = Array.isArray(result.output) ? result.output : [result.output];
          for (const row of rows) {
            const fp = (row as Record<string, unknown>)?.filePath as string | undefined;
            if (fp && existsSync(fp)) {
              await bot.sendPhotoFile(chatId, fp, (row as Record<string, unknown>)?.prompt as string);
            }
          }
        } else if (result.actionId === "video.generate") {
          const rows = Array.isArray(result.output) ? result.output : [result.output];
          for (const row of rows) {
            const fp = (row as Record<string, unknown>)?.filePath as string | undefined;
            if (fp && existsSync(fp)) {
              await bot.sendVideoFile(chatId, fp, (row as Record<string, unknown>)?.prompt as string);
            }
          }
        }
      } catch (err) {
        logger.warn(`Failed to send media for ${result.actionId}:`, err);
      }
    }
  }

  // ── Voice message transcription ──
  async function transcribeAndRoute(chatId: string, event: Record<string, unknown>) {
    const fileId = event.voiceFileId as string;
    const voiceDir = path.join(app.getPath("userData"), "voice", "recordings");
    await fs.mkdir(voiceDir, { recursive: true });

    const oggPath = path.join(voiceDir, `tg_${Date.now()}.ogg`);
    const wavPath = oggPath.replace(".ogg", ".wav");

    // Download the voice file from Telegram
    await bot.downloadFile(fileId, oggPath);

    // Convert OGG to WAV using FFmpeg
    const { spawn } = await import("child_process");
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("ffmpeg", ["-y", "-i", oggPath, "-ar", "16000", "-ac", "1", wavPath]);
      proc.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg exit ${code}`)));
      proc.on("error", reject);
    });

    // Transcribe with Whisper
    await voiceAssistant.initialize();
    const result = await voiceAssistant.transcribe(wavPath);
    const transcribedText = result.text.trim();

    if (!transcribedText) {
      await bot.sendMessage(chatId, "🎤 I heard that but couldn't make out any words.");
      return;
    }

    // Notify user of transcription
    await bot.sendMessage(chatId, `🎤 *Heard:* "${transcribedText}"`, { parseMode: "Markdown" });

    // Route through normal intent pipeline
    const intent = detectIntent(transcribedText);
    logger.info(`Telegram voice intent: ${intent} for: "${transcribedText.slice(0, 80)}"`);

    if (intent === "action" || intent === "image" || intent === "video") {
      await handleAutonomousRequest(chatId, transcribedText, { ...event, content: transcribedText });
    } else {
      await handleChatMessage(chatId, transcribedText, { ...event, content: transcribedText });
    }

    // Cleanup temp files
    await fs.unlink(oggPath).catch(() => {});
    await fs.unlink(wavPath).catch(() => {});
  }

  // ── Conversation history per chat (ring buffer, max 50 messages) ──
  const MAX_HISTORY = 50;
  const chatHistories = new Map<string, Array<{ role: "user" | "assistant"; content: string }>>();

  function getChatHistory(chatId: string): Array<{ role: "user" | "assistant"; content: string }> {
    if (!chatHistories.has(chatId)) chatHistories.set(chatId, []);
    return chatHistories.get(chatId)!;
  }

  function addToHistory(chatId: string, role: "user" | "assistant", content: string) {
    const history = getChatHistory(chatId);
    history.push({ role, content: content.slice(0, 2000) });
    while (history.length > MAX_HISTORY) history.shift();
  }

  // ── Plain chat handler (with conversation memory) ──
  async function handleChatMessage(chatId: string, content: string, _event: Record<string, unknown>) {
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
      addToHistory(chatId, "user", content);

      // Build messages array with conversation history
      const history = getChatHistory(chatId);
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
        addToHistory(chatId, "assistant", text);
        await sendChunkedMessage(bot, chatId, text);
      } else {
        await bot.sendMessage(chatId, "Hmm, I got nothing back from the AI model. Mind trying that again? 🤔");
      }
    } catch (err) {
      logger.warn("Failed to generate chat response:", err);
      throw err;
    }
  }

  // ── Listen for AI responses destined for Telegram clients ──
  const gw = getOpenClawGateway();
  const streamBuffers = new Map<string, string>();

  gw.on("response:external", ({ clientId, message }: { clientId: string; message: Record<string, unknown> }) => {
    if (!clientId.startsWith("telegram-")) return;
    const chatId = clientId.replace("telegram-", "");

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
        logger.info(`Sending AI response to Telegram chat ${chatId} (${text.length} chars)`);
        sendChunkedMessage(bot, chatId, text).catch((err) => {
          logger.error(`Failed to send reply to Telegram chat ${chatId}:`, err);
        });
      }
    } catch (err) {
      logger.error("Failed to forward gateway response to Telegram:", err);
    }
  });

  // -------------------------------------------------------------------------
  // Configure the bot token and settings
  // -------------------------------------------------------------------------
  ipcMain.handle(
    "telegram:configure",
    async (
      _event: IpcMainInvokeEvent,
      config: { token?: string; enabled?: boolean; allowedChatIds?: string[] },
    ) => {
      // Persist the token into the openclaw config file
      if (config.token) {
        const gw = getOpenClawGateway();
        const currentConfig = gw.getConfig() as unknown as Record<string, unknown>;
        const existingChannels = (currentConfig.channels || {}) as Record<string, unknown>;
        await gw.updateConfig({
          ...currentConfig,
          telegram: {
            token: config.token,
            enabled: config.enabled ?? true,
            allowedChatIds: config.allowedChatIds,
          },
          channels: {
            ...existingChannels,
            telegram: {
              ...((existingChannels.telegram as Record<string, unknown>) || {}),
              botToken: config.token,
              enabled: config.enabled ?? true,
            },
          },
        } as Record<string, unknown>);
      }

      await bot.configure({
        token: config.token,
        enabled: config.enabled,
        allowedChatIds: config.allowedChatIds,
      });

      return { success: true, status: bot.getStatus() };
    },
  );

  // -------------------------------------------------------------------------
  // Validate bot token without starting polling
  // -------------------------------------------------------------------------
  ipcMain.handle(
    "telegram:validate-token",
    async (_event: IpcMainInvokeEvent, token: string) => {
      if (!token) throw new Error("Token is required");
      const resp = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`Invalid bot token (${resp.status}): ${text}`);
      }
      const json = (await resp.json()) as {
        ok: boolean;
        result?: unknown;
        description?: string;
      };
      if (!json.ok)
        throw new Error(
          `Invalid bot token: ${json.description || "unknown error"}`,
        );
      return { valid: true, bot: json.result };
    },
  );

  // -------------------------------------------------------------------------
  // Start / Stop / Status
  // -------------------------------------------------------------------------
  ipcMain.handle("telegram:start", async () => {
    await bot.start();
    return bot.getStatus();
  });

  ipcMain.handle("telegram:stop", async () => {
    await bot.stop();
    return { running: false };
  });

  ipcMain.handle("telegram:status", async () => {
    return bot.getStatus();
  });

  ipcMain.handle("telegram:config", async () => {
    return bot.getConfig();
  });

  // -------------------------------------------------------------------------
  // Send message
  // -------------------------------------------------------------------------
  ipcMain.handle(
    "telegram:send-message",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        chatId: string;
        text: string;
        parseMode?: "HTML" | "Markdown" | "MarkdownV2";
        replyToMessageId?: number;
      },
    ) => {
      if (!params.chatId) throw new Error("chatId is required");
      if (!params.text) throw new Error("text is required");

      return bot.sendMessage(params.chatId, params.text, {
        parseMode: params.parseMode,
        replyToMessageId: params.replyToMessageId,
      });
    },
  );
}

// =============================================================================
// AUTO-START HELPER — called from main.ts after app is ready
// =============================================================================

export async function tryAutoStartTelegramBot(): Promise<void> {
  try {
    // Resolve the token FIRST — we need it both for daemon-skip and local-start paths
    let token: string | undefined;

    // 1. Check the gateway's in-memory config (app userData path)
    const gw = getOpenClawGateway();
    const config = gw.getConfig() as unknown as Record<string, unknown>;
    const channels = config.channels as Record<string, unknown> | undefined;
    const tgChannel = channels?.telegram as Record<string, unknown> | undefined;
    if (tgChannel?.botToken) {
      token = tgChannel.botToken as string;
    }
    if (!token) {
      const legacyTg = config.telegram as Record<string, unknown> | undefined;
      if (legacyTg?.token) {
        token = legacyTg.token as string;
      }
    }

    // 2. Fallback: read directly from ~/.openclaw/openclaw.json (daemon config)
    if (!token) {
      try {
        const daemonConfigPath = join(homedir(), ".openclaw", "openclaw.json");
        const raw = readFileSync(daemonConfigPath, "utf8");
        const daemonConfig = JSON.parse(raw);
        token = daemonConfig?.channels?.telegram?.botToken
          || daemonConfig?.telegram?.token
          || daemonConfig?.config?.telegram?.token;
      } catch {
        // File doesn't exist or isn't valid JSON — that's fine
      }
    }

    if (!token) {
      logger.info("No Telegram bot token configured — skipping auto-start");
      return;
    }

    // ALWAYS pre-configure the local bot with the token so the watchdog can
    // restart it later if the daemon dies.  This does NOT start polling.
    const bot = getTelegramBot();
    if (!bot.isConfigured()) {
      await bot.configure({ token, enabled: false });
      logger.info("Local Telegram bot pre-configured (standby for watchdog fallback)");
    }

    // If the daemon is running AND explicitly handling Telegram, skip starting
    // the local poller to avoid 409 "Conflict" errors from two pollers on the same token.
    if (gw.isBridged()) {
      // Check 1: daemon health endpoint for telegram status
      try {
        const daemonPort = (gw.getConfig() as unknown as Record<string, unknown> & { gateway?: { daemonPort?: number } })?.gateway?.daemonPort ?? 18790;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 2000);
        const resp = await fetch(`http://127.0.0.1:${daemonPort}/health`, { signal: ctrl.signal });
        clearTimeout(timer);
        if (resp.ok) {
          const health = await resp.json().catch(() => ({}));
          // Only skip if daemon explicitly reports telegram as active
          if (health?.channels?.telegram || health?.telegram?.active) {
            logger.info("Daemon is bridged and handling Telegram — skipping local bot polling");
            return;
          }
        }
      } catch {
        // Daemon not reachable or no channel info — try config file check
      }

      // Check 2: daemon config file for telegram enabled
      try {
        const daemonConfigPath = join(homedir(), ".openclaw", "openclaw.json");
        const raw = readFileSync(daemonConfigPath, "utf8");
        const daemonConfig = JSON.parse(raw);
        if (daemonConfig?.channels?.telegram?.enabled && daemonConfig?.channels?.telegram?.botToken) {
          // Stop any running local bot before skipping
          if (bot.getStatus().running) {
            logger.info("Stopping local Telegram bot — daemon handles Telegram");
            await bot.stop();
          }
          logger.info("Daemon is bridged and daemon config has Telegram enabled — skipping local bot to avoid 409 conflicts");
          return;
        }
      } catch {
        // Config file not readable — fall through to start local bot
      }
    }

    // Daemon is NOT handling Telegram — start the local bot
    if (!bot.getStatus().running) {
      await bot.configure({ token, enabled: true });
      logger.info(`Telegram bot auto-started: @${bot.getStatus().botUsername}`);
    }
  } catch (err) {
    logger.warn("Telegram bot auto-start failed:", err);
  }
}

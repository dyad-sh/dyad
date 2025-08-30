import { v4 as uuidv4 } from "uuid";
import { ipcMain } from "electron";
import {
  ModelMessage,
  TextPart,
  ImagePart,
  streamText,
  ToolSet,
  TextStreamPart,
} from "ai";
import { db } from "../../db";
import { chats, messages } from "../../db/schema";
import { and, eq, isNull } from "drizzle-orm";
import {
  constructSystemPrompt,
  readAiRules,
} from "../../prompts/system_prompt";
import {
  SUPABASE_AVAILABLE_SYSTEM_PROMPT,
  SUPABASE_NOT_AVAILABLE_SYSTEM_PROMPT,
} from "../../prompts/supabase_prompt";
import { getDyadAppPath } from "../../paths/paths";
import { readSettings } from "../../main/settings";
import type { ChatResponseEnd, ChatStreamParams } from "../ipc_types";
import { extractCodebase, readFileWithCache } from "../../utils/codebase";
import { processFullResponseActions } from "../processors/response_processor";
import { streamTestResponse } from "./testing_chat_handlers";
import { getTestResponse } from "./testing_chat_handlers";
import { getModelClient, ModelClient } from "../utils/get_model_client";
import log from "electron-log";
import {
  getSupabaseContext,
  getSupabaseClientCode,
} from "../../supabase_admin/supabase_context";
import { SUMMARIZE_CHAT_SYSTEM_PROMPT } from "../../prompts/summarize_chat_system_prompt";
import fs from "node:fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { readFile, writeFile, unlink } from "fs/promises";
import { getMaxTokens, getTemperature } from "../utils/token_utils";
import { MAX_CHAT_TURNS_IN_CONTEXT } from "@/constants/settings_constants";
import { validateChatContext } from "../utils/context_paths_utils";
import { GoogleGenerativeAIProviderOptions } from "@ai-sdk/google";
import { z } from "zod";
import { McpManager } from "../utils/mcp_manager";
import {
  jsonSchemaToZod,
  summarizeJsonSchemaInputs,
} from "../utils/jsonschema_to_zod";

import { getExtraProviderOptions } from "../utils/thinking_utils";

import { safeSend } from "../utils/safe_sender";
import { cleanFullResponse } from "../utils/cleanFullResponse";
import { generateProblemReport } from "../processors/tsc";
import { createProblemFixPrompt } from "@/shared/problem_prompt";
import { AsyncVirtualFileSystem } from "../../../shared/VirtualFilesystem";
import {
  getDyadAddDependencyTags,
  getDyadWriteTags,
  getDyadDeleteTags,
  getDyadRenameTags,
} from "../utils/dyad_tag_parser";
import { fileExists } from "../utils/file_utils";
import { FileUploadsState } from "../utils/file_uploads_state";
import { OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import { extractMentionedAppsCodebases } from "../utils/mention_apps";
import { parseAppMentions } from "@/shared/parse_mention_apps";
import { prompts as promptsTable } from "../../db/schema";
import { inArray } from "drizzle-orm";
import { replacePromptReference } from "../utils/replacePromptReference";

type AsyncIterableStream<T> = AsyncIterable<T> & ReadableStream<T>;

const logger = log.scope("chat_stream_handlers");

// Track active streams for cancellation
const activeStreams = new Map<number, AbortController>();

// Track partial responses for cancelled streams
const partialResponses = new Map<number, string>();

// Directory for storing temporary files
const TEMP_DIR = path.join(os.tmpdir(), "dyad-attachments");

// Common helper functions
const TEXT_FILE_EXTENSIONS = [
  ".md",
  ".txt",
  ".json",
  ".csv",
  ".js",
  ".ts",
  ".html",
  ".css",
];

async function isTextFile(filePath: string): Promise<boolean> {
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_FILE_EXTENSIONS.includes(ext);
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Ensure the temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Helper function to process stream chunks
async function processStreamChunks({
  fullStream,
  fullResponse,
  abortController,
  chatId,
  processResponseChunkUpdate,
}: {
  fullStream: AsyncIterableStream<TextStreamPart<ToolSet>>;
  fullResponse: string;
  abortController: AbortController;
  chatId: number;
  processResponseChunkUpdate: (params: {
    fullResponse: string;
  }) => Promise<string>;
}): Promise<{ fullResponse: string; incrementalResponse: string }> {
  let incrementalResponse = "";
  let inThinkingBlock = false;
  const pendingToolCalls = new Map<
    string,
    { name?: string; serverId?: string; args?: any }
  >();
  // Deduplicate identical tool calls within a single stream (same server/tool/args)
  const seenToolCallFingerprints = new Set<string>();

  for await (const part of fullStream) {
    let chunk = "";
    const pAny: any = part as any;
    const typeStr: string | undefined = pAny?.type;
      if (typeStr === "text-delta") {
        if (inThinkingBlock) {
          chunk = "</think>";
          inThinkingBlock = false;
        }
        chunk += pAny.text;
      } else if (typeStr === "reasoning-delta") {
      if (!inThinkingBlock) {
        chunk = "<think>";
        inThinkingBlock = true;
      }

      chunk += escapeDyadTags((part as any).text);
    } else if (
      typeStr === "tool-call" ||
      typeStr === "tool_call" ||
      typeStr === "function-call"
    ) {
      // Record tool call so we can summarize on result
      const p: any = part;
      const id =
        p.toolCallId || p.callId || p.id || Math.random().toString(36).slice(2);
      let name: string | undefined = p.toolName || p.name;
      // Try to decode server/tool from our naming convention
      if (typeof name === "string" && name.startsWith("mcp__")) {
        const seg = name.split("__");
        if (seg.length >= 3) {
          pendingToolCalls.set(id, {
            name: seg.slice(2).join("__"),
            serverId: seg[1],
            args: p.args || p.input,
          });
        } else {
          pendingToolCalls.set(id, { name, args: p.args || p.input });
        }
      } else {
        pendingToolCalls.set(id, { name, args: p.args || p.input });
      }
      // Do not emit any visible chunk yet; we'll show on result
      chunk = "";
    } else if (
      typeStr === "tool-result" ||
      typeStr === "tool_result" ||
      typeStr === "function-result" ||
      typeStr === "tool_output"
    ) {
      const p: any = part;
      const id = p.toolCallId || p.callId || p.id || "";
      const call =
        (id && pendingToolCalls.get(id)) ||
        ({ name: p.toolName || p.name || p.functionName } as any);
      const toolLabel = call.serverId
        ? `${call.serverId}/${call.name ?? "tool"}`
        : `${call.name ?? "tool"}`;
      // Deduplicate repeated calls with identical args within the same stream
      try {
        const fp = `${call.serverId ?? ""}::${call.name ?? ""}::${JSON.stringify(call.args ?? null)}`;
        if (seenToolCallFingerprints.has(fp)) {
          // Skip rendering duplicate block
          continue;
        }
        seenToolCallFingerprints.add(fp);
      } catch {}
      // Render a dedicated MCP call block with pretty JSON body
      const result = p.result ?? p.output ?? p.data ?? p.response ?? p;
      let body = "";
      try {
        body = JSON.stringify(result, null, 2);
      } catch {
        body = String(result);
      }
      if (body.length > 12000) {
        body = body.slice(0, 12000) + "\n... (truncated)";
      }
      const [server, tool] = toolLabel.includes("/")
        ? toolLabel.split(/\/(.+)/)
        : ["", toolLabel];
      const serverAttr = server ? ` server=\"${escapeXml(server)}\"` : "";
      const toolAttr = tool ? ` tool=\"${escapeXml(tool)}\"` : "";
      chunk += `<dyad-mcp-call${serverAttr}${toolAttr} state=\"finished\">\n${body}\n</dyad-mcp-call>`;
    }

    if (!chunk) {
      continue;
    }

    fullResponse += chunk;
    incrementalResponse += chunk;
    fullResponse = cleanFullResponse(fullResponse);
    fullResponse = await processResponseChunkUpdate({
      fullResponse,
    });

    // If the stream was aborted, exit early
    if (abortController.signal.aborted) {
      logger.log(`Stream for chat ${chatId} was aborted`);
      break;
    }
  }

  return { fullResponse, incrementalResponse };
}

export function registerChatStreamHandlers() {
  ipcMain.handle("chat:stream", async (event, req: ChatStreamParams) => {
    try {
      const fileUploadsState = FileUploadsState.getInstance();
      fileUploadsState.initialize({ chatId: req.chatId });

      // Create an AbortController for this stream
      const abortController = new AbortController();
      activeStreams.set(req.chatId, abortController);

      // Get the chat to check for existing messages
      const chat = await db.query.chats.findFirst({
        where: eq(chats.id, req.chatId),
        with: {
          messages: {
            orderBy: (messages, { asc }) => [asc(messages.createdAt)],
          },
          app: true, // Include app information
        },
      });

      if (!chat) {
        throw new Error(`Chat not found: ${req.chatId}`);
      }

      // Handle redo option: remove the most recent messages if needed
      if (req.redo) {
        // Get the most recent messages
        const chatMessages = [...chat.messages];

        // Find the most recent user message
        let lastUserMessageIndex = chatMessages.length - 1;
        while (
          lastUserMessageIndex >= 0 &&
          chatMessages[lastUserMessageIndex].role !== "user"
        ) {
          lastUserMessageIndex--;
        }

        if (lastUserMessageIndex >= 0) {
          // Delete the user message
          await db
            .delete(messages)
            .where(eq(messages.id, chatMessages[lastUserMessageIndex].id));

          // If there's an assistant message after the user message, delete it too
          if (
            lastUserMessageIndex < chatMessages.length - 1 &&
            chatMessages[lastUserMessageIndex + 1].role === "assistant"
          ) {
            await db
              .delete(messages)
              .where(
                eq(messages.id, chatMessages[lastUserMessageIndex + 1].id),
              );
          }
        }
      }

      // Process attachments if any
      let attachmentInfo = "";
      let attachmentPaths: string[] = [];

      if (req.attachments && req.attachments.length > 0) {
        attachmentInfo = "\n\nAttachments:\n";

        for (const [index, attachment] of req.attachments.entries()) {
          // Generate a unique filename
          const hash = crypto
            .createHash("md5")
            .update(attachment.name + Date.now())
            .digest("hex");
          const fileExtension = path.extname(attachment.name);
          const filename = `${hash}${fileExtension}`;
          const filePath = path.join(TEMP_DIR, filename);

          // Extract the base64 data (remove the data:mime/type;base64, prefix)
          const base64Data = attachment.data.split(";base64,").pop() || "";

          await writeFile(filePath, Buffer.from(base64Data, "base64"));
          attachmentPaths.push(filePath);

          if (attachment.attachmentType === "upload-to-codebase") {
            // For upload-to-codebase, create a unique file ID and store the mapping
            const fileId = `DYAD_ATTACHMENT_${index}`;

            fileUploadsState.addFileUpload(fileId, {
              filePath,
              originalName: attachment.name,
            });

            // Add instruction for AI to use dyad-write tag
            attachmentInfo += `\n\nFile to upload to codebase: ${attachment.name} (file id: ${fileId})\n`;
          } else {
            // For chat-context, use the existing logic
            attachmentInfo += `- ${attachment.name} (${attachment.type})\n`;
            // If it's a text-based file, try to include the content
            if (await isTextFile(filePath)) {
              try {
                attachmentInfo += `<dyad-text-attachment filename="${attachment.name}" type="${attachment.type}" path="${filePath}">
                </dyad-text-attachment>
                \n\n`;
              } catch (err) {
                logger.error(`Error reading file content: ${err}`);
              }
            }
          }
        }
      }

      // Add user message to database with attachment info
      let userPrompt = req.prompt + (attachmentInfo ? attachmentInfo : "");
      // Inline referenced prompt contents for mentions like @prompt:<id>
      try {
        const matches = Array.from(userPrompt.matchAll(/@prompt:(\d+)/g));
        if (matches.length > 0) {
          const ids = Array.from(new Set(matches.map((m) => Number(m[1]))));
          const referenced = await db
            .select()
            .from(promptsTable)
            .where(inArray(promptsTable.id, ids));
          if (referenced.length > 0) {
            const promptsMap: Record<number, string> = {};
            for (const p of referenced) {
              promptsMap[p.id] = p.content;
            }
            userPrompt = replacePromptReference(userPrompt, promptsMap);
          }
        }
      } catch (e) {
        logger.error("Failed to inline referenced prompts:", e);
      }
      if (req.selectedComponent) {
        let componentSnippet = "[component snippet not available]";
        try {
          const componentFileContent = await readFile(
            path.join(
              getDyadAppPath(chat.app.path),
              req.selectedComponent.relativePath,
            ),
            "utf8",
          );
          const lines = componentFileContent.split("\n");
          const selectedIndex = req.selectedComponent.lineNumber - 1;

          // Let's get one line before and three after for context.
          const startIndex = Math.max(0, selectedIndex - 1);
          const endIndex = Math.min(lines.length, selectedIndex + 4);

          const snippetLines = lines.slice(startIndex, endIndex);
          const selectedLineInSnippetIndex = selectedIndex - startIndex;

          if (snippetLines[selectedLineInSnippetIndex]) {
            snippetLines[selectedLineInSnippetIndex] =
              `${snippetLines[selectedLineInSnippetIndex]} // <-- EDIT HERE`;
          }

          componentSnippet = snippetLines.join("\n");
        } catch (err) {
          logger.error(`Error reading selected component file content: ${err}`);
        }

        userPrompt += `\n\nSelected component: ${req.selectedComponent.name} (file: ${req.selectedComponent.relativePath})

Snippet:
\`\`\`
${componentSnippet}
\`\`\`
`;
      }
      await db
        .insert(messages)
        .values({
          chatId: req.chatId,
          role: "user",
          content: userPrompt,
        })
        .returning();

      // Add a placeholder assistant message immediately
      const [placeholderAssistantMessage] = await db
        .insert(messages)
        .values({
          chatId: req.chatId,
          role: "assistant",
          content: "", // Start with empty content
        })
        .returning();

      // Fetch updated chat data after possible deletions and additions
      const updatedChat = await db.query.chats.findFirst({
        where: eq(chats.id, req.chatId),
        with: {
          messages: {
            orderBy: (messages, { asc }) => [asc(messages.createdAt)],
          },
          app: true, // Include app information
        },
      });

      if (!updatedChat) {
        throw new Error(`Chat not found: ${req.chatId}`);
      }

      // Send the messages right away so that the loading state is shown for the message.
      safeSend(event.sender, "chat:response:chunk", {
        chatId: req.chatId,
        messages: updatedChat.messages,
      });

      let fullResponse = "";
      // Track executed MCP results in case the SDK doesn't emit tool-result parts
      const executedMcpResults: {
        serverId: string;
        toolName: string;
        args: any;
        result: any;
      }[] = [];

      // Check if this is a test prompt
      const testResponse = getTestResponse(req.prompt);

      if (testResponse) {
        // For test prompts, use the dedicated function
        fullResponse = await streamTestResponse(
          event,
          req.chatId,
          testResponse,
          abortController,
          updatedChat,
        );
      } else {
        // Normal AI processing for non-test prompts
        const settings = readSettings();

        const appPath = getDyadAppPath(updatedChat.app.path);
        const chatContext = req.selectedComponent
          ? {
              contextPaths: [
                {
                  globPath: req.selectedComponent.relativePath,
                },
              ],
              smartContextAutoIncludes: [],
            }
          : validateChatContext(updatedChat.app.chatContext);

        // Parse app mentions from the prompt
        const mentionedAppNames = parseAppMentions(req.prompt);

        // Extract codebase for current app
        const { formattedOutput: codebaseInfo, files } = await extractCodebase({
          appPath,
          chatContext,
        });

        // Extract codebases for mentioned apps
        const mentionedAppsCodebases = await extractMentionedAppsCodebases(
          mentionedAppNames,
          updatedChat.app.id, // Exclude current app
        );

        // Combine current app codebase with mentioned apps' codebases
        let otherAppsCodebaseInfo = "";
        if (mentionedAppsCodebases.length > 0) {
          const mentionedAppsSection = mentionedAppsCodebases
            .map(
              ({ appName, codebaseInfo }) =>
                `\n\n=== Referenced App: ${appName} ===\n${codebaseInfo}`,
            )
            .join("");

          otherAppsCodebaseInfo = mentionedAppsSection;

          logger.log(
            `Added ${mentionedAppsCodebases.length} mentioned app codebases`,
          );
        }

        logger.log(`Extracted codebase information from ${appPath}`);
        logger.log(
          "codebaseInfo: length",
          codebaseInfo.length,
          "estimated tokens",
          codebaseInfo.length / 4,
        );
        const { modelClient, isEngineEnabled } = await getModelClient(
          settings.selectedModel,
          settings,
          files,
        );

        // Prepare message history for the AI
        const messageHistory = updatedChat.messages.map((message) => ({
          role: message.role as "user" | "assistant" | "system",
          content: message.content,
        }));

        // Limit chat history based on maxChatTurnsInContext setting
        // We add 1 because the current prompt counts as a turn.
        const maxChatTurns =
          (settings.maxChatTurnsInContext || MAX_CHAT_TURNS_IN_CONTEXT) + 1;

        // If we need to limit the context, we take only the most recent turns
        let limitedMessageHistory = messageHistory;
        if (messageHistory.length > maxChatTurns * 2) {
          // Each turn is a user + assistant pair
          // Calculate how many messages to keep (maxChatTurns * 2)
          let recentMessages = messageHistory
            .filter((msg) => msg.role !== "system")
            .slice(-maxChatTurns * 2);

          // Ensure the first message is a user message
          if (recentMessages.length > 0 && recentMessages[0].role !== "user") {
            // Find the first user message
            const firstUserIndex = recentMessages.findIndex(
              (msg) => msg.role === "user",
            );
            if (firstUserIndex > 0) {
              // Drop assistant messages before the first user message
              recentMessages = recentMessages.slice(firstUserIndex);
            } else if (firstUserIndex === -1) {
              logger.warn(
                "No user messages found in recent history, set recent messages to empty",
              );
              recentMessages = [];
            }
          }

          limitedMessageHistory = [...recentMessages];

          logger.log(
            `Limiting chat history from ${messageHistory.length} to ${limitedMessageHistory.length} messages (max ${maxChatTurns} turns)`,
          );
        }

        let systemPrompt = constructSystemPrompt({
          aiRules: await readAiRules(getDyadAppPath(updatedChat.app.path)),
          chatMode: settings.selectedChatMode,
        });

        // Discover MCP tools and inject into the system prompt
        const discoveredMcpTools = await McpManager.discoverAllTools(true);
        if (discoveredMcpTools.length > 0) {
          const grouped: Record<
            string,
            {
              serverId: string;
              tools: {
                name: string;
                description?: string;
                inputSummary?: string;
              }[];
            }
          > = {};
          for (const t of discoveredMcpTools) {
            if (!grouped[t.serverId])
              grouped[t.serverId] = { serverId: t.serverId, tools: [] };
            const inputSummary = summarizeJsonSchemaInputs(t.inputSchema);
            grouped[t.serverId].tools.push({
              name: t.name,
              description: t.description,
              inputSummary,
            });
          }
          // Collect sanitized server meta for guidance (no secrets)
          const serversInfo = McpManager.listServersInfo();
          const serverMetaMap = new Map(serversInfo.map((s) => [s.id, s] as const));

          const sections = Object.values(grouped)
            .map((g) => {
              const meta = serverMetaMap.get(g.serverId);
              const metaLineParts: string[] = [];
              if (meta?.transport === "http" && meta.urlHost) metaLineParts.push(`http://${meta.urlHost}`);
              if (meta?.headerKeys && meta.headerKeys.length) metaLineParts.push(`headers: ${meta.headerKeys.join(", ")}`);
              if (meta?.transport === "stdio" && meta.hasCommand) metaLineParts.push("local stdio");
              const metaLine = metaLineParts.length ? ` (${metaLineParts.join("; ")})` : "";
              const tlist = g.tools
                .map(
                  (t) =>
                    `- ${t.name}${t.description ? `: ${t.description}` : ""}${t.inputSummary ? ` (${t.inputSummary})` : ""}`,
                )
                .join("\n");
              return `Server ${g.serverId}${metaLine}:\n${tlist}`;
            })
            .join("\n\n");

          const serverIds = Object.keys(grouped);
          const userTextLower = req.prompt.toLowerCase();
          const referencedServer = serverIds.find((id) =>
            userTextLower.includes(id.toLowerCase()),
          );

          systemPrompt += `\n\n# Available MCP Tools\nYou can autonomously call any of these MCP tools (via function calling). Tool function names follow mcp__{serverId}__{toolName}.\n\nDecision policy:\n- Decide when to call a tool versus answering directly. Call a tool when it can materially improve accuracy, fetch fresh data, or automate a concrete action.\n- Choose the server/tool whose description best matches the user's request. If unsure between multiple, ask a brief clarifying question before calling.\n- If the user mentions a server (e.g., \"context7\", \"omnisearch\"), prefer that server.\n- Do not announce \"I will search/call a tool\"; either call it or ask for missing info.\n\nInput & auth policy:\n- Before calling, check the tool's required inputs from its schema (above). If any are missing (e.g., URL, id, date range), ask the user for them first.\n- If an HTTP server returns auth errors (401/403 or messages like \"invalid api key\"), explain the issue and ask the user for the necessary key/token or header. Tell them to add it in Settings → Integrations → MCP for the specific server id. Example header: Authorization: Bearer {{TOKEN}}. Do not expose any secrets yourself.\n\nResponse policy after MCP calls:\n- After a tool call, evaluate whether further action is needed. If so, use Dyad tags or additional MCP tools to continue the task (e.g., editing files). Otherwise, write a clear explanation in 2–5 sentences using the returned data and propose the next step or a targeted question. Include concrete details (titles, domains, ids, counts) when available.\n- The app shows tool results automatically, so avoid duplicating them verbatim.\n\n${sections}`;

          if (referencedServer) {
            systemPrompt += `\n\nServer focus: The user referenced server "${referencedServer}"—prefer tools from this server for this turn.`;
          }
        }

        // Add information about mentioned apps if any
        if (otherAppsCodebaseInfo) {
          const mentionedAppsList = mentionedAppsCodebases
            .map(({ appName }) => appName)
            .join(", ");

          systemPrompt += `\n\n# Referenced Apps\nThe user has mentioned the following apps in their prompt: ${mentionedAppsList}. Their codebases have been included in the context for your reference. When referring to these apps, you can understand their structure and code to provide better assistance, however you should NOT edit the files in these referenced apps. The referenced apps are NOT part of the current app and are READ-ONLY.`;
        }
        if (
          updatedChat.app?.supabaseProjectId &&
          settings.supabase?.accessToken?.value
        ) {
          systemPrompt +=
            "\n\n" +
            SUPABASE_AVAILABLE_SYSTEM_PROMPT +
            "\n\n" +
            (await getSupabaseContext({
              supabaseProjectId: updatedChat.app.supabaseProjectId,
            }));
        } else if (
          // Neon projects don't need Supabase.
          !updatedChat.app?.neonProjectId
        ) {
          systemPrompt += "\n\n" + SUPABASE_NOT_AVAILABLE_SYSTEM_PROMPT;
        }
        const isSummarizeIntent = req.prompt.startsWith(
          "Summarize from chat-id=",
        );
        if (isSummarizeIntent) {
          systemPrompt = SUMMARIZE_CHAT_SYSTEM_PROMPT;
        }

        // Update the system prompt for images if there are image attachments
        const hasImageAttachments =
          req.attachments &&
          req.attachments.some((attachment) =>
            attachment.type.startsWith("image/"),
          );

        const hasUploadedAttachments =
          req.attachments &&
          req.attachments.some(
            (attachment) => attachment.attachmentType === "upload-to-codebase",
          );
        // If there's mixed attachments (e.g. some upload to codebase attachments and some upload images as chat context attachemnts)
        // we will just include the file upload system prompt, otherwise the AI gets confused and doesn't reliably
        // print out the dyad-write tags.
        // Usually, AI models will want to use the image as reference to generate code (e.g. UI mockups) anyways, so
        // it's not that critical to include the image analysis instructions.
        if (hasUploadedAttachments) {
          systemPrompt += `
  
When files are attached to this conversation, upload them to the codebase using this exact format:

<dyad-write path="path/to/destination/filename.ext" description="Upload file to codebase">
DYAD_ATTACHMENT_X
</dyad-write>

Example for file with id of DYAD_ATTACHMENT_0:
<dyad-write path="src/components/Button.jsx" description="Upload file to codebase">
DYAD_ATTACHMENT_0
</dyad-write>

  `;
        } else if (hasImageAttachments) {
          systemPrompt += `

# Image Analysis Instructions
This conversation includes one or more image attachments. When the user uploads images:
1. If the user explicitly asks for analysis, description, or information about the image, please analyze the image content.
2. Describe what you see in the image if asked.
3. You can use images as references when the user has coding or design-related questions.
4. For diagrams or wireframes, try to understand the content and structure shown.
5. For screenshots of code or errors, try to identify the issue or explain the code.
`;
        }

        const codebasePrefix = isEngineEnabled
          ? // No codebase prefix if engine is set, we will take of it there.
            []
          : ([
              {
                role: "user",
                content: createCodebasePrompt(codebaseInfo),
              },
              {
                role: "assistant",
                content: "OK, got it. I'm ready to help",
              },
            ] as const);

        const otherCodebasePrefix = otherAppsCodebaseInfo
          ? ([
              {
                role: "user",
                content: createOtherAppsCodebasePrompt(otherAppsCodebaseInfo),
              },
              {
                role: "assistant",
                content: "OK.",
              },
            ] as const)
          : [];

        let chatMessages: ModelMessage[] = [
          ...codebasePrefix,
          ...otherCodebasePrefix,
          ...limitedMessageHistory.map((msg) => ({
            role: msg.role as "user" | "assistant" | "system",
            // Why remove thinking tags?
            // Thinking tags are generally not critical for the context
            // and eats up extra tokens.
            content:
              settings.selectedChatMode === "ask"
                ? removeDyadTags(removeNonEssentialTags(msg.content))
                : removeNonEssentialTags(msg.content),
          })),
        ];

        // Check if the last message should include attachments
        if (chatMessages.length >= 2 && attachmentPaths.length > 0) {
          const lastUserIndex = chatMessages.length - 2;
          const lastUserMessage = chatMessages[lastUserIndex];

          if (lastUserMessage.role === "user") {
            // Replace the last message with one that includes attachments
            chatMessages[lastUserIndex] = await prepareMessageWithAttachments(
              lastUserMessage,
              attachmentPaths,
            );
          }
        }

        if (isSummarizeIntent) {
          const previousChat = await db.query.chats.findFirst({
            where: eq(chats.id, parseInt(req.prompt.split("=")[1])),
            with: {
              messages: {
                orderBy: (messages, { asc }) => [asc(messages.createdAt)],
              },
            },
          });
          chatMessages = [
            {
              role: "user",
              content:
                "Summarize the following chat: " +
                formatMessagesForSummary(previousChat?.messages ?? []),
            } satisfies ModelMessage,
          ];
        }

        const simpleStreamText = async ({
          chatMessages,
          modelClient,
        }: {
          chatMessages: ModelMessage[];
          modelClient: ModelClient;
        }) => {
          const dyadRequestId = uuidv4();
          if (isEngineEnabled) {
            logger.log(
              "sending AI request to engine with request id:",
              dyadRequestId,
            );
          } else {
            logger.log("sending AI request");
          }
          // Build MCP tool definitions for function calling (hybrid approach)
          const mcpTools = await McpManager.discoverAllTools(true);
          const tools: Record<
            string,
            {
              description?: string;
              inputSchema: any;
              execute: (args: any) => Promise<any>;
            }
          > = {};
          for (const t of mcpTools) {
            const toolName = `mcp__${t.serverId}__${t.name}`;
            let inputSchema: any = z.any();
            try {
              if (t.inputSchema) {
                inputSchema = jsonSchemaToZod(t.inputSchema);
              }
            } catch {
              inputSchema = z.any();
            }
            const extraDesc = summarizeJsonSchemaInputs(t.inputSchema);
            tools[toolName] = {
              description:
                (t.description || `MCP tool ${t.name} from ${t.serverId}`) +
                (extraDesc ? ` | ${extraDesc}` : ""),
              inputSchema,
              execute: async (args: any) => {
                const result = await McpManager.callTool(
                  t.serverId,
                  t.name,
                  args,
                );
                try {
                  executedMcpResults.push({
                    serverId: t.serverId,
                    toolName: t.name,
                    args,
                    result,
                  });
                } catch {}
                return result;
              },
            };
          }

          return streamText({
            maxOutputTokens: await getMaxTokens(settings.selectedModel),
            temperature: await getTemperature(settings.selectedModel),
            maxRetries: 2,
            model: modelClient.model,
            tools,
            providerOptions: {
              "dyad-engine": {
                dyadRequestId,
              },
              "dyad-gateway": getExtraProviderOptions(
                modelClient.builtinProviderId,
                settings,
              ),
              google: {
                thinkingConfig: {
                  includeThoughts: true,
                },
              } satisfies GoogleGenerativeAIProviderOptions,
              openai: {
                reasoningSummary: "auto",
              } satisfies OpenAIResponsesProviderOptions,
            },
            system: systemPrompt,
            messages: chatMessages.filter((m) => m.content),
            onError: (error: any) => {
              logger.error("Error streaming text:", error);
              let errorMessage = (error as any)?.error?.message;
              const responseBody = error?.error?.responseBody;
              if (errorMessage && responseBody) {
                errorMessage += "\n\nDetails: " + responseBody;
              }
              const message = errorMessage || JSON.stringify(error);
              const requestIdPrefix = isEngineEnabled
                ? `[Request ID: ${dyadRequestId}] `
                : "";
              event.sender.send(
                "chat:response:error",
                `Sorry, there was an error from the AI: ${requestIdPrefix}${message}`,
              );
              // Clean up the abort controller
              activeStreams.delete(req.chatId);
            },
            abortSignal: abortController.signal,
          });
        };

        const processResponseChunkUpdate = async ({
          fullResponse,
        }: {
          fullResponse: string;
        }) => {
          if (
            fullResponse.includes("$$SUPABASE_CLIENT_CODE$$") &&
            updatedChat.app?.supabaseProjectId
          ) {
            const supabaseClientCode = await getSupabaseClientCode({
              projectId: updatedChat.app?.supabaseProjectId,
            });
            fullResponse = fullResponse.replace(
              "$$SUPABASE_CLIENT_CODE$$",
              supabaseClientCode,
            );
          }
          // Store the current partial response
          partialResponses.set(req.chatId, fullResponse);

          // Update the placeholder assistant message content in the messages array
          const currentMessages = [...updatedChat.messages];
          if (
            currentMessages.length > 0 &&
            currentMessages[currentMessages.length - 1].role === "assistant"
          ) {
            currentMessages[currentMessages.length - 1].content = fullResponse;
          }

          // Update the assistant message in the database
          safeSend(event.sender, "chat:response:chunk", {
            chatId: req.chatId,
            messages: currentMessages,
          });
          return fullResponse;
        };

        // When calling streamText, the messages need to be properly formatted for mixed content
        const { fullStream } = await simpleStreamText({
          chatMessages,
          modelClient,
        });

        // Process the stream as before
        try {
          const result = await processStreamChunks({
            fullStream,
            fullResponse,
            abortController,
            chatId: req.chatId,
            processResponseChunkUpdate,
          });
          fullResponse = result.fullResponse;

          // If the SDK didn't emit tool-result parts, synthesize blocks from captured execute() results
          if (executedMcpResults.length > 0) {
            for (const ex of executedMcpResults) {
              const signature = `<dyad-mcp-call server=\"${escapeXml(ex.serverId)}\" tool=\"${escapeXml(ex.toolName)}\"`;
              if (!fullResponse.includes(signature)) {
                let body = "";
                try {
                  body = JSON.stringify(ex.result, null, 2);
                } catch {
                  body = String(ex.result);
                }
                if (body.length > 12000)
                  body = body.slice(0, 12000) + "\n... (truncated)";
                const synth = `<dyad-mcp-call server=\"${escapeXml(ex.serverId)}\" tool=\"${escapeXml(ex.toolName)}\" state=\"finished\">\n${body}\n</dyad-mcp-call>`;
                fullResponse += synth;
                fullResponse = cleanFullResponse(fullResponse);
                fullResponse = await processResponseChunkUpdate({
                  fullResponse,
                });
              }
            }
          }

          // Fallback: if the model ended after an MCP tool-result without any trailing natural language,
          // produce a short follow-up summary so the user isn't left with just the tool card.
          if (
            !abortController.signal.aborted &&
            /<dyad-mcp-call[^>]*>/.test(fullResponse)
          ) {
            const lastCloseIndex = fullResponse.lastIndexOf("</dyad-mcp-call>");
            const trailing =
              lastCloseIndex >= 0
                ? fullResponse.slice(lastCloseIndex + "</dyad-mcp-call>".length)
                : "";
            const trailingPlain = removeDyadTags(trailing).trim();
            const needsFollowUp = trailingPlain.length === 0; // nothing after the last tool block

            if (needsFollowUp) {
              try {
                // Gather tool bodies (limit size)
                const bodies: string[] = [];
                const regex =
                  /<dyad-mcp-call[^>]*>([\s\S]*?)<\/dyad-mcp-call>/g;
                let m: RegExpExecArray | null;
                while ((m = regex.exec(fullResponse)) !== null) {
                  const body = (m[1] || "").slice(0, 4000);
                  bodies.push(body);
                }
                const toolsBlob = bodies.join("\n\n---\n\n");

                const followUpSystem = [
                  systemPrompt,
                  `Using the provided MCP result(s), continue addressing the user's request. If follow-up actions such as editing files are needed, output the appropriate Dyad tags. Be specific and actionable: 2–5 sentences. If results include URLs or titles, reference a few. If the body indicates auth/permissions issues (401/403, invalid key, missing token), clearly ask the user for the needed key/token or link and instruct them to add it in Settings → Integrations → MCP for the correct server id. If results are empty, suggest a refined query or next step.`,
                ].join("\n\n");
                const followUpUser = `User asked: ${req.prompt}\n\nMCP result(s):\n\n${toolsBlob}`;

                const { fullStream: followUpStream } = await streamText({
                  maxOutputTokens: 256,
                  temperature: 0.2,
                  maxRetries: 1,
                  model: modelClient.model,
                  tools: {}, // do not allow additional tool calls in the follow-up
                  providerOptions: {
                    "dyad-gateway": getExtraProviderOptions(
                      modelClient.builtinProviderId,
                      settings,
                    ),
                    google: {
                      thinkingConfig: { includeThoughts: false },
                    } as GoogleGenerativeAIProviderOptions,
                    openai: {
                      reasoningSummary: "off",
                    } as OpenAIResponsesProviderOptions,
                  },
                  system: followUpSystem,
                  messages: [{ role: "user", content: followUpUser }],
                  onError: (e) => {
                    logger.warn("follow-up summary generation failed", e);
                  },
                  abortSignal: abortController.signal,
                });

                for await (const part of followUpStream) {
                  if (abortController.signal.aborted) break;
                  if (part.type !== "text-delta") continue;
                  fullResponse += part.text;
                  fullResponse = cleanFullResponse(fullResponse);
                  fullResponse = await processResponseChunkUpdate({
                    fullResponse,
                  });
                }
              } catch (e) {
                logger.warn("Failed to add follow-up after MCP call", e);
              }
            }
          }

          if (
            !abortController.signal.aborted &&
            settings.selectedChatMode !== "ask" &&
            hasUnclosedDyadWrite(fullResponse)
          ) {
            let continuationAttempts = 0;
            while (
              hasUnclosedDyadWrite(fullResponse) &&
              continuationAttempts < 2 &&
              !abortController.signal.aborted
            ) {
              logger.warn(
                `Received unclosed dyad-write tag, attempting to continue, attempt #${continuationAttempts + 1}`,
              );
              continuationAttempts++;

              const { fullStream: contStream } = await simpleStreamText({
                // Build messages: replay history then pre-fill assistant with current partial.
                chatMessages: [
                  ...chatMessages,
                  { role: "assistant", content: fullResponse },
                ],
                modelClient,
              });
              for await (const part of contStream) {
                // If the stream was aborted, exit early
                if (abortController.signal.aborted) {
                  logger.log(`Stream for chat ${req.chatId} was aborted`);
                  break;
                }
                if (part.type !== "text-delta") continue; // ignore reasoning for continuation
                fullResponse += part.text;
                fullResponse = cleanFullResponse(fullResponse);
                fullResponse = await processResponseChunkUpdate({
                  fullResponse,
                });
              }
            }
          }
          const addDependencies = getDyadAddDependencyTags(fullResponse);
          if (
            !abortController.signal.aborted &&
            // If there are dependencies, we don't want to auto-fix problems
            // because there's going to be type errors since the packages aren't
            // installed yet.
            addDependencies.length === 0 &&
            settings.enableAutoFixProblems &&
            settings.selectedChatMode !== "ask"
          ) {
            try {
              // IF auto-fix is enabled
              let problemReport = await generateProblemReport({
                fullResponse,
                appPath: getDyadAppPath(updatedChat.app.path),
              });

              let autoFixAttempts = 0;
              const originalFullResponse = fullResponse;
              const previousAttempts: ModelMessage[] = [];
              while (
                problemReport.problems.length > 0 &&
                autoFixAttempts < 2 &&
                !abortController.signal.aborted
              ) {
                fullResponse += `<dyad-problem-report summary="${problemReport.problems.length} problems">
${problemReport.problems
  .map(
    (problem) =>
      `<problem file="${escapeXml(problem.file)}" line="${problem.line}" column="${problem.column}" code="${problem.code}">${escapeXml(problem.message)}</problem>`,
  )
  .join("\n")}
</dyad-problem-report>`;

                logger.info(
                  `Attempting to auto-fix problems, attempt #${autoFixAttempts + 1}`,
                );
                autoFixAttempts++;
                const problemFixPrompt = createProblemFixPrompt(problemReport);

                const virtualFileSystem = new AsyncVirtualFileSystem(
                  getDyadAppPath(updatedChat.app.path),
                  {
                    fileExists: (fileName: string) => fileExists(fileName),
                    readFile: (fileName: string) => readFileWithCache(fileName),
                  },
                );
                const writeTags = getDyadWriteTags(fullResponse);
                const renameTags = getDyadRenameTags(fullResponse);
                const deletePaths = getDyadDeleteTags(fullResponse);
                virtualFileSystem.applyResponseChanges({
                  deletePaths,
                  renameTags,
                  writeTags,
                });

                const { formattedOutput: codebaseInfo, files } =
                  await extractCodebase({
                    appPath,
                    chatContext,
                    virtualFileSystem,
                  });
                const { modelClient } = await getModelClient(
                  settings.selectedModel,
                  settings,
                  files,
                );

                const { fullStream } = await simpleStreamText({
                  modelClient,
                  chatMessages: [
                    ...chatMessages.map((msg, index) => {
                      if (
                        index === 0 &&
                        msg.role === "user" &&
                        typeof msg.content === "string" &&
                        msg.content.startsWith(CODEBASE_PROMPT_PREFIX)
                      ) {
                        return {
                          role: "user",
                          content: createCodebasePrompt(codebaseInfo),
                        } as const;
                      }
                      return msg;
                    }),
                    {
                      role: "assistant",
                      content: removeNonEssentialTags(originalFullResponse),
                    },
                    ...previousAttempts,
                    { role: "user", content: problemFixPrompt },
                  ],
                });
                previousAttempts.push({
                  role: "user",
                  content: problemFixPrompt,
                });
                const result = await processStreamChunks({
                  fullStream,
                  fullResponse,
                  abortController,
                  chatId: req.chatId,
                  processResponseChunkUpdate,
                });
                fullResponse = result.fullResponse;
                previousAttempts.push({
                  role: "assistant",
                  content: removeNonEssentialTags(result.incrementalResponse),
                });

                problemReport = await generateProblemReport({
                  fullResponse,
                  appPath: getDyadAppPath(updatedChat.app.path),
                });
              }
            } catch (error) {
              logger.error(
                "Error generating problem report or auto-fixing:",
                settings.enableAutoFixProblems,
                error,
              );
            }
          }
        } catch (streamError) {
          // Check if this was an abort error
          if (abortController.signal.aborted) {
            const chatId = req.chatId;
            const partialResponse = partialResponses.get(req.chatId);
            // If we have a partial response, save it to the database
            if (partialResponse) {
              try {
                // Update the placeholder assistant message with the partial content and cancellation note
                await db
                  .update(messages)
                  .set({
                    content: `${partialResponse}

[Response cancelled by user]`,
                  })
                  .where(eq(messages.id, placeholderAssistantMessage.id));

                logger.log(
                  `Updated cancelled response for placeholder message ${placeholderAssistantMessage.id} in chat ${chatId}`,
                );
                partialResponses.delete(req.chatId);
              } catch (error) {
                logger.error(
                  `Error saving partial response for chat ${chatId}:`,
                  error,
                );
              }
            }
            return req.chatId;
          }
          throw streamError;
        }
      }

      // Only save the response and process it if we weren't aborted
      if (!abortController.signal.aborted && fullResponse) {
        // Scrape from: <dyad-chat-summary>Renaming profile file</dyad-chat-title>
        const chatTitle = fullResponse.match(
          /<dyad-chat-summary>(.*?)<\/dyad-chat-summary>/,
        );
        if (chatTitle) {
          await db
            .update(chats)
            .set({ title: chatTitle[1] })
            .where(and(eq(chats.id, req.chatId), isNull(chats.title)));
        }
        const chatSummary = chatTitle?.[1];

        // Update the placeholder assistant message with the full response
        await db
          .update(messages)
          .set({ content: fullResponse })
          .where(eq(messages.id, placeholderAssistantMessage.id));
        const settings = readSettings();
        if (
          settings.autoApproveChanges &&
          settings.selectedChatMode !== "ask"
        ) {
          const status = await processFullResponseActions(
            fullResponse,
            req.chatId,
            {
              chatSummary,
              messageId: placeholderAssistantMessage.id,
            }, // Use placeholder ID
          );

          const chat = await db.query.chats.findFirst({
            where: eq(chats.id, req.chatId),
            with: {
              messages: {
                orderBy: (messages, { asc }) => [asc(messages.createdAt)],
              },
            },
          });

          safeSend(event.sender, "chat:response:chunk", {
            chatId: req.chatId,
            messages: chat!.messages,
          });

          if (status.error) {
            safeSend(
              event.sender,
              "chat:response:error",
              `Sorry, there was an error applying the AI's changes: ${status.error}`,
            );
          }

          // Signal that the stream has completed
          safeSend(event.sender, "chat:response:end", {
            chatId: req.chatId,
            updatedFiles: status.updatedFiles ?? false,
            extraFiles: status.extraFiles,
            extraFilesError: status.extraFilesError,
          } satisfies ChatResponseEnd);
        } else {
          safeSend(event.sender, "chat:response:end", {
            chatId: req.chatId,
            updatedFiles: false,
          } satisfies ChatResponseEnd);
        }
      }

      // Clean up any temporary files
      if (attachmentPaths.length > 0) {
        for (const filePath of attachmentPaths) {
          try {
            // We don't immediately delete files because they might be needed for reference
            // Instead, schedule them for deletion after some time
            setTimeout(
              async () => {
                if (fs.existsSync(filePath)) {
                  await unlink(filePath);
                  logger.log(`Deleted temporary file: ${filePath}`);
                }
              },
              30 * 60 * 1000,
            ); // Delete after 30 minutes
          } catch (error) {
            logger.error(`Error scheduling file deletion: ${error}`);
          }
        }
      }

      // Return the chat ID for backwards compatibility
      return req.chatId;
    } catch (error) {
      logger.error("Error calling LLM:", error);
      safeSend(
        event.sender,
        "chat:response:error",
        `Sorry, there was an error processing your request: ${error}`,
      );
      // Clean up the abort controller
      activeStreams.delete(req.chatId);
      // Clean up file uploads state on error
      FileUploadsState.getInstance().clear();
      return "error";
    }
  });

  // Handler to cancel an ongoing stream
  ipcMain.handle("chat:cancel", async (event, chatId: number) => {
    const abortController = activeStreams.get(chatId);

    if (abortController) {
      // Abort the stream
      abortController.abort();
      activeStreams.delete(chatId);
      logger.log(`Aborted stream for chat ${chatId}`);
    } else {
      logger.warn(`No active stream found for chat ${chatId}`);
    }

    // Send the end event to the renderer
    safeSend(event.sender, "chat:response:end", {
      chatId,
      updatedFiles: false,
    } satisfies ChatResponseEnd);

    return true;
  });
}

export function formatMessagesForSummary(
  messages: { role: string; content: string | undefined }[],
) {
  if (messages.length <= 8) {
    // If we have 8 or fewer messages, include all of them
    return messages
      .map((m) => `<message role="${m.role}">${m.content}</message>`)
      .join("\n");
  }

  // Take first 2 messages and last 6 messages
  const firstMessages = messages.slice(0, 2);
  const lastMessages = messages.slice(-6);

  // Combine them with an indicator of skipped messages
  const combinedMessages = [
    ...firstMessages,
    {
      role: "system",
      content: `[... ${messages.length - 8} messages omitted ...]`,
    },
    ...lastMessages,
  ];

  return combinedMessages
    .map((m) => `<message role="${m.role}">${m.content}</message>`)
    .join("\n");
}

// Helper function to replace text attachment placeholders with full content
async function replaceTextAttachmentWithContent(
  text: string,
  filePath: string,
  fileName: string,
): Promise<string> {
  try {
    if (await isTextFile(filePath)) {
      // Read the full content
      const fullContent = await readFile(filePath, "utf-8");

      // Replace the placeholder tag with the full content
      const escapedPath = filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const tagPattern = new RegExp(
        `<dyad-text-attachment filename="[^"]*" type="[^"]*" path="${escapedPath}">\\s*<\\/dyad-text-attachment>`,
        "g",
      );

      const replacedText = text.replace(
        tagPattern,
        `Full content of ${fileName}:\n\`\`\`\n${fullContent}\n\`\`\``,
      );

      logger.log(
        `Replaced text attachment content for: ${fileName} - length before: ${text.length} - length after: ${replacedText.length}`,
      );
      return replacedText;
    }
    return text;
  } catch (error) {
    logger.error(`Error processing text file: ${error}`);
    return text;
  }
}

// Helper function to convert traditional message to one with proper image attachments
async function prepareMessageWithAttachments(
  message: ModelMessage,
  attachmentPaths: string[],
): Promise<ModelMessage> {
  let textContent = message.content;
  // Get the original text content
  if (typeof textContent !== "string") {
    logger.warn(
      "Message content is not a string - shouldn't happen but using message as-is",
    );
    return message;
  }

  // Process text file attachments - replace placeholder tags with full content
  for (const filePath of attachmentPaths) {
    const fileName = path.basename(filePath);
    textContent = await replaceTextAttachmentWithContent(
      textContent,
      filePath,
      fileName,
    );
  }

  // For user messages with attachments, create a content array
  const contentParts: (TextPart | ImagePart)[] = [];

  // Add the text part first with possibly modified content
  contentParts.push({
    type: "text",
    text: textContent,
  });

  // Add image parts for any image attachments
  for (const filePath of attachmentPaths) {
    const ext = path.extname(filePath).toLowerCase();
    if ([".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext)) {
      try {
        // Read the file as a buffer
        const imageBuffer = await readFile(filePath);

        // Add the image to the content parts
        contentParts.push({
          type: "image",
          image: imageBuffer,
        });

        logger.log(`Added image attachment: ${filePath}`);
      } catch (error) {
        logger.error(`Error reading image file: ${error}`);
      }
    }
  }

  // Return the message with the content array
  return {
    role: "user",
    content: contentParts,
  };
}

function removeNonEssentialTags(text: string): string {
  return removeProblemReportTags(removeThinkingTags(text));
}

function removeThinkingTags(text: string): string {
  const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
  return text.replace(thinkRegex, "").trim();
}

export function removeProblemReportTags(text: string): string {
  const problemReportRegex =
    /<dyad-problem-report[^>]*>[\s\S]*?<\/dyad-problem-report>/g;
  return text.replace(problemReportRegex, "").trim();
}

export function removeDyadTags(text: string): string {
  const dyadRegex = /<dyad-[^>]*>[\s\S]*?<\/dyad-[^>]*>/g;
  return text.replace(dyadRegex, "").trim();
}

export function hasUnclosedDyadWrite(text: string): boolean {
  // Find the last opening dyad-write tag
  const openRegex = /<dyad-write[^>]*>/g;
  let lastOpenIndex = -1;
  let match;

  while ((match = openRegex.exec(text)) !== null) {
    lastOpenIndex = match.index;
  }

  // If no opening tag found, there's nothing unclosed
  if (lastOpenIndex === -1) {
    return false;
  }

  // Look for a closing tag after the last opening tag
  const textAfterLastOpen = text.substring(lastOpenIndex);
  const hasClosingTag = /<\/dyad-write>/.test(textAfterLastOpen);

  return !hasClosingTag;
}

function escapeDyadTags(text: string): string {
  // Escape dyad tags in reasoning content
  // We are replacing the opening tag with a look-alike character
  // to avoid issues where thinking content includes dyad tags
  // and are mishandled by:
  // 1. FE markdown parser
  // 2. Main process response processor
  return text.replace(/<dyad/g, "＜dyad").replace(/<\/dyad/g, "＜/dyad");
}

const CODEBASE_PROMPT_PREFIX = "This is my codebase.";
function createCodebasePrompt(codebaseInfo: string): string {
  return `${CODEBASE_PROMPT_PREFIX} ${codebaseInfo}`;
}

function createOtherAppsCodebasePrompt(otherAppsCodebaseInfo: string): string {
  return `
# Referenced Apps

These are the other apps that I've mentioned in my prompt. These other apps' codebases are READ-ONLY.

${otherAppsCodebaseInfo}
`;
}

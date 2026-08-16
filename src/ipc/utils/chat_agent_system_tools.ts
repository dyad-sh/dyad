import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { IpcMainInvokeEvent } from "electron";
import type { ToolExecutionOptions, ToolSet } from "ai";
import { z } from "zod";
import type { UserSettings } from "@/lib/schemas";
import type { ChatAgentToolPresentation } from "../types/chat_agent";
import { waitForConsent } from "./mcp_consent";

const execFileAsync = promisify(execFile);
const MAX_TERMINAL_OUTPUT = 30_000;
const MAX_PAGE_BYTES = 1_000_000;
const MAX_PAGE_TEXT = 20_000;

type ToolResultCallback = (result: {
  serverName: string;
  toolName: string;
  result: string;
  status: "completed" | "error";
  presentation?: ChatAgentToolPresentation;
}) => void;

async function confirmSystemAction(
  event: IpcMainInvokeEvent,
  toolName: string,
  description: string,
  preview: string,
) {
  const requestId = `chat-system:${toolName}:${crypto.randomUUID()}`;
  event.sender.send("mcp:tool-consent-request", {
    requestId,
    serverId: -1,
    serverName: "System Access",
    toolName,
    toolDescription: description,
    inputPreview: preview.slice(0, 1_000),
    chatId: -1,
  });
  const decision = await waitForConsent(requestId);
  return decision !== "decline";
}

function clip(value: string, max = MAX_TERMINAL_OUTPUT) {
  return value.length <= max
    ? value
    : `${value.slice(0, max)}\n\n[Output truncated]`;
}

async function runTerminalCommand(
  command: string,
  workingDirectory: string | undefined,
  timeoutSeconds: number,
) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, {
      cwd: workingDirectory || process.cwd(),
      env: process.env,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutSeconds * 1_000);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`Command timed out after ${timeoutSeconds} seconds.`));
        return;
      }
      const output = clip(
        [
          stdout.trim() && `stdout:\n${stdout.trim()}`,
          stderr.trim() && `stderr:\n${stderr.trim()}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      );
      if (code !== 0) {
        reject(
          new Error(
            `Command exited with code ${code}.${output ? `\n\n${output}` : ""}`,
          ),
        );
        return;
      }
      resolve(output || "Command completed with no output.");
    });
  });
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function stripHtmlToText(html: string) {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

async function readWebPage(urlValue: string) {
  const url = new URL(urlValue);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Browser use supports only HTTP and HTTPS URLs.");
  }
  if (url.username || url.password) {
    throw new Error("URLs containing embedded credentials are not allowed.");
  }
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
    headers: {
      Accept: "text/html,application/xhtml+xml,application/json,text/plain",
      "User-Agent": "Meta-Human-OS-Chat-Agent/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`.trim());
  }
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_PAGE_BYTES) {
    throw new Error("The page is too large for Chat Agent browser use.");
  }
  const raw = (await response.text()).slice(0, MAX_PAGE_BYTES);
  const contentType = response.headers.get("content-type") ?? "";
  const text = contentType.includes("html") ? stripHtmlToText(raw) : raw.trim();
  return JSON.stringify({
    url: response.url || url.toString(),
    title:
      /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(raw)?.[1]?.trim() ??
      url.hostname,
    content: clip(text, MAX_PAGE_TEXT),
  });
}

function escapeAppleScriptString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function performComputerAction(input: {
  action: "open_application" | "click" | "type_text" | "key_press";
  application?: string;
  x?: number;
  y?: number;
  text?: string;
  key?: string;
}) {
  if (process.platform !== "darwin") {
    throw new Error("Computer Use is currently available on macOS only.");
  }
  if (input.action === "open_application") {
    if (!input.application) throw new Error("Application name is required.");
    await execFileAsync("/usr/bin/open", ["-a", input.application]);
    return `Opened ${input.application}.`;
  }
  if (input.action === "click") {
    if (input.x == null || input.y == null) {
      throw new Error("Click coordinates are required.");
    }
    await execFileAsync("/usr/bin/osascript", [
      "-e",
      `tell application "System Events" to click at {${Math.round(input.x)}, ${Math.round(input.y)}}`,
    ]);
    return `Clicked at ${Math.round(input.x)}, ${Math.round(input.y)}.`;
  }
  if (input.action === "type_text") {
    if (!input.text) throw new Error("Text is required.");
    await execFileAsync("/usr/bin/osascript", [
      "-e",
      `tell application "System Events" to keystroke "${escapeAppleScriptString(input.text)}"`,
    ]);
    return "Typed the requested text.";
  }
  const keyCodes: Record<string, number> = {
    enter: 36,
    tab: 48,
    space: 49,
    backspace: 51,
    escape: 53,
    left: 123,
    right: 124,
    down: 125,
    up: 126,
  };
  const code = keyCodes[input.key?.toLowerCase() ?? ""];
  if (code == null) {
    throw new Error(
      `Unsupported key. Choose one of: ${Object.keys(keyCodes).join(", ")}.`,
    );
  }
  await execFileAsync("/usr/bin/osascript", [
    "-e",
    `tell application "System Events" to key code ${code}`,
  ]);
  return `Pressed ${input.key}.`;
}

function withResultReporting<T>(
  serverName: string,
  toolName: string,
  onToolResult: ToolResultCallback,
  operation: () => Promise<T>,
) {
  return operation()
    .then((value) => {
      const result = typeof value === "string" ? value : JSON.stringify(value);
      onToolResult({
        serverName,
        toolName,
        result: clip(result),
        status: "completed",
      });
      return result;
    })
    .catch((error) => {
      const result = error instanceof Error ? error.message : String(error);
      onToolResult({
        serverName,
        toolName,
        result,
        status: "error",
      });
      throw error;
    });
}

export function buildChatAgentSystemToolSet(
  event: IpcMainInvokeEvent,
  settings: UserSettings,
  onToolResult: ToolResultCallback,
): ToolSet {
  const access = settings.chatAgentSystemAccess;
  const tools: ToolSet = {};

  const x = settings.socialMedia?.x;
  if (x?.username) {
    const profileUrl = `https://x.com/${encodeURIComponent(x.username)}`;
    const profile = {
      username: x.username,
      displayName: x.displayName,
      profileImageUrl: x.profileImageUrl,
      bio: x.bio,
      verified: x.verified,
      verifiedType: x.verifiedType,
      followersCount: x.followersCount,
      followingCount: x.followingCount,
      postCount: x.postCount,
      profileSyncedAt: x.profileSyncedAt,
      profileUrl,
    };

    tools.get_connected_x_profile = {
      description:
        "Show the connected X account as a native profile card. Always call this for requests about the user's X profile, handle, bio, verification, followers, following, or post count; do not restate the card as Markdown.",
      inputSchema: z.object({}),
      execute: async () => {
        const result = JSON.stringify(profile);
        onToolResult({
          serverName: "X",
          toolName: "Connected X profile",
          result,
          status: "completed",
          presentation: { kind: "x-profile", ...profile },
        });
        return result;
      },
    };

    tools.compose_x_post = {
      description:
        "Open a native, editable X post composer for the connected account. Use whenever the user asks to create, write, draft, refine, or prepare an X post. Write the strongest ready-to-publish copy in content (maximum 280 characters). The card provides image generation, attachments, refinements, Post Now, and Schedule.",
      inputSchema: z.object({
        content: z.string().min(1).max(280),
        prompt: z.string().max(4_000).optional(),
        imagePrompt: z.string().max(4_000).optional(),
      }),
      execute: async (input: {
        content: string;
        prompt?: string;
        imagePrompt?: string;
      }) => {
        const payload = { ...profile, ...input };
        const result = JSON.stringify(payload);
        onToolResult({
          serverName: "X",
          toolName: "X post composer",
          result,
          status: "completed",
          presentation: {
            kind: "x-post-composer",
            username: profile.username,
            displayName: profile.displayName,
            profileImageUrl: profile.profileImageUrl,
            verified: profile.verified,
            ...input,
          },
        });
        return result;
      },
    };
  }

  if (access?.terminal === true) {
    const description =
      "Run a terminal command on the user's computer. Use only when the user explicitly asks for a terminal or system command. The user must approve every command.";
    tools.run_terminal_command = {
      description,
      inputSchema: z.object({
        command: z.string().min(1).max(8_000),
        workingDirectory: z.string().min(1).max(2_000).optional(),
        timeoutSeconds: z.number().int().min(1).max(120).default(60),
      }),
      execute: async (
        {
          command,
          workingDirectory,
          timeoutSeconds,
        }: {
          command: string;
          workingDirectory?: string;
          timeoutSeconds: number;
        },
        _options: ToolExecutionOptions,
      ) =>
        withResultReporting(
          "System Access",
          "Terminal command",
          onToolResult,
          async () => {
            const approved = await confirmSystemAction(
              event,
              "Terminal command",
              description,
              `${workingDirectory ? `Working directory: ${workingDirectory}\n` : ""}${command}`,
            );
            if (!approved) throw new Error("Terminal command was declined.");
            return runTerminalCommand(
              command,
              workingDirectory,
              timeoutSeconds,
            );
          },
        ),
    };
  }

  if (access?.browser === true) {
    tools.read_web_page = {
      description:
        "Open and read a specific HTTP or HTTPS page. Use after web search when a linked page needs closer inspection, or when the user supplies a URL.",
      inputSchema: z.object({ url: z.string().url().max(2_000) }),
      execute: async (
        { url }: { url: string },
        _options: ToolExecutionOptions,
      ) =>
        withResultReporting("System Access", "Browser read", onToolResult, () =>
          readWebPage(url),
        ),
    };
  }

  if (access?.computer === true) {
    const description =
      "Perform one basic macOS computer action. Use only when the user explicitly asks you to control their computer. The user must approve every action.";
    tools.use_computer = {
      description,
      inputSchema: z.object({
        action: z.enum(["open_application", "click", "type_text", "key_press"]),
        application: z.string().max(200).optional(),
        x: z.number().min(0).max(20_000).optional(),
        y: z.number().min(0).max(20_000).optional(),
        text: z.string().max(1_000).optional(),
        key: z
          .enum([
            "enter",
            "tab",
            "space",
            "backspace",
            "escape",
            "left",
            "right",
            "down",
            "up",
          ])
          .optional(),
      }),
      execute: async (
        input: Parameters<typeof performComputerAction>[0],
        _options: ToolExecutionOptions,
      ) =>
        withResultReporting(
          "System Access",
          "Computer action",
          onToolResult,
          async () => {
            const approved = await confirmSystemAction(
              event,
              "Computer action",
              description,
              JSON.stringify(input),
            );
            if (!approved) throw new Error("Computer action was declined.");
            return performComputerAction(input);
          },
        ),
    };
  }

  return tools;
}

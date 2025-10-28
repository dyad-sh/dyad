import { ipcMain } from "electron";
import { db } from "../../db";
import { apps, chats } from "../../db/schema";
import { eq } from "drizzle-orm";
import type { SecurityReviewResult, SecurityFinding } from "../ipc_types";
import * as fs from "node:fs";
import * as path from "node:path";
import { getDyadAppPath } from "../../paths/paths";

export function registerSecurityHandlers() {
  ipcMain.handle("get-latest-security-review", async (event, appId: number) => {
    if (!appId) {
      throw new Error("App ID is required");
    }

    // Find all chats for this app
    const appChats = await db.query.chats.findMany({
      where: eq(chats.appId, appId),
      with: {
        messages: {
          orderBy: (messages, { desc }) => [desc(messages.createdAt)],
        },
      },
      orderBy: (chats, { desc }) => [desc(chats.createdAt)],
    });

    // Search through messages to find one with security findings
    for (const chat of appChats) {
      for (const message of chat.messages) {
        if (
          message.role === "assistant" &&
          message.content.includes("<dyad-security-finding")
        ) {
          // Parse the security findings from the message
          const findings = parseSecurityFindings(message.content);

          if (findings.length > 0) {
            const result: SecurityReviewResult = {
              findings,
              timestamp: message.createdAt.toISOString(),
              chatId: chat.id,
            };
            return result;
          }
        }
      }
    }

    throw new Error("No security review found for this app");
  });

  // Read SECURITY_RULES.md for a given app
  ipcMain.handle("get-security-rules", async (_event, appId: number) => {
    if (!appId) {
      throw new Error("App ID is required");
    }

    const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
    if (!app) {
      throw new Error("App not found");
    }

    const appPath = getDyadAppPath(app.path);
    const rulesPath = path.join(appPath, "SECURITY_RULES.md");
    try {
      await fs.promises.access(rulesPath);
    } catch {
      return "";
    }
    const content = await fs.promises.readFile(rulesPath, "utf8");
    return content;
  });

  // Write SECURITY_RULES.md for a given app
  ipcMain.handle(
    "set-security-rules",
    async (
      _event,
      params: { appId: number; content: string },
    ): Promise<{ success: true }> => {
      const { appId, content } = params;
      if (!appId) {
        throw new Error("App ID is required");
      }
      const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
      if (!app) {
        throw new Error("App not found");
      }
      const appPath = getDyadAppPath(app.path);
      const rulesPath = path.join(appPath, "SECURITY_RULES.md");
      await fs.promises.writeFile(rulesPath, content ?? "", "utf8");
      return { success: true };
    },
  );
}

function parseSecurityFindings(content: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  // Regex to match dyad-security-finding tags
  const regex =
    /<dyad-security-finding\s+title="([^"]+)"\s+level="(critical|high|medium|low)">([^<]*(?:<(?!\/dyad-security-finding>)[^<]*)*)<\/dyad-security-finding>/gs;

  let match;
  while ((match = regex.exec(content)) !== null) {
    const [, title, level, description] = match;
    findings.push({
      title: title.trim(),
      level: level as "critical" | "high" | "medium" | "low",
      description: description.trim(),
    });
  }

  return findings;
}

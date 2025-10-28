import { ipcMain } from "electron";
import { db } from "../../db";
import { chats } from "../../db/schema";
import { eq } from "drizzle-orm";
import type { SecurityReviewResult, SecurityFinding } from "../ipc_types";

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
          message.content.includes("<security-finding")
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
}

function parseSecurityFindings(content: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  // Regex to match security-finding tags
  const regex =
    /<security-finding\s+title="([^"]+)"\s+level="(critical|high|medium|low)">([^<]*(?:<(?!\/security-finding>)[^<]*)*)<\/security-finding>/gs;

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

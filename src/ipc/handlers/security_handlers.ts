import { ipcMain } from "electron";
import { db } from "../../db";
import { chats, messages } from "../../db/schema";
import { eq, and, like, desc } from "drizzle-orm";
import type { SecurityReviewResult, SecurityFinding } from "../ipc_types";

export function registerSecurityHandlers() {
  ipcMain.handle("get-latest-security-review", async (event, appId: number) => {
    if (!appId) {
      throw new Error("App ID is required");
    }

    // Query for the most recent message with security findings
    // Use database filtering instead of loading all data into memory
    const result = await db
      .select({
        content: messages.content,
        createdAt: messages.createdAt,
        chatId: messages.chatId,
      })
      .from(messages)
      .innerJoin(chats, eq(messages.chatId, chats.id))
      .where(
        and(
          eq(chats.appId, appId),
          eq(messages.role, "assistant"),
          like(messages.content, "%<dyad-security-finding%"),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(1);

    if (result.length === 0) {
      throw new Error("No security review found for this app");
    }

    const message = result[0];
    const findings = parseSecurityFindings(message.content);

    if (findings.length === 0) {
      throw new Error("No security review found for this app");
    }

    return {
      findings,
      timestamp: message.createdAt.toISOString(),
      chatId: message.chatId,
    } satisfies SecurityReviewResult;
  });
}

function parseSecurityFindings(content: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  // Regex to match dyad-security-finding tags
  // Using lazy quantifier with proper boundaries to prevent catastrophic backtracking
  const regex =
    /<dyad-security-finding\s+title="([^"]+)"\s+level="(critical|high|medium|low)">([\s\S]*?)<\/dyad-security-finding>/g;

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

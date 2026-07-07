import { createHash } from "node:crypto";
import { db } from "../../db";
import { chats, messages, security_fix_chats } from "../../db/schema";
import { eq, and, like, desc } from "drizzle-orm";
import { createTypedHandler } from "./base";
import { securityContracts } from "../types/security";
import type { SecurityFinding } from "../types/security";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { createChatForApp } from "../utils/chat_creation_utils";
import log from "electron-log";

const logger = log.scope("security_handlers");

export function registerSecurityHandlers() {
  createTypedHandler(
    securityContracts.getLatestSecurityReview,
    async (_, appId) => {
      if (!appId) {
        throw new DyadError("App ID is required", DyadErrorKind.Validation);
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
        throw new DyadError(
          "No security review found for this app",
          DyadErrorKind.NotFound,
        );
      }

      const message = result[0];
      const findings = parseSecurityFindings(message.content);

      if (findings.length === 0) {
        throw new DyadError(
          "No security review found for this app",
          DyadErrorKind.NotFound,
        );
      }

      return {
        findings,
        timestamp: message.createdAt.toISOString(),
        chatId: message.chatId,
      };
    },
  );

  createTypedHandler(
    securityContracts.getOrCreateSecurityFixChat,
    async (_, { appId, reviewChatId, findings }) => {
      const findingKey = computeFindingKey(findings);
      const reviewChat = await db.query.chats.findFirst({
        where: and(eq(chats.id, reviewChatId), eq(chats.appId, appId)),
        columns: { id: true },
      });
      if (!reviewChat) {
        throw new DyadError(
          "Security review chat not found for this app",
          DyadErrorKind.NotFound,
        );
      }

      const findExisting = async () =>
        db.query.security_fix_chats.findFirst({
          where: and(
            eq(security_fix_chats.appId, appId),
            eq(security_fix_chats.reviewChatId, reviewChatId),
            eq(security_fix_chats.findingKey, findingKey),
          ),
        });

      const existing = await findExisting();
      if (existing) {
        return { chatId: existing.fixChatId, created: false };
      }

      const title =
        findings.length === 1
          ? `Fix: ${findings[0].title}`
          : `Fix ${findings.length} security issues`;

      const chatId = await createChatForApp({ appId, title });
      const cleanupCreatedChat = async () => {
        try {
          await db.delete(chats).where(eq(chats.id, chatId));
        } catch (cleanupError) {
          logger.error("Failed to clean up orphaned security fix chat", {
            chatId,
            cleanupError,
          });
        }
      };

      // The unique index on (appId, reviewChatId, findingKey) makes this safe
      // against concurrent clicks: only one insert wins.
      let inserted: Array<typeof security_fix_chats.$inferSelect>;
      try {
        inserted = await db
          .insert(security_fix_chats)
          .values({ appId, reviewChatId, findingKey, fixChatId: chatId })
          .onConflictDoNothing()
          .returning();
      } catch (error) {
        await cleanupCreatedChat();
        const currentReviewChat = await db.query.chats.findFirst({
          where: and(eq(chats.id, reviewChatId), eq(chats.appId, appId)),
          columns: { id: true },
        });
        if (!currentReviewChat) {
          throw new DyadError(
            "Security review chat not found for this app",
            DyadErrorKind.NotFound,
          );
        }
        throw error;
      }

      if (inserted.length === 0) {
        // Lost the race; discard the chat we just created and reuse the winner's.
        await cleanupCreatedChat();
        const winner = await findExisting();
        if (!winner) {
          throw new DyadError(
            "Failed to create security fix chat",
            DyadErrorKind.Internal,
          );
        }
        return { chatId: winner.fixChatId, created: false };
      }

      return { chatId, created: true };
    },
  );
}

function computeFindingKey(findings: SecurityFinding[]): string {
  const hashes = findings
    .map((finding) =>
      createHash("sha256")
        .update(
          JSON.stringify([
            finding.title.trim(),
            finding.level,
            finding.description.trim(),
          ]),
        )
        .digest("hex"),
    )
    .sort();
  if (hashes.length === 1) {
    return hashes[0];
  }
  return createHash("sha256").update(hashes.join("|")).digest("hex");
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

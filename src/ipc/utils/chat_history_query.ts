import { db } from "@/db";
import { messages } from "@/db/schema";
import { and, desc, eq, lt } from "drizzle-orm";

/**
 * Finds the first message needed to reconstruct the LLM-visible history after
 * the latest compaction. Undefined means no compaction boundary exists and the
 * full history is still needed.
 */
export async function getPostCompactionMessageStartId(
  chatId: number,
): Promise<number | undefined> {
  const latestSummary = await db.query.messages.findFirst({
    where: and(
      eq(messages.chatId, chatId),
      eq(messages.isCompactionSummary, true),
    ),
    columns: { id: true },
    orderBy: [desc(messages.id)],
  });
  if (!latestSummary) return undefined;

  const triggeringUser = await db.query.messages.findFirst({
    where: and(
      eq(messages.chatId, chatId),
      eq(messages.role, "user"),
      lt(messages.id, latestSummary.id),
    ),
    columns: { id: true },
    orderBy: [desc(messages.id)],
  });

  return triggeringUser?.id ?? latestSummary.id;
}

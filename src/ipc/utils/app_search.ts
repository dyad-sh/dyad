import { and, desc, eq, like, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { db } from "../../db";
import { apps, chats, messages } from "../../db/schema";
import type { AppSearchResult } from "@/lib/schemas";

// Characters of message content returned on each side of the match. Must stay
// larger than the snippet radius AppSearchDialog renders so it can still tell
// whether the message continues past the snippet.
const MATCHED_MESSAGE_RADIUS = 100;

export async function searchApps(
  searchQuery: string,
): Promise<AppSearchResult[]> {
  // Use parameterized query to prevent SQL injection
  const pattern = `%${searchQuery.replace(/[%_]/g, "\\$&")}%`;

  // 1) Apps whose name matches
  const appNameMatches = await db
    .select({
      id: apps.id,
      name: apps.name,
      createdAt: apps.createdAt,
    })
    .from(apps)
    .where(like(apps.name, pattern))
    .orderBy(desc(apps.createdAt));

  const appNameMatchesResult: AppSearchResult[] = appNameMatches.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.createdAt,
    matchedChatTitle: null,
    matchedChatMessage: null,
  }));

  // 2) Apps whose chat title matches
  const chatTitleMatches = await db
    .select({
      id: apps.id,
      name: apps.name,
      createdAt: apps.createdAt,
      matchedChatTitle: chats.title,
    })
    .from(apps)
    .innerJoin(chats, eq(apps.id, chats.appId))
    .where(like(chats.title, pattern))
    .orderBy(desc(apps.createdAt));

  const chatTitleMatchesResult: AppSearchResult[] = chatTitleMatches.map(
    (r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.createdAt,
      matchedChatTitle: r.matchedChatTitle,
      matchedChatMessage: null,
    }),
  );

  // 3) Apps whose chat message content matches. Only one matching message per
  // app is needed, and only the text around the match, so this stops at the
  // first match per app.
  const candidateChats = alias(chats, "candidate_chats");
  const candidateMessages = alias(messages, "candidate_messages");
  const firstMatchingMessageId = db
    .select({ id: candidateMessages.id })
    .from(candidateChats)
    .innerJoin(
      candidateMessages,
      eq(candidateMessages.chatId, candidateChats.id),
    )
    .where(
      and(
        eq(candidateChats.appId, apps.id),
        like(candidateMessages.content, pattern),
      ),
    )
    .limit(1);

  const chatMessageMatches = await db
    .select({
      id: apps.id,
      name: apps.name,
      createdAt: apps.createdAt,
      matchedChatTitle: chats.title,
      matchedChatMessage: sql<string>`substr(
        ${messages.content},
        max(1, instr(lower(${messages.content}), lower(${searchQuery})) - ${MATCHED_MESSAGE_RADIUS}),
        ${searchQuery.length + 2 * MATCHED_MESSAGE_RADIUS}
      )`,
    })
    .from(apps)
    .innerJoin(messages, eq(messages.id, sql`(${firstMatchingMessageId})`))
    .innerJoin(chats, eq(chats.id, messages.chatId))
    .orderBy(desc(apps.createdAt));

  // Flatten and dedupe by app id
  const allMatches: AppSearchResult[] = [
    ...appNameMatchesResult,
    ...chatTitleMatchesResult,
    ...chatMessageMatches,
  ];
  const uniqueApps = Array.from(
    new Map(allMatches.map((app) => [app.id, app])).values(),
  );

  // Sort newest apps first
  uniqueApps.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return uniqueApps;
}

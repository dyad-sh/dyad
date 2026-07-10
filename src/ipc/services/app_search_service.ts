import { db } from "../../db";
import { apps, chats, messages } from "../../db/schema";
import { desc, eq, sql } from "drizzle-orm";
import type { AppSearchResult } from "@/lib/schemas";
import { truncateUtf8 } from "../utils/result_limits";
import { isAppSearchQueryLongEnough } from "../types/app";

export const MAX_APP_SEARCH_RESULTS = 50;
export const MAX_APP_SEARCH_TEXT_BYTES = 1024;
const SOURCE_QUERY_LIMIT = MAX_APP_SEARCH_RESULTS + 1;
const SQL_SNIPPET_RADIUS = 100;
const SQL_SNIPPET_CHARACTERS = SQL_SNIPPET_RADIUS * 2 + 200;
const SQL_APP_NAME_CHARACTERS = 256;

function normalizeSearchText(value: string | null): string | null {
  return value === null
    ? null
    : truncateUtf8(value, MAX_APP_SEARCH_TEXT_BYTES).text;
}

function normalizeResult(result: AppSearchResult): AppSearchResult {
  return {
    ...result,
    name: normalizeSearchText(result.name) ?? "",
    matchedChatTitle: normalizeSearchText(result.matchedChatTitle),
    matchedChatMessage: normalizeSearchText(result.matchedChatMessage),
  };
}

function matchingSnippet(
  column: typeof chats.title | typeof messages.content,
  query: string,
) {
  return sql<string | null>`
    CASE
      WHEN ${column} IS NULL
        OR instr(lower(${column}), lower(${query})) = 0 THEN NULL
      ELSE substr(
        ${column},
        max(1, instr(lower(${column}), lower(${query})) - ${SQL_SNIPPET_RADIUS}),
        ${SQL_SNIPPET_CHARACTERS}
      )
    END
  `;
}

/** Search app names and chat text without loading unbounded matching rows. */
export async function searchAppsWithResultLimits(
  rawQuery: string,
): Promise<AppSearchResult[]> {
  const query = rawQuery.trim();
  if (!isAppSearchQueryLongEnough(query)) return [];

  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;

  const appNameMatches = await db
    .select({
      id: apps.id,
      name: sql<string>`substr(${apps.name}, 1, ${SQL_APP_NAME_CHARACTERS})`,
      createdAt: apps.createdAt,
    })
    .from(apps)
    .where(sql`${apps.name} LIKE ${pattern} ESCAPE '\\'`)
    .orderBy(desc(apps.createdAt))
    .limit(SOURCE_QUERY_LIMIT);

  const chatTitleMatches = await db
    .select({
      id: apps.id,
      name: sql<string>`substr(${apps.name}, 1, ${SQL_APP_NAME_CHARACTERS})`,
      createdAt: apps.createdAt,
      matchedChatTitle: matchingSnippet(chats.title, query),
    })
    .from(apps)
    .innerJoin(chats, eq(apps.id, chats.appId))
    .where(sql`${chats.title} LIKE ${pattern} ESCAPE '\\'`)
    .groupBy(apps.id)
    .orderBy(desc(apps.createdAt))
    .limit(SOURCE_QUERY_LIMIT);

  const chatMessageMatches = await db
    .select({
      id: apps.id,
      name: sql<string>`substr(${apps.name}, 1, ${SQL_APP_NAME_CHARACTERS})`,
      createdAt: apps.createdAt,
      matchedChatTitle: matchingSnippet(chats.title, query),
      matchedChatMessage: matchingSnippet(messages.content, query),
    })
    .from(apps)
    .innerJoin(chats, eq(apps.id, chats.appId))
    .innerJoin(messages, eq(chats.id, messages.chatId))
    .where(sql`${messages.content} LIKE ${pattern} ESCAPE '\\'`)
    .groupBy(apps.id)
    .orderBy(desc(apps.createdAt))
    .limit(SOURCE_QUERY_LIMIT);

  const sourceTruncated = [
    appNameMatches,
    chatTitleMatches,
    chatMessageMatches,
  ].some((matches) => matches.length > MAX_APP_SEARCH_RESULTS);
  const appNameResults: AppSearchResult[] = appNameMatches
    .slice(0, MAX_APP_SEARCH_RESULTS)
    .map((result) => ({
      ...result,
      matchedChatTitle: null,
      matchedChatMessage: null,
    }));
  const chatTitleResults: AppSearchResult[] = chatTitleMatches
    .slice(0, MAX_APP_SEARCH_RESULTS)
    .map((result) => ({
      ...result,
      matchedChatMessage: null,
    }));
  const allMatches = [
    ...appNameResults,
    ...chatTitleResults,
    ...chatMessageMatches.slice(0, MAX_APP_SEARCH_RESULTS),
  ].map(normalizeResult);
  const uniqueApps = Array.from(
    new Map(allMatches.map((appResult) => [appResult.id, appResult])).values(),
  ).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const truncated =
    sourceTruncated || uniqueApps.length > MAX_APP_SEARCH_RESULTS;

  return uniqueApps.slice(0, MAX_APP_SEARCH_RESULTS).map((result) =>
    truncated
      ? {
          ...result,
          searchTruncated: true,
        }
      : result,
  );
}

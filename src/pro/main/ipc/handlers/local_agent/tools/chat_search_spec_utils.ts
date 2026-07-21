/**
 * Test-only helpers shared by the chat-search specs. Not a .spec file so
 * vitest does not collect it directly.
 */
import { vi } from "vitest";
import { setDatabaseForTesting } from "@/db";
import { createInMemoryTestDb, type TestDb } from "@/testing/test_db";
import type { AgentContext } from "./types";

export interface ChatSearchTestHarness {
  testDb: TestDb;
  dispose: () => void;
  insertApp: (name?: string) => number;
  insertChat: (appId: number, title?: string | null) => number;
  insertMessage: (params: {
    chatId: number;
    role: "user" | "assistant";
    content: string;
    createdAt?: number;
    isCompactionSummary?: boolean;
  }) => number;
}

let nextTimestamp = 1_700_000_000;

export function setupChatSearchTestDb(): ChatSearchTestHarness {
  const testDb = createInMemoryTestDb();
  setDatabaseForTesting(testDb);
  const client = testDb.$client;

  return {
    testDb,
    dispose: () => {
      setDatabaseForTesting(null);
      client.close();
    },
    insertApp: (name = "test-app") => {
      const result = client
        .prepare(`INSERT INTO apps (name, path) VALUES (?, ?)`)
        .run(name, `/apps/${name}`);
      return Number(result.lastInsertRowid);
    },
    insertChat: (appId, title = null) => {
      const result = client
        .prepare(`INSERT INTO chats (app_id, title) VALUES (?, ?)`)
        .run(appId, title);
      return Number(result.lastInsertRowid);
    },
    insertMessage: ({
      chatId,
      role,
      content,
      createdAt,
      isCompactionSummary,
    }) => {
      const result = client
        .prepare(
          `INSERT INTO messages (chat_id, role, content, created_at, is_compaction_summary)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          chatId,
          role,
          content,
          createdAt ?? nextTimestamp++,
          isCompactionSummary ? 1 : 0,
        );
      return Number(result.lastInsertRowid);
    },
  };
}

export function makeAgentContext(
  overrides: Partial<AgentContext> = {},
): AgentContext {
  return {
    event: {} as any,
    appId: 1,
    appPath: "/test/app",
    referencedApps: new Map(),
    chatId: 1,
    supabaseProjectId: null,
    supabaseOrganizationSlug: null,
    neonProjectId: null,
    neonActiveBranchId: null,
    frameworkType: null,
    messageId: 1,
    isSharedModulesChanged: false,
    sharedServerModulePaths: [],
    pendingFunctionDeploys: [],
    isDyadPro: false,
    todos: [],
    dyadRequestId: "test-request",
    fileEditTracker: {},
    testingEnabled: false,
    testRunAttempts: new Map(),
    onXmlStream: vi.fn(),
    onXmlComplete: vi.fn(),
    requireConsent: vi.fn().mockResolvedValue(true),
    appendUserMessage: vi.fn(),
    onUpdateTodos: vi.fn(),
    ...overrides,
  };
}

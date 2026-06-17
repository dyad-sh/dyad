import { setDatabaseForTesting } from "@/db";
import { getRegisteredHandlerForTesting } from "@/ipc/handlers/base";
import {
  type HandlerContext,
  setHandlerContextForTesting,
} from "@/ipc/handlers/handler_context";
import type { GitService } from "@/ipc/services/git_service";
import { DEFAULT_SETTINGS } from "@/main/settings";
import type { UserSettings } from "@/lib/schemas";
import { createInMemoryTestDb, type TestDb } from "./test_db";

/**
 * Recording stand-in for GitService. Returns deterministic fake hashes and
 * records every call for assertions.
 */
export class FakeGitService implements GitService {
  calls: Array<{ method: keyof GitService; args: Record<string, unknown> }> =
    [];
  /** Controls whether stageAllAndCommitIfChanged reports staged changes. */
  hasChangesToCommit = true;
  private commitCount = 0;

  private record(method: keyof GitService, args: Record<string, unknown>) {
    this.calls.push({ method, args });
    this.commitCount += 1;
    return `fake-commit-hash-${this.commitCount}`;
  }

  async initRepoWithInitialCommit(args: {
    path: string;
    message?: string;
    ref?: string;
  }): Promise<string> {
    return this.record("initRepoWithInitialCommit", args);
  }

  async stageAllAndCommit(args: {
    path: string;
    message: string;
  }): Promise<string> {
    return this.record("stageAllAndCommit", args);
  }

  async stageAllAndCommitIfChanged(args: {
    path: string;
    message: string;
  }): Promise<string | null> {
    if (!this.hasChangesToCommit) {
      this.calls.push({ method: "stageAllAndCommitIfChanged", args });
      return null;
    }
    return this.record("stageAllAndCommitIfChanged", args);
  }

  async commitFile(args: {
    path: string;
    filepath: string;
    message: string;
  }): Promise<string> {
    return this.record("commitFile", args);
  }
}

export interface HandlerTestHarness {
  ctx: HandlerContext;
  /** Real in-memory SQLite db with migrations applied. Seed it with drizzle. */
  db: TestDb;
  gitService: FakeGitService;
  /** Everything handlers sent to the renderer via ctx.safeSend. */
  sentMessages: Array<{ channel: string; args: unknown[] }>;
  /** Current settings as seen by ctx.readSettings(). */
  readSettings: () => UserSettings;
  /** Replaces settings (shallow merge, mirroring writeSettings semantics). */
  writeSettings: (partial: Partial<UserSettings>) => void;
  /**
   * Invokes a handler registered via createTypedHandler by channel name.
   * Call the module's register*Handlers() before using this.
   */
  invokeHandler: <TOutput = unknown>(
    channel: string,
    input?: unknown,
    event?: unknown,
  ) => Promise<TOutput>;
  /** Restores the production context and closes the in-memory db. */
  dispose: () => void;
}

/**
 * One-call setup for handler unit tests:
 *
 * - creates a real in-memory db (also installed as the global `db` proxy
 *   target, so handlers with direct `import { db }` work too)
 * - installs a HandlerContext with in-memory settings, a FakeGitService, and
 *   a safeSend recorder
 *
 * Usage:
 * ```ts
 * let harness: HandlerTestHarness;
 * beforeEach(() => {
 *   harness = setupHandlerTestHarness();
 *   registerMyHandlers();
 * });
 * afterEach(() => harness.dispose());
 *
 * it("creates a thing", async () => {
 *   const result = await harness.invokeHandler("things:create", { name: "x" });
 *   ...assert against harness.db / harness.sentMessages...
 * });
 * ```
 */
export function setupHandlerTestHarness(options?: {
  settings?: Partial<UserSettings>;
}): HandlerTestHarness {
  const testDb = createInMemoryTestDb();
  setDatabaseForTesting(testDb);

  let settings: UserSettings = {
    ...structuredClone(DEFAULT_SETTINGS),
    ...options?.settings,
  };
  const gitService = new FakeGitService();
  const sentMessages: Array<{ channel: string; args: unknown[] }> = [];

  const ctx: HandlerContext = {
    db: testDb,
    readSettings: () => settings,
    writeSettings: (partial) => {
      settings = { ...settings, ...partial };
    },
    gitService,
    safeSend: (_sender, channel, ...args) => {
      sentMessages.push({ channel, args });
    },
  };
  setHandlerContextForTesting(ctx);

  return {
    ctx,
    db: testDb,
    gitService,
    sentMessages,
    readSettings: () => settings,
    writeSettings: ctx.writeSettings,
    invokeHandler: async <TOutput>(
      channel: string,
      input?: unknown,
      event: unknown = {},
    ) => {
      const handler = getRegisteredHandlerForTesting(channel);
      return (await handler(event as any, input)) as TOutput;
    },
    dispose: () => {
      setHandlerContextForTesting(null);
      setDatabaseForTesting(null);
      testDb.$client.close();
    },
  };
}

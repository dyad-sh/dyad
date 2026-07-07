/**
 * setupChatFlowHarness — a fast, parallel-safe vitest integration harness that
 * exercises the REAL dyad chat flow without launching Electron.
 *
 * What is real: the `chat:stream` IPC handler, a real sqlite db built by the
 * app's own `initializeDatabase()`, real settings via `writeSettings`, a real
 * git checkout of an e2e fixture app, the real AI-SDK streaming client talking
 * HTTP to the real fake-LLM server (the same one the Playwright suite uses,
 * serving `e2e-tests/fixtures/*.md` via the `tc=<name>` protocol), and the real
 * response processor (dyad-tag parsing, file writes, git commits, db messages).
 *
 * What is mocked: only the `electron` module (see ./electron_mock).
 *
 * Parallel safety: every instance uses an ephemeral port (listen on 0), a
 * unique temp dir keyed by pid + randomness, and a private fake-LLM dump dir.
 * `dispose()` closes the server + db and removes the temp dir. Because the app's
 * `db` is a process singleton, use ONE harness per test file.
 *
 * See ./CHAT_FLOW_HARNESS.md for the migration cookbook.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { closeDatabase, db, initializeDatabase } from "@/db";
import {
  apps,
  chats,
  language_model_providers,
  language_models,
  messages,
} from "@/db/schema";
import { registerChatStreamHandlers } from "@/ipc/handlers/chat_stream_handlers";
import type { ChatStreamParams } from "@/ipc/types";
import { writeSettings } from "@/main/settings";
import type { UserSettings } from "@/lib/schemas";
import { asc, eq } from "drizzle-orm";

import { generateAppFilesSnapshotData } from "../../e2e-tests/helpers/generateAppFilesSnapshotData";
import {
  createFakeIpcEvent,
  type ElectronMockShared,
  type RendererEvent,
} from "./electron_mock";
import {
  readServerDump,
  type ServerDumpOptions,
  type ServerDumpResult,
} from "./server_dump";
import {
  startFakeLlmServer,
  type FakeLlmServerHandle,
} from "../../testing/fake-llm-server/index";

const REPO_ROOT = process.cwd();
const FIXTURES_ROOT = path.join(REPO_ROOT, "e2e-tests", "fixtures");
const IMPORT_APP_FIXTURES = path.join(FIXTURES_ROOT, "import-app");

export interface ChatFlowHarnessOptions {
  /**
   * The hoisted electron-mock shared object (the SAME one passed to
   * `vi.mock("electron", ...)`). Its `ipcHandlers` map is how the harness
   * invokes `chat:stream`. Required.
   */
  electronMock: ElectronMockShared;
  /** Import-app fixture to check out. Default "minimal". */
  fixtureApp?: string;
  /** Provider row + model row overrides (defaults mirror the e2e test provider). */
  provider?: { id?: string; name?: string; apiBaseUrl?: string };
  model?: {
    displayName?: string;
    apiName?: string;
    maxOutputTokens?: number;
    contextWindow?: number;
  };
  /** Convenience settings knobs (merged into the settings file). */
  selectedModel?: { provider: string; name: string };
  chatMode?: UserSettings["selectedChatMode"];
  autoApprove?: boolean;
  enableNativeGit?: boolean;
  /** Arbitrary extra settings overrides (highest precedence). */
  settings?: Partial<UserSettings>;
  /**
   * Point the app's language-model catalog fetch at the fake server. Default
   * true (matches the e2e setup). Set false to leave the env var untouched.
   */
  useFakeCatalog?: boolean;
  /** Show the fake-LLM server's per-request logs. Default false (quiet). */
  verboseFakeLlm?: boolean;
}

export interface StreamChatResult {
  chatId: number;
  /** Whatever the handler returned (the chatId on success, "error" on failure). */
  result: unknown;
  /** All renderer `event.sender.send(...)` events captured during the stream. */
  events: RendererEvent[];
  /** The chat's messages, freshly read from the db (ascending by id). */
  messages: Array<typeof messages.$inferSelect>;
  /** First captured event on `channel`, if any. */
  event: (channel: string) => RendererEvent | undefined;
  /** All captured events on `channel`. */
  eventsFor: (channel: string) => RendererEvent[];
  /** Read + normalize the fake server's request dump (see getServerDump). */
  getServerDump: (options?: ServerDumpOptions) => ServerDumpResult;
}

export interface ChatFlowHarness {
  db: typeof db;
  appDir: string;
  appId: number;
  chatId: number;
  userDataDir: string;
  fakeLlmUrl: string;
  fakeLlmPort: number;
  /** The hoisted electron-mock object (handlers, listeners). */
  electronMock: ElectronMockShared;

  /** Send a prompt through the real `chat:stream` handler; resolves at stream end. */
  streamChat: (
    prompt: string,
    options?: Partial<Omit<ChatStreamParams, "chatId" | "prompt">> & {
      chatId?: number;
    },
  ) => Promise<StreamChatResult>;

  /** Read + normalize a fake-server request dump across all chat messages. */
  getServerDump: (options?: ServerDumpOptions) => ServerDumpResult;

  /** Snapshot of the checked-out app files (sorted, ignored files removed). */
  getAppFiles: () => Array<{ relativePath: string; content: string }>;
  /** Read a single app file (relative path), or throw if missing. */
  readAppFile: (relativePath: string) => string;
  /** Whether an app file exists (relative path). */
  appFileExists: (relativePath: string) => boolean;
  /** One-line git log of the app repo, newest first. */
  gitLog: () => string[];

  dispose: () => Promise<void>;
}

function git(appDir: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test User", ...args],
    { cwd: appDir, stdio: "pipe" },
  ).toString();
}

export async function setupChatFlowHarness(
  options: ChatFlowHarnessOptions,
): Promise<ChatFlowHarness> {
  const { electronMock } = options;
  if (!electronMock?.ipcHandlers) {
    throw new Error(
      "setupChatFlowHarness requires { electronMock } — the hoisted object " +
        'passed to vi.mock("electron", ...). See CHAT_FLOW_HARNESS.md.',
    );
  }

  // NODE_ENV must be "development" before app modules are imported; the hoisted
  // preamble normally sets it, but assert here to fail loudly if it wasn't.
  if (process.env.NODE_ENV !== "development") {
    process.env.NODE_ENV = "development";
  }

  const fixtureApp = options.fixtureApp ?? "minimal";
  const fixtureAppDir = path.join(IMPORT_APP_FIXTURES, fixtureApp);
  if (!fs.existsSync(fixtureAppDir)) {
    throw new Error(`Unknown fixture app: ${fixtureApp} (${fixtureAppDir})`);
  }

  // Unique, collision-proof temp root (pid + randomness), parallel-safe.
  const tmpRoot = path.join(
    os.tmpdir(),
    `dyad-chat-flow-${process.pid}-${Math.random().toString(36).slice(2, 10)}`,
  );
  const userDataDir = path.join(tmpRoot, "userData");
  const dumpDir = path.join(tmpRoot, "fake-llm-dumps");
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(dumpDir, { recursive: true });

  process.env.DYAD_DEV_USER_DATA_DIR = userDataDir;
  process.env.FAKE_LLM_DUMP_DIR = dumpDir;
  process.env.FAKE_LLM_FIXTURES_DIR = FIXTURES_ROOT;
  if (!options.verboseFakeLlm) {
    process.env.FAKE_LLM_QUIET = "1";
  }

  // 1. Fake LLM server on an ephemeral port.
  const fakeLlm: FakeLlmServerHandle = await startFakeLlmServer();
  const fakeLlmUrl = fakeLlm.url;

  if (options.useFakeCatalog !== false) {
    process.env.DYAD_LANGUAGE_MODEL_CATALOG_URL = `${fakeLlmUrl}/api/language-model-catalog`;
  }

  // 2. Real sqlite db (drizzle migrations) in the temp userData dir.
  initializeDatabase();

  // 3. Settings file via the app's own writer (mirrors the e2e test provider).
  const settings: Partial<UserSettings> = {
    selectedModel: options.selectedModel ?? {
      provider: options.provider?.id ?? "testing",
      name: options.model?.apiName ?? "test-model",
    },
    selectedChatMode: options.chatMode ?? "build",
    autoApproveChanges: options.autoApprove ?? true,
    enableNativeGit: options.enableNativeGit ?? true,
    hasRunBefore: true,
    ...options.settings,
  };
  writeSettings(settings);

  // 4. Custom provider + model rows (same shape the Settings UI creates).
  const providerId = options.provider?.id ?? "testing";
  await db.insert(language_model_providers).values({
    id: providerId,
    name: options.provider?.name ?? "test-provider",
    api_base_url: options.provider?.apiBaseUrl ?? `${fakeLlmUrl}/v1`,
  });
  await db.insert(language_models).values({
    displayName: options.model?.displayName ?? "test-model",
    apiName: options.model?.apiName ?? "test-model",
    customProviderId: providerId,
    max_output_tokens: options.model?.maxOutputTokens ?? 8192,
    context_window: options.model?.contextWindow ?? 128_000,
  });

  // 5. Real app checkout of the fixture + a real git repo.
  const appDir = path.join(tmpRoot, "app");
  fs.cpSync(fixtureAppDir, appDir, { recursive: true });
  git(appDir, "init");
  git(appDir, "add", "-A");
  git(appDir, "commit", "-m", "init");

  const [appRow] = await db
    .insert(apps)
    .values({ name: fixtureApp, path: appDir })
    .returning();
  const [chatRow] = await db
    .insert(chats)
    .values({ appId: appRow.id })
    .returning();

  registerChatStreamHandlers();

  const appId = appRow.id;
  const chatId = chatRow.id;

  const loadMessages = () =>
    db.query.messages.findMany({
      where: eq(messages.chatId, chatId),
      orderBy: [asc(messages.id)],
    });

  // Dump files are named `<timestamp>-<rand>.json`, so a lexical sort is
  // chronological. dumpIndex -1 (default) selects the newest, matching the
  // order the Playwright PageObject sees when scanning message text.
  const listDumpPaths = (): string[] => {
    if (!fs.existsSync(dumpDir)) {
      return [];
    }
    return fs
      .readdirSync(dumpDir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => path.join(dumpDir, f));
  };

  const getServerDump = (opts?: ServerDumpOptions): ServerDumpResult =>
    readServerDump(listDumpPaths(), opts);

  const streamChat = async (
    prompt: string,
    streamOptions: Partial<Omit<ChatStreamParams, "chatId" | "prompt">> & {
      chatId?: number;
    } = {},
  ): Promise<StreamChatResult> => {
    const handler = electronMock.ipcHandlers.get("chat:stream");
    if (!handler) {
      throw new Error(
        "chat:stream handler not registered — did registerChatStreamHandlers run?",
      );
    }
    const events: RendererEvent[] = [];
    const event = createFakeIpcEvent(events);
    const { chatId: overrideChatId, ...rest } = streamOptions;
    const result = await handler(event, {
      chatId: overrideChatId ?? chatId,
      prompt,
      ...rest,
    });
    const msgs = await loadMessages();
    return {
      chatId: overrideChatId ?? chatId,
      result,
      events,
      messages: msgs,
      event: (channel) => events.find((e) => e.channel === channel),
      eventsFor: (channel) => events.filter((e) => e.channel === channel),
      getServerDump,
    };
  };

  const getAppFiles = () => {
    const data = generateAppFilesSnapshotData(appDir, appDir);
    return data
      .filter((f) => f.relativePath !== ".gitattributes")
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  };

  const readAppFile = (relativePath: string): string => {
    const full = path.join(appDir, relativePath);
    if (!fs.existsSync(full)) {
      throw new Error(`App file not found: ${relativePath}`);
    }
    return fs.readFileSync(full, "utf-8");
  };

  const appFileExists = (relativePath: string): boolean =>
    fs.existsSync(path.join(appDir, relativePath));

  const gitLog = (): string[] =>
    git(appDir, "log", "--oneline").trim().split("\n").filter(Boolean);

  const dispose = async (): Promise<void> => {
    try {
      await fakeLlm.close();
    } catch {
      // ignore
    }
    try {
      closeDatabase();
    } catch {
      // ignore
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  };

  return {
    db,
    appDir,
    appId,
    chatId,
    userDataDir,
    fakeLlmUrl,
    fakeLlmPort: fakeLlm.port,
    electronMock,
    streamChat,
    getServerDump,
    getAppFiles,
    readAppFile,
    appFileExists,
    gitLog,
    dispose,
  };
}

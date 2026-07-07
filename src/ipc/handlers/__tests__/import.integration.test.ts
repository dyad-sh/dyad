// @vitest-environment node
//
// Migrated from e2e-tests/import.spec.ts.
//
// The e2e drove the ImportAppDialog UI (folder picker stubbed via
// electron-playwright-helpers). The dialog's form/validation behaviors are
// renderer-only and are dropped; the backend behaviors — the real
// `import-app` / `check-ai-rules` / `check-app-name` IPC handlers — are
// exercised directly here:
//  - importing copies the folder into the dyad-apps directory, initializes a
//    git repo, and creates the app + initial chat rows;
//  - the post-import AI_RULES generation chat turn (sent by the renderer when
//    the imported app has no AI_RULES.md) flows through chat:stream;
//  - importing an app that has AI_RULES.md keeps those rules and they are sent
//    to the LLM as part of the codebase payload;
//  - custom install/start commands are persisted on the app row, empty ones
//    fall back to null (defaults).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";
import { registerImportHandlers } from "@/ipc/handlers/import_handlers";
import { invalidateDyadAppsBaseDirectoryCache } from "@/paths/paths";
import { isIpcInvokeEnvelope, unwrapIpcEnvelope } from "@/ipc/contracts/core";
import { db } from "@/db";
import { apps, chats, messages as messagesTable } from "@/db/schema";
import { asc, eq } from "drizzle-orm";

const FIXTURES = path.join(
  process.cwd(),
  "e2e-tests",
  "fixtures",
  "import-app",
);

// Same prompt the renderer (ImportAppDialog) sends after importing an app
// without AI_RULES.md.
const AI_RULES_PROMPT =
  "Generate an AI_RULES.md file for this app. Describe the tech stack in 5-10 bullet points and describe clear rules about what libraries to use for what.";

const fakeEvent = { sender: { send: () => {}, isDestroyed: () => false } };

// Invoke a registered IPC handler and unwrap the dyad IPC envelope, i.e.
// behave like the renderer's ipc client (errors reject).
async function invoke(channel: string, params?: unknown): Promise<any> {
  const handler = h.ipcHandlers.get(channel);
  if (!handler) {
    throw new Error(`No handler registered for ${channel}`);
  }
  const response = await handler(fakeEvent, params);
  return isIpcInvokeEnvelope(response) ? unwrapIpcEnvelope(response) : response;
}

describe("import app (integration)", () => {
  let harness: ChatFlowHarness;
  let appsBaseDir: string;

  beforeAll(async () => {
    appsBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-import-apps-"));
    harness = await setupChatFlowHarness({
      electronMock: h,
      settings: { customAppsFolder: appsBaseDir },
    });
    invalidateDyadAppsBaseDirectoryCache();
    registerImportHandlers();
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
    fs.rmSync(appsBaseDir, { recursive: true, force: true });
  });

  it("imports an app: copies files, inits git, creates app + chat, and runs the AI_RULES turn", async () => {
    // The minimal fixture has no AI_RULES.md (this is what makes the renderer
    // send the AI_RULES generation prompt after import).
    const aiRules = await invoke("check-ai-rules", {
      path: path.join(FIXTURES, "minimal"),
    });
    expect(aiRules).toEqual({ exists: false });

    const result = await invoke("import-app", {
      path: path.join(FIXTURES, "minimal"),
      appName: "minimal-imported-app",
    });
    expect(result.appId).toBeGreaterThan(0);
    expect(result.chatId).toBeGreaterThan(0);

    // Copied into the dyad-apps directory with a fresh git repo.
    const importedDir = path.join(appsBaseDir, "minimal-imported-app");
    expect(fs.existsSync(path.join(importedDir, "src", "App.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(importedDir, ".git"))).toBe(true);

    // App + chat rows created; no custom commands means null (defaults).
    const appRow = await db.query.apps.findFirst({
      where: eq(apps.id, result.appId),
    });
    expect(appRow?.name).toBe("minimal-imported-app");
    expect(appRow?.path).toBe("minimal-imported-app");
    expect(appRow?.installCommand).toBeNull();
    expect(appRow?.startCommand).toBeNull();
    const chatRow = await db.query.chats.findFirst({
      where: eq(chats.id, result.chatId),
    });
    expect(chatRow?.appId).toBe(result.appId);

    // The name is now taken (backend behind the dialog's name validation).
    await expect(
      invoke("check-app-name", { appName: "minimal-imported-app" }),
    ).resolves.toEqual({ exists: true });

    // Mirror the renderer: it streams the AI_RULES prompt into the new chat.
    // The fake LLM answers with the canned <dyad-write path="file1.txt">.
    const { result: streamResult } = await harness.streamChat(AI_RULES_PROMPT, {
      chatId: result.chatId,
    });
    expect(streamResult).toBe(result.chatId);
    // Note: streamChat().messages always reflects the harness's own chat, so
    // read the imported chat's messages from the db directly.
    const messages = await db.query.messages.findMany({
      where: eq(messagesTable.chatId, result.chatId),
      orderBy: [asc(messagesTable.id)],
    });
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe(AI_RULES_PROMPT);
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].approvalState).toBe("approved");
    expect(fs.existsSync(path.join(importedDir, "file1.txt"))).toBe(true);
  }, 30_000);

  it("imports an app with AI rules and sends them to the LLM", async () => {
    const fixture = path.join(FIXTURES, "minimal-with-ai-rules");
    await expect(invoke("check-ai-rules", { path: fixture })).resolves.toEqual({
      exists: true,
    });

    const result = await invoke("import-app", {
      path: fixture,
      appName: "ai-rules-imported-app",
    });

    const importedDir = path.join(appsBaseDir, "ai-rules-imported-app");
    expect(fs.existsSync(path.join(importedDir, "AI_RULES.md"))).toBe(true);

    // The e2e sent "[dump]" and snapshotted the payload: the imported app's
    // AI_RULES.md must be part of the codebase context.
    const { getServerDump } = await harness.streamChat("[dump]", {
      chatId: result.chatId,
    });
    const dump = getServerDump({ type: "all-messages" });
    expect(dump.text).toContain('<dyad-file path="AI_RULES.md">');
    expect(dump.text).toContain("There's already AI rules...");
    expect(dump.text).toMatchSnapshot("import-app-with-ai-rules-all-messages");
  }, 30_000);

  it("persists custom install/start commands on the imported app", async () => {
    // (The "both commands required" toggle logic is renderer-side validation
    // and stays UI-only; the backend contract is that whatever commands the
    // dialog submits are stored on the app row.)
    const result = await invoke("import-app", {
      path: path.join(FIXTURES, "minimal"),
      appName: "custom-commands-app",
      installCommand: "npm i",
      startCommand: "npm start",
    });

    const appRow = await db.query.apps.findFirst({
      where: eq(apps.id, result.appId),
    });
    expect(appRow?.installCommand).toBe("npm i");
    expect(appRow?.startCommand).toBe("npm start");
  }, 30_000);

  it("rejects importing over an existing app name", async () => {
    await expect(
      invoke("import-app", {
        path: path.join(FIXTURES, "minimal"),
        appName: "minimal-imported-app",
      }),
    ).rejects.toThrow("An app with this name already exists");
  }, 30_000);
});

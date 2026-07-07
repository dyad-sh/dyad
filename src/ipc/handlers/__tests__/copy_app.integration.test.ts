// @vitest-environment node
//
// Migrated from e2e-tests/copy_app.spec.ts.
//
// The e2e spec copied an app twice (with and without history) and asserted:
//  - the copied app's files matched the original (snapshotAppFiles),
//  - "Copy app with history" landed on Version 2 (original git history kept),
//  - "Copy app without history" landed on Version 1 (fresh git history).
// Here we run the real chat flow to give the app content + a second commit,
// then invoke the real `copy-app` handler and assert files, git history, and
// db rows directly. Dialog/navigation assertions are UI-only and dropped.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
import {
  createFakeIpcEvent,
  type RendererEvent,
} from "@/testing/electron_mock";
import { registerAppHandlers } from "@/ipc/handlers/app_handlers";
import { writeSettings } from "@/main/settings";
import { invalidateDyadAppsBaseDirectoryCache } from "@/paths/paths";
import { apps } from "@/db/schema";
import { eq } from "drizzle-orm";

type Envelope = { ok: boolean; value?: unknown; error?: unknown };

function gitLogOneline(dir: string): string[] {
  return execFileSync("git", ["log", "--oneline"], { cwd: dir, stdio: "pipe" })
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean);
}

/**
 * Sorted relative file list, excluding .git and .gitattributes (the git
 * service's repo init writes a .gitattributes; the e2e snapshot helper
 * filters it out the same way).
 */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), {
      withFileTypes: true,
    })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === ".git" || entry.name === "node_modules") continue;
        walk(relPath);
      } else if (relPath !== ".gitattributes") {
        out.push(relPath);
      }
    }
  };
  walk("");
  return out.sort();
}

describe("copy app (integration)", () => {
  let harness: ChatFlowHarness;
  let appsBaseDir: string;
  const rendererEvents: RendererEvent[] = [];

  const invoke = async (
    channel: string,
    input?: unknown,
  ): Promise<Envelope> => {
    const handler = h.ipcHandlers.get(channel);
    if (!handler) throw new Error(`No ipc handler registered for ${channel}`);
    return (await handler(
      createFakeIpcEvent(rendererEvents),
      input,
    )) as Envelope;
  };

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      autoApprove: true,
    });
    registerAppHandlers();

    // Copies are created at <apps base dir>/<newAppName>; keep that inside the
    // harness temp root instead of the real dyad-apps folder.
    appsBaseDir = path.dirname(harness.appDir);
    writeSettings({ customAppsFolder: appsBaseDir });
    invalidateDyadAppsBaseDirectoryCache();

    // Same as the e2e setup: one approved chat turn -> file1.txt + a second
    // commit, so the original app sits at "Version 2".
    const { result } = await harness.streamChat("hi");
    expect(result).toBe(harness.chatId);
    expect(harness.appFileExists("file1.txt")).toBe(true);
    expect(harness.gitLog().length).toBe(2);
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("copies the app with history (stays at Version 2)", async () => {
    const result = await invoke("copy-app", {
      appId: harness.appId,
      newAppName: "copied-app-with-history",
      withHistory: true,
    });
    expect(result.ok).toBe(true);

    const copyDir = path.join(appsBaseDir, "copied-app-with-history");
    expect(fs.existsSync(copyDir)).toBe(true);

    // Same files as the original (the e2e snapshotAppFiles equivalence).
    expect(listFiles(copyDir)).toEqual(listFiles(harness.appDir));
    expect(fs.readFileSync(path.join(copyDir, "file1.txt"), "utf-8")).toBe(
      harness.readAppFile("file1.txt"),
    );

    // Full git history was carried over -> "Version 2" (2 commits, identical
    // to the original's log).
    expect(gitLogOneline(copyDir)).toEqual(harness.gitLog());

    // New db row, decoupled from the original.
    const copiedApp = await harness.db.query.apps.findFirst({
      where: eq(apps.name, "copied-app-with-history"),
    });
    expect(copiedApp).toBeTruthy();
    expect(copiedApp!.id).not.toBe(harness.appId);
    expect(copiedApp!.path).toBe("copied-app-with-history");
    expect(copiedApp!.supabaseProjectId).toBeNull();
    expect(copiedApp!.githubRepo).toBeNull();
  }, 30_000);

  it("copies the app without history (fresh Version 1)", async () => {
    const result = await invoke("copy-app", {
      appId: harness.appId,
      newAppName: "copied-app-without-history",
      withHistory: false,
    });
    expect(result.ok).toBe(true);

    const copyDir = path.join(appsBaseDir, "copied-app-without-history");
    expect(fs.existsSync(copyDir)).toBe(true);

    // Same files as the original, including the chat-written file1.txt.
    expect(listFiles(copyDir)).toEqual(listFiles(harness.appDir));
    expect(fs.readFileSync(path.join(copyDir, "file1.txt"), "utf-8")).toBe(
      harness.readAppFile("file1.txt"),
    );

    // History was NOT copied: a fresh repo with a single initial commit
    // ("Version 1"), unrelated to the original's log.
    const log = gitLogOneline(copyDir);
    expect(log.length).toBe(1);
    expect(log).not.toEqual(harness.gitLog());

    const copiedApp = await harness.db.query.apps.findFirst({
      where: eq(apps.name, "copied-app-without-history"),
    });
    expect(copiedApp).toBeTruthy();
    expect(copiedApp!.path).toBe("copied-app-without-history");
  }, 30_000);

  it("rejects copying to an existing app name", async () => {
    const result = await invoke("copy-app", {
      appId: harness.appId,
      newAppName: "copied-app-with-history",
      withHistory: true,
    });
    expect(result.ok).toBe(false);
  });
});

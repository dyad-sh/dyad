// @vitest-environment node
//
// Migrated from e2e-tests/github-import.spec.ts.
//
// The e2e drove the ImportAppDialog's GitHub tabs. The tab/modal interactions
// are renderer-only and are dropped; the backend behaviors are ported:
//  - the GitHub device flow (github:start-flow) against the fake GitHub
//    server: FAKE-CODE user code, polling, and the access token stored in
//    settings; repo listing (github:list-repos) once authenticated;
//  - github:clone-repo-from-url clones a repo (served by the fake git server)
//    into the apps directory and creates the app row — with default (null)
//    commands or custom install/start commands;
//  - the component-tagger auto-upgrade is applied on import of a Vite app by
//    default, and skipped when optimizeForDyad is false.
//
// Environment notes: github_handlers bakes its GitHub base URLs at module
// load from E2E_TEST_BUILD + FAKE_LLM_PORT, so both are set in vi.hoisted and
// a second fake-LLM server instance is bound to that fixed port for the
// GitHub API/git routes (the harness's own ephemeral-port instance still
// serves the LLM + catalog traffic).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  // github_handlers.ts computes its GitHub endpoints at module load:
  // IS_TEST_BUILD (E2E_TEST_BUILD) routes them to the fake server at
  // http://localhost:<FAKE_LLM_PORT>. Pick a per-process port so parallel
  // test files never collide.
  process.env.E2E_TEST_BUILD = "true";
  const githubPort = 21000 + (process.pid % 20000);
  process.env.FAKE_LLM_PORT = String(githubPort);
  return { ipcHandlers: new Map(), githubPort };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import * as electron from "electron";
import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";
import { registerGithubHandlers } from "@/ipc/handlers/github_handlers";
import { invalidateDyadAppsBaseDirectoryCache } from "@/paths/paths";
import { isIpcInvokeEnvelope, unwrapIpcEnvelope } from "@/ipc/contracts/core";
import { readSettings } from "@/main/settings";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  startFakeLlmServer,
  type FakeLlmServerHandle,
} from "../../../../testing/fake-llm-server/index";

interface SentEvent {
  channel: string;
  payload: any;
}

function makeEvent(sink: SentEvent[] = []) {
  return {
    sender: {
      isDestroyed: () => false,
      isCrashed: () => false,
      send: (channel: string, payload: unknown) =>
        sink.push({ channel, payload }),
    },
  };
}

async function invoke(
  channel: string,
  params?: unknown,
  sink?: SentEvent[],
): Promise<any> {
  const handler = h.ipcHandlers.get(channel);
  if (!handler) {
    throw new Error(`No handler registered for ${channel}`);
  }
  const response = await handler(makeEvent(sink), params);
  return isIpcInvokeEnvelope(response) ? unwrapIpcEnvelope(response) : response;
}

async function waitFor(
  predicate: () => boolean,
  { timeoutMs = 20_000, intervalMs = 100 } = {},
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

describe("github import (integration)", () => {
  let harness: ChatFlowHarness;
  let githubServer: FakeLlmServerHandle;
  let appsBaseDir: string;

  beforeAll(async () => {
    appsBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-gh-apps-"));
    harness = await setupChatFlowHarness({
      electronMock: h,
      settings: { customAppsFolder: appsBaseDir },
    });
    invalidateDyadAppsBaseDirectoryCache();
    registerGithubHandlers();
    // Fixed-port instance serving the GitHub API + git-over-HTTP routes that
    // github_handlers baked in at module load.
    githubServer = await startFakeLlmServer({
      port: h.githubPort,
      host: "0.0.0.0",
    });
    // The device-flow handler bails out unless the invoking webContents maps
    // to a BrowserWindow; give the mock a live-looking window.
    (electron.BrowserWindow.fromWebContents as any).mockReturnValue({
      isDestroyed: () => false,
      webContents: { send: () => {} },
    });
  }, 30_000);

  afterAll(async () => {
    await githubServer?.close().catch(() => {});
    await harness?.dispose();
    fs.rmSync(appsBaseDir, { recursive: true, force: true });
  });

  // NOTE: runs before the device flow stores a token (like the e2e, where the
  // URL import happened right after the flow started): with no token there is
  // no repo-availability precheck and the clone goes straight through.
  it("imports a repo from a GitHub URL with default commands", async () => {
    const result = await invoke("github:clone-repo-from-url", {
      url: "https://github.com/dyad-sh/nextjs-template.git",
    });

    expect(result.error).toBeUndefined();
    expect(result.app.name).toBe("nextjs-template");
    expect(result.hasAiRules).toBe(false);

    const appRow = await db.query.apps.findFirst({
      where: eq(apps.id, result.app.id),
    });
    expect(appRow?.path).toBe("nextjs-template");
    expect(appRow?.githubOrg).toBe("dyad-sh");
    expect(appRow?.githubRepo).toBe("nextjs-template");
    // Empty commands mean defaults (null), per the "allow empty commands" e2e.
    expect(appRow?.installCommand).toBeNull();
    expect(appRow?.startCommand).toBeNull();

    // The clone landed in the apps directory as a git repo.
    const appDir = path.join(appsBaseDir, "nextjs-template");
    expect(fs.existsSync(path.join(appDir, ".git"))).toBe(true);
  }, 30_000);

  it("connects via the GitHub device flow and lists repos", async () => {
    const events: SentEvent[] = [];
    await invoke("github:start-flow", { appId: null }, events);

    // The fake server hands out FAKE-CODE and authorizes after 3 polls
    // (1s interval).
    await waitFor(() =>
      events.some((e) => e.channel === "github:flow-success"),
    );

    const codeUpdate = events.find(
      (e) => e.channel === "github:flow-update" && e.payload?.userCode,
    );
    expect(codeUpdate?.payload.userCode).toBe("FAKE-CODE");

    // Token was stored in settings (this is what flips the dialog into the
    // authenticated repo-list state).
    expect(readSettings().githubAccessToken?.value).toBe(
      "fake_access_token_12345",
    );

    // The repositories list is now available (shown as testuser/... rows).
    const repos = await invoke("github:list-repos");
    const fullNames = repos.map((r: any) => r.full_name);
    expect(fullNames).toContain("testuser/existing-app");
    expect(fullNames).toContain("testuser/existing-vite-app");
  }, 30_000);

  it("imports a repo from the repository list with custom commands", async () => {
    // The dialog's repo-list import funnels into the same clone handler with
    // the repo's URL; custom advanced-options commands are persisted.
    const result = await invoke("github:clone-repo-from-url", {
      url: "https://github.com/testuser/existing-app.git",
      installCommand: "npm install",
      startCommand: "npm start",
    });

    expect(result.error).toBeUndefined();
    expect(result.app.name).toBe("existing-app");

    const appRow = await db.query.apps.findFirst({
      where: eq(apps.id, result.app.id),
    });
    expect(appRow?.installCommand).toBe("npm install");
    expect(appRow?.startCommand).toBe("npm start");
  }, 30_000);

  it("auto-applies the component tagger upgrade on import of a Vite app", async () => {
    const result = await invoke("github:clone-repo-from-url", {
      url: "https://github.com/testuser/existing-vite-app.git",
    });
    expect(result.error).toBeUndefined();
    expect(result.autoUpgradeWarning).toBeFalsy();

    const appDir = path.join(appsBaseDir, "existing-vite-app");
    const pkg = fs.readFileSync(path.join(appDir, "package.json"), "utf8");
    expect(pkg).toContain("@dyad-sh/react-vite-component-tagger");

    const viteConfig = fs.readFileSync(
      path.join(appDir, "vite.config.ts"),
      "utf8",
    );
    expect(viteConfig).toContain(
      "import dyadComponentTagger from '@dyad-sh/react-vite-component-tagger';",
    );
    expect(viteConfig).toContain("dyadComponentTagger()");
  }, 30_000);

  it("skips the component tagger upgrade when optimize for Dyad is off", async () => {
    const result = await invoke("github:clone-repo-from-url", {
      url: "https://github.com/testuser/existing-vite-app.git",
      appName: "existing-vite-app-2",
      optimizeForDyad: false,
    });
    expect(result.error).toBeUndefined();

    const appDir = path.join(appsBaseDir, "existing-vite-app-2");
    const viteConfig = fs.readFileSync(
      path.join(appDir, "vite.config.ts"),
      "utf8",
    );
    expect(viteConfig).not.toContain("dyadComponentTagger");

    const pkg = fs.readFileSync(path.join(appDir, "package.json"), "utf8");
    expect(pkg).not.toContain("@dyad-sh/react-vite-component-tagger");
  }, 30_000);
});

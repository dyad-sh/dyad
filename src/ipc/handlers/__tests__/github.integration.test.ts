// @vitest-environment node
//
// Migrated from e2e-tests/github.spec.ts.
//
// The e2e drove the GitHub connector panel UI. Panel/aria interactions are
// dropped; the backend behaviors are ported:
//  - the device flow (github:start-flow): FAKE-CODE user code, the
//    verification URI, polling, and the access token stored in settings;
//  - create repo + sync (github:create-repo / github:push): app db row is
//    linked, the fake git server records a "create" push for the right
//    repo/branch (default main and custom branches);
//  - repo names with spaces are normalized to hyphens;
//  - connecting to an existing repo (github:connect-existing-repo), incl.
//    a custom branch that is created locally and pushed;
//  - disconnecting a repo clears the app's github columns;
//  - removing GitHub credentials from settings keeps the app row linked
//    (the backend state behind the "reconnect" prompt);
//  - "clear integration settings": a commit made while connected stores
//    githubUser.email from the fake GitHub API, and disconnecting removes
//    exactly githubAccessToken + githubUser from settings.
//
// Environment notes: github_handlers bakes its GitHub base URLs at module
// load from E2E_TEST_BUILD + FAKE_LLM_PORT, so both are set in vi.hoisted and
// a second fake-LLM server instance is bound to that fixed port for the
// GitHub API/git routes (the harness's own ephemeral-port instance still
// serves the LLM + catalog traffic).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";

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
import { registerGithubBranchHandlers } from "@/ipc/handlers/git_branch_handlers";
import { isIpcInvokeEnvelope, unwrapIpcEnvelope } from "@/ipc/contracts/core";
import { readSettings, writeSettings } from "@/main/settings";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  startFakeLlmServer,
  type FakeLlmServerHandle,
} from "../../../../testing/fake-llm-server/index";

const FAKE_TOKEN = "fake_access_token_12345";

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

interface PushEvent {
  repo: string;
  branch: string;
  operation: "push" | "create" | "delete";
}

async function getPushEvents(repo: string): Promise<PushEvent[]> {
  const res = await fetch(
    `http://localhost:${h.githubPort}/github/api/test/push-events?repo=${encodeURIComponent(repo)}`,
  );
  return (await res.json()) as PushEvent[];
}

async function clearPushEvents(): Promise<void> {
  await fetch(
    `http://localhost:${h.githubPort}/github/api/test/clear-push-events`,
    { method: "POST" },
  );
}

describe("github connect + sync (integration)", () => {
  let harness: ChatFlowHarness;
  let githubServer: FakeLlmServerHandle;

  const getAppRow = async () =>
    (await db.query.apps.findFirst({ where: eq(apps.id, harness.appId) }))!;

  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: harness.appDir, stdio: "pipe" })
      .toString()
      .trim();

  beforeAll(async () => {
    harness = await setupChatFlowHarness({ electronMock: h });
    registerGithubHandlers();
    registerGithubBranchHandlers();
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
  }, 60_000);

  afterAll(async () => {
    await githubServer?.close().catch(() => {});
    await harness?.dispose();
  });

  it("connects to GitHub using the device flow", async () => {
    const events: SentEvent[] = [];
    await invoke("github:start-flow", { appId: harness.appId }, events);

    // The fake server hands out FAKE-CODE and authorizes after 3 polls
    // (1s interval).
    await waitFor(() =>
      events.some((e) => e.channel === "github:flow-success"),
    );

    const codeUpdate = events.find(
      (e) => e.channel === "github:flow-update" && e.payload?.userCode,
    );
    expect(codeUpdate?.payload.userCode).toBe("FAKE-CODE");
    expect(codeUpdate?.payload.verificationUri).toBe(
      "https://github.com/login/device",
    );

    // Token stored in settings — this is what flips the panel into the
    // "Set up your GitHub repo" state.
    expect(readSettings().githubAccessToken?.value).toBe(FAKE_TOKEN);
  }, 30_000);

  it("create and sync to new repo", async () => {
    // Availability check behind "Repository name is available!".
    const availability = await invoke("github:is-repo-available", {
      org: "",
      repo: "test-new-repo",
    });
    expect(availability).toEqual({ available: true });

    await invoke("github:create-repo", {
      org: "",
      repo: "test-new-repo",
      appId: harness.appId,
    });

    // App row is linked to the new repo on the default branch.
    const appRow = await getAppRow();
    expect(appRow.githubOrg).toBe("testuser");
    expect(appRow.githubRepo).toBe("test-new-repo");
    expect(appRow.githubBranch).toBe("main");
    expect(git("remote", "get-url", "origin")).toContain(
      "/github/git/testuser/test-new-repo.git",
    );

    // Once created, the name is taken.
    const taken = await invoke("github:is-repo-available", {
      org: "",
      repo: "test-new-repo",
    });
    expect(taken.available).toBe(false);

    // Sync to GitHub → the fake git server records a branch-create push.
    await invoke("github:push", { appId: harness.appId });
    const events = await getPushEvents("test-new-repo");
    expect(
      events.some((e) => e.branch === "main" && e.operation === "create"),
    ).toBe(true);
  }, 60_000);

  it("create and sync to new repo - custom branch", async () => {
    await invoke("github:create-repo", {
      org: "",
      repo: "test-new-repo-custom",
      appId: harness.appId,
      branch: "new-branch",
    });

    const appRow = await getAppRow();
    expect(appRow.githubRepo).toBe("test-new-repo-custom");
    expect(appRow.githubBranch).toBe("new-branch");
    // The local branch was created and checked out.
    expect(git("branch", "--show-current")).toBe("new-branch");

    await invoke("github:push", { appId: harness.appId });
    const events = await getPushEvents("test-new-repo-custom");
    expect(
      events.some((e) => e.branch === "new-branch" && e.operation === "create"),
    ).toBe(true);

    // Restore main for the following tests (the e2e used a fresh app each
    // test; this file shares one).
    await invoke("github:switch-branch", {
      appId: harness.appId,
      branch: "main",
    });
    expect(git("branch", "--show-current")).toBe("main");
  }, 60_000);

  it("create repo with spaces in name - normalizes to hyphens", async () => {
    // Availability check runs against the normalized name.
    const availability = await invoke("github:is-repo-available", {
      org: "",
      repo: "my new repo",
    });
    expect(availability).toEqual({ available: true });

    await invoke("github:create-repo", {
      org: "",
      repo: "my new repo",
      appId: harness.appId,
    });

    // Connected repo shows the normalized name (testuser/my-new-repo).
    const appRow = await getAppRow();
    expect(appRow.githubOrg).toBe("testuser");
    expect(appRow.githubRepo).toBe("my-new-repo");

    await invoke("github:push", { appId: harness.appId });
    const events = await getPushEvents("my-new-repo");
    expect(
      events.some((e) => e.branch === "main" && e.operation === "create"),
    ).toBe(true);
  }, 60_000);

  it("create and sync to existing repo", async () => {
    await invoke("github:connect-existing-repo", {
      owner: "testuser",
      repo: "existing-app",
      branch: "main",
      appId: harness.appId,
    });

    const appRow = await getAppRow();
    expect(appRow.githubOrg).toBe("testuser");
    expect(appRow.githubRepo).toBe("existing-app");
    expect(appRow.githubBranch).toBe("main");
  }, 60_000);

  it("create and sync to existing repo - custom branch", async () => {
    // Clear any previous push events (mirrors the e2e).
    await clearPushEvents();

    await invoke("github:connect-existing-repo", {
      owner: "testuser",
      repo: "existing-app",
      branch: "custom-branch",
      appId: harness.appId,
    });

    const appRow = await getAppRow();
    expect(appRow.githubRepo).toBe("existing-app");
    expect(appRow.githubBranch).toBe("custom-branch");
    expect(git("branch", "--show-current")).toBe("custom-branch");

    await invoke("github:push", { appId: harness.appId });
    const events = await getPushEvents("existing-app");
    expect(
      events.some(
        (e) => e.branch === "custom-branch" && e.operation === "create",
      ),
    ).toBe(true);

    await invoke("github:switch-branch", {
      appId: harness.appId,
      branch: "main",
    });
  }, 60_000);

  it("disconnect from repo", async () => {
    await invoke("github:create-repo", {
      org: "",
      repo: "test-new-repo-disconnect",
      appId: harness.appId,
    });
    expect((await getAppRow()).githubRepo).toBe("test-new-repo-disconnect");

    await invoke("github:disconnect", { appId: harness.appId });

    const appRow = await getAppRow();
    expect(appRow.githubRepo).toBeNull();
    expect(appRow.githubOrg).toBeNull();
    expect(appRow.githubBranch).toBeNull();
  }, 60_000);

  it("github clear integration settings", async () => {
    // Make sure we are committing so that githubUser.email gets set: the
    // commit author lookup fetches the primary email from the GitHub API and
    // caches it in settings.
    const { messages } = await harness.streamChat("tc=write-index");
    const assistant = messages.filter((m) => m.role === "assistant").at(-1)!;
    expect(assistant.commitHash).toBeTruthy();

    const before = readSettings();
    expect(before.githubAccessToken?.value).toBe(FAKE_TOKEN);
    expect(before.githubAccessToken?.encryptionType).toBe("plaintext");
    expect(before.githubUser?.email).toBe("testuser@example.com");

    // "Disconnect from GitHub" in settings clears exactly the token + user
    // (same payload GithubIntegration.tsx sends through settings:set).
    writeSettings({ githubAccessToken: undefined, githubUser: undefined });

    const after = readSettings();
    expect(after.githubAccessToken).toBeUndefined();
    expect(after.githubUser).toBeUndefined();
  }, 60_000);

  it("keeps the app linked to the repo when GitHub credentials are missing", async () => {
    // Reconnect and link a repo…
    writeSettings({ githubAccessToken: { value: FAKE_TOKEN } });
    await invoke("github:create-repo", {
      org: "",
      repo: "test-new-repo-reconnect",
      appId: harness.appId,
    });

    // …then remove the credentials from settings.
    writeSettings({ githubAccessToken: undefined, githubUser: undefined });
    expect(readSettings().githubAccessToken).toBeUndefined();

    // The app row still records the linked repo — this is the state behind
    // the "Reconnect your GitHub account … linked to
    // testuser/test-new-repo-reconnect" prompt.
    const appRow = await getAppRow();
    expect(appRow.githubOrg).toBe("testuser");
    expect(appRow.githubRepo).toBe("test-new-repo-reconnect");

    // Without credentials, syncing is rejected (the Sync button is hidden in
    // the UI; the handler refuses outright).
    await expect(
      invoke("github:push", { appId: harness.appId }),
    ).rejects.toThrow("Not authenticated with GitHub.");
  }, 60_000);
});

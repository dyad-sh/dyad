import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { eq } from "drizzle-orm";

import { apps, chats } from "@/db/schema";
import { writeSettings } from "@/main/settings";
import {
  getDyadAppPath,
  invalidateDyadAppsBaseDirectoryCache,
} from "@/paths/paths";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

type TestApp = {
  appId: number;
  chatId: number;
  name: string;
  dbPath: string;
  appDir: string;
};

const fixtureAppDir = path.join(
  process.cwd(),
  "e2e-tests",
  "fixtures",
  "import-app",
  "minimal",
);

function git(appDir: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test User", ...args],
    { cwd: appDir, stdio: "pipe" },
  ).toString();
}

function gitCommitCount(appDir: string): number {
  return Number(git(appDir, "rev-list", "--count", "HEAD").trim());
}

function addGitCommit(appDir: string, fileName: string, content: string) {
  fs.writeFileSync(path.join(appDir, fileName), content);
  git(appDir, "add", "-A");
  git(appDir, "commit", "-m", `add ${fileName}`);
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

describe("app details actions (integration)", () => {
  let harness: HybridChatHarness;
  let appCounter = 0;
  let appsRoot: string;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      settings: { isTestMode: true },
    });
    appsRoot = path.dirname(harness.appDir);
    writeSettings({ customAppsFolder: appsRoot });
    invalidateDyadAppsBaseDirectoryCache();
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  async function createFixtureApp(baseName: string): Promise<TestApp> {
    appCounter += 1;
    const name = `${baseName}-${appCounter}`;
    const dbPath = slug(name);
    const appDir = path.join(appsRoot, dbPath);
    fs.cpSync(fixtureAppDir, appDir, { recursive: true });
    git(appDir, "init");
    git(appDir, "add", "-A");
    git(appDir, "commit", "-m", "init");

    const [appRow] = await harness.db
      .insert(apps)
      .values({ name, path: dbPath })
      .returning();
    const [chatRow] = await harness.db
      .insert(chats)
      .values({ appId: appRow.id })
      .returning();

    return { appId: appRow.id, chatId: chatRow.id, name, dbPath, appDir };
  }

  async function mountAppDetails(app: TestApp) {
    harness.mountSurface({
      route: "/app-details",
      appId: app.appId,
      withTitleBar: true,
    });
    await screen.findByTestId("app-details-page");
    await screen.findByRole("heading", { name: app.name });
  }

  async function openMoreOptions() {
    await harness.openPopover(
      await screen.findByTestId("app-details-more-options-button"),
    );
  }

  async function getAppByName(name: string) {
    return harness.db.query.apps.findFirst({
      where: eq(apps.name, name),
    });
  }

  it("copies an app with history and opens the copied app chat", async () => {
    const source = await createFixtureApp("copy-with-history-source");
    addGitCommit(source.appDir, "history.txt", "copied with history");
    expect(gitCommitCount(source.appDir)).toBe(2);

    await mountAppDetails(source);
    await openMoreOptions();
    await harness.clickMenuItem("Copy app");

    const copiedName = "copied-app-with-history";
    const dialog = await harness.findDialog(
      new RegExp(`Copy "${source.name}"`),
    );
    fireEvent.change(screen.getByLabelText("New app name"), {
      target: { value: copiedName },
    });

    const copyButton = await screen.findByRole("button", {
      name: /Copy app with history/i,
    });
    await waitFor(() => {
      expect((copyButton as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(copyButton);

    await waitFor(() => expect(dialog.isConnected).toBe(false), {
      timeout: 20_000,
    });
    const copied = await waitFor(async () => {
      const row = await getAppByName(copiedName);
      expect(row).toBeTruthy();
      return row!;
    });
    await screen.findByRole("heading", { name: copiedName });

    const copiedPath = getDyadAppPath(copied.path);
    expect(copied.path).toBe(copiedName);
    expect(gitCommitCount(copiedPath)).toBe(2);
    expect(fs.existsSync(path.join(copiedPath, "history.txt"))).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Open in Chat" }));
    await waitFor(() => {
      const location = harness.currentLocation();
      expect(location.pathname).toBe("/chat");
      expect(Number(location.search.appId)).toBe(copied.id);
      expect(Number(location.search.id)).toBeGreaterThan(0);
    });
    await screen.findByText("Version 2");
  }, 60_000);

  it("copies an app without history into a fresh one-commit repo", async () => {
    const source = await createFixtureApp("copy-without-history-source");
    addGitCommit(source.appDir, "fresh.txt", "copied without history");
    expect(gitCommitCount(source.appDir)).toBe(2);

    await mountAppDetails(source);
    await openMoreOptions();
    await harness.clickMenuItem("Copy app");

    const copiedName = "copied-app-without-history";
    fireEvent.change(await screen.findByLabelText("New app name"), {
      target: { value: copiedName },
    });

    const copyButton = await screen.findByRole("button", {
      name: /Copy app without history/i,
    });
    await waitFor(() => {
      expect((copyButton as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(copyButton);

    const copied = await waitFor(async () => {
      const row = await getAppByName(copiedName);
      expect(row).toBeTruthy();
      return row!;
    });
    await screen.findByRole("heading", { name: copiedName });

    const copiedPath = getDyadAppPath(copied.path);
    expect(copied.path).toBe(copiedName);
    expect(gitCommitCount(copiedPath)).toBe(1);
    expect(fs.existsSync(path.join(copiedPath, "fresh.txt"))).toBe(true);
  }, 60_000);

  it("deletes an app from app details", async () => {
    const app = await createFixtureApp("delete-app");

    await mountAppDetails(app);
    await openMoreOptions();
    await harness.clickMenuItem("Delete");
    await harness.confirmDialog(
      new RegExp(`Delete "${app.name}"`),
      "Delete App",
    );

    await waitFor(async () => {
      const row = await harness.db.query.apps.findFirst({
        where: eq(apps.id, app.appId),
      });
      expect(row).toBeUndefined();
    });
    expect(fs.existsSync(app.appDir)).toBe(false);
    await waitFor(() => {
      expect(harness.currentLocation().pathname).toBe("/");
    });
  }, 60_000);

  it("renames an app and its folder", async () => {
    const app = await createFixtureApp("rename-folder-source");
    const newName = "renamed-app-and-folder";
    const newPath = path.join(path.dirname(app.appDir), newName);

    await mountAppDetails(app);
    fireEvent.click(screen.getByTestId("app-details-rename-app-button"));
    fireEvent.change(await screen.findByPlaceholderText("Enter new app name"), {
      target: { value: newName },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Rename app and folder/i,
      }),
    );

    await waitFor(async () => {
      const row = await harness.db.query.apps.findFirst({
        where: eq(apps.id, app.appId),
      });
      expect(row?.name).toBe(newName);
      expect(row?.path).toBe(newName);
      expect(getDyadAppPath(row!.path)).toBe(newPath);
    });
    expect(fs.existsSync(app.appDir)).toBe(false);
    expect(fs.existsSync(newPath)).toBe(true);
    await screen.findByText(newPath);
    await waitFor(() => {
      expect(
        screen
          .getByTestId("title-bar-app-name-button")
          .getAttribute("data-app-name"),
      ).toBe(newName);
    });
  }, 60_000);

  it("renames an app without renaming its folder", async () => {
    const app = await createFixtureApp("rename-app-only-source");
    const newName = "renamed-app-only";

    await mountAppDetails(app);
    fireEvent.click(screen.getByTestId("app-details-rename-app-button"));
    fireEvent.change(await screen.findByPlaceholderText("Enter new app name"), {
      target: { value: newName },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Rename app only/i,
      }),
    );

    await waitFor(async () => {
      const row = await harness.db.query.apps.findFirst({
        where: eq(apps.id, app.appId),
      });
      expect(row?.name).toBe(newName);
      expect(row?.path).toBe(app.dbPath);
      expect(getDyadAppPath(row!.path)).toBe(app.appDir);
    });
    expect(fs.existsSync(app.appDir)).toBe(true);
    await screen.findByText(app.appDir);
  }, 60_000);

  it("creates a new chat from the chat header button", async () => {
    const app = await createFixtureApp("new-chat-app");

    harness.mount({ appId: app.appId, chatId: app.chatId });
    fireEvent.click(await screen.findByTestId("new-chat-button"));
    await waitFor(() => {
      const location = harness.currentLocation();
      expect(location.pathname).toBe("/chat");
      expect(Number(location.search.appId)).toBe(app.appId);
      const headerChatId = Number(location.search.id);
      expect(headerChatId).toBeGreaterThan(0);
      expect(headerChatId).not.toBe(app.chatId);
    });

    const appChats = await harness.db.query.chats.findMany({
      where: eq(chats.appId, app.appId),
    });
    expect(appChats).toHaveLength(2);
  }, 60_000);

  it("creates a new chat from the chat list button", async () => {
    const app = await createFixtureApp("new-chat-list-app");

    harness.mount({ appId: app.appId, chatId: app.chatId, withChatList: true });
    const newChatButtons = await screen.findAllByTestId("new-chat-button");
    fireEvent.click(newChatButtons[0]);
    await waitFor(() => {
      const location = harness.currentLocation();
      expect(Number(location.search.appId)).toBe(app.appId);
      const sidebarChatId = Number(location.search.id);
      expect(sidebarChatId).toBeGreaterThan(0);
      expect(sidebarChatId).not.toBe(app.chatId);
    });

    const appChats = await harness.db.query.chats.findMany({
      where: eq(chats.appId, app.appId),
    });
    expect(appChats).toHaveLength(2);
  }, 60_000);

  it("switches apps through the app list", async () => {
    const first = await createFixtureApp("switch-first");
    const second = await createFixtureApp("switch-second");

    harness.mountSurface({
      route: "/",
      appId: first.appId,
      withTitleBar: true,
      withAppList: true,
    });
    await screen.findByTestId("app-list-container");
    expect(
      screen
        .getByTestId("title-bar-app-name-button")
        .getAttribute("data-app-name"),
    ).toBe(first.name);

    fireEvent.click(await screen.findByTestId(`app-list-item-${second.name}`));

    await waitFor(() => {
      const location = harness.currentLocation();
      expect(location.pathname).toBe("/app-details");
      expect(Number(location.search.appId)).toBe(second.appId);
      expect(
        screen
          .getByTestId("title-bar-app-name-button")
          .getAttribute("data-app-name"),
      ).toBe(second.name);
    });
    await screen.findByRole("heading", { name: second.name });
  }, 60_000);
});

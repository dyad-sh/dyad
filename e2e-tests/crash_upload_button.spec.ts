import { expect } from "@playwright/test";
import { Timeout, testWithConfig } from "./helpers/test_helper";
import * as fs from "node:fs";
import * as path from "node:path";

// The force-close dialog offers a one-click "Upload Chat Session" button for the
// chat that was streaming at crash time. That chat id is captured in the crash
// sentinel (session.lock) at stream start. These tests mock the sentinel (the
// same approach as the force-close performance test) to verify the button is
// shown when an activeChatId is present and hidden when it isn't.

const SETTINGS = {
  hasRunBefore: true,
  enableAutoUpdate: false,
  releaseChannel: "stable",
};

function writeCrashScenario(userDataDir: string, sentinel: string) {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, "user-settings.json"),
    JSON.stringify(SETTINGS, null, 2),
  );
  fs.writeFileSync(path.join(userDataDir, "session.lock"), sentinel);
}

testWithConfig({
  preLaunchHook: async ({ userDataDir }) => {
    // Sentinel carries the chat that was streaming at crash time.
    writeCrashScenario(
      userDataDir,
      JSON.stringify({ ts: Date.now(), activeChatId: 1 }),
    );
  },
})(
  "force-close dialog shows Upload Chat Session button when a chat was active",
  async ({ po }) => {
    await expect(po.chatActions.getHomeChatInputContainer()).toBeVisible({
      timeout: Timeout.LONG,
    });
    await expect(
      po.page.getByRole("heading", { name: "Force Close Detected" }),
    ).toBeVisible({ timeout: Timeout.MEDIUM });

    await expect(
      po.page.getByRole("button", { name: "Upload Chat Session" }),
    ).toBeVisible();
  },
);

testWithConfig({
  preLaunchHook: async ({ userDataDir }) => {
    // Sentinel with no activeChatId (no stream ran this session).
    writeCrashScenario(userDataDir, JSON.stringify({ ts: Date.now() }));
  },
})(
  "force-close dialog hides Upload Chat Session button when no chat was active",
  async ({ po }) => {
    await expect(po.chatActions.getHomeChatInputContainer()).toBeVisible({
      timeout: Timeout.LONG,
    });
    await expect(
      po.page.getByRole("heading", { name: "Force Close Detected" }),
    ).toBeVisible({ timeout: Timeout.MEDIUM });

    await expect(
      po.page.getByRole("button", { name: "Upload Chat Session" }),
    ).not.toBeVisible();
  },
);

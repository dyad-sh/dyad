import { execFileSync } from "node:child_process";

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { apps } from "@/db/schema";
import { queryKeys } from "@/lib/queryKeys";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

describe("chat header branch banner", () => {
  let harness: HybridChatHarness;

  function git(...args: string[]): string {
    return execFileSync("git", args, {
      cwd: harness.appDir,
      encoding: "utf8",
    }).trim();
  }

  async function mountOnBranch(expectedBranch: string) {
    const chatId = await harness.createChat();
    harness.mount({ chatId });
    await waitFor(
      () =>
        expect(
          harness
            .queryClient()
            .getQueryData(queryKeys.branches.current({ appId: harness.appId })),
        ).toEqual({ branch: expectedBranch }),
      { timeout: 20_000 },
    );
  }

  async function waitForLocalBranch(branch: string) {
    await waitFor(
      () =>
        expect(
          harness
            .queryClient()
            .getQueryData(queryKeys.branches.local({ appId: harness.appId })),
        ).toContain(branch),
      { timeout: 20_000 },
    );
  }

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      settings: { isTestMode: true },
    });
    // The only local branch is master, so main does not exist.
    git("branch", "-m", "master");
  }, 60_000);

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  it("does not flag a named branch other than main", async () => {
    git("checkout", "master");

    await mountOnBranch("master");

    expect(screen.queryByTestId("detached-head-banner")).toBeNull();
  }, 60_000);

  it("flags a detached HEAD without offering a branch that does not exist", async () => {
    git("checkout", "--detach", "master");

    await mountOnBranch("<no-branch>");
    await waitForLocalBranch("master");

    expect(screen.getByTestId("detached-head-banner")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Switch to / })).toBeNull();
  }, 60_000);

  it("switches a detached HEAD back to the linked branch", async () => {
    git("checkout", "--detach", "master");
    await harness.db
      .update(apps)
      .set({
        githubOrg: "testuser",
        githubRepo: "linked-repo",
        githubBranch: "master",
      })
      .where(eq(apps.id, harness.appId));

    await mountOnBranch("<no-branch>");
    fireEvent.click(
      await screen.findByRole(
        "button",
        { name: "Switch to master" },
        { timeout: 20_000 },
      ),
    );

    await waitFor(
      () => expect(git("branch", "--show-current")).toBe("master"),
      {
        timeout: 20_000,
      },
    );
  }, 60_000);
});

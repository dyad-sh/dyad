import { execFileSync } from "node:child_process";

import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { queryKeys } from "@/lib/queryKeys";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

describe("chat header branch banner", () => {
  let harness: HybridChatHarness;

  function git(...args: string[]) {
    execFileSync("git", args, { cwd: harness.appDir, stdio: "pipe" });
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

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      settings: { isTestMode: true },
    });
  }, 60_000);

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  it("does not flag a named branch other than main", async () => {
    git("branch", "-m", "master");

    await mountOnBranch("master");

    expect(screen.queryByTestId("detached-head-banner")).toBeNull();
  }, 60_000);

  it("flags a detached HEAD", async () => {
    git("checkout", "--detach");

    await mountOnBranch("<no-branch>");

    expect(screen.getByTestId("detached-head-banner")).toBeTruthy();
  }, 60_000);
});

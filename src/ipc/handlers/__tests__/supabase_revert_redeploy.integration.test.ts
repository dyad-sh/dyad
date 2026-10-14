// Undo redeploys every Supabase function in the restored tree. That upload
// must run after the revert releases its exclusive claims (chat content,
// repository, provider, runtime config); otherwise a large function set
// blocks other chats, checkpoints and test setup for the whole upload.
//
// E2E_TEST_BUILD=true (set before app modules import) makes the Supabase
// management client return fake deploy results after a short delay instead of
// calling the real Supabase API, which leaves an observable upload window.
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.E2E_TEST_BUILD = "true";
});

import { waitFor } from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";
import { apps } from "@/db/schema";
import { eq } from "drizzle-orm";
import { appOperationCoordinator } from "@/ipc/services/app_operation_coordinator";
import { versionPreviewHandlerService } from "@/ipc/handlers/version_handlers";

describe("Supabase redeploy after undo (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      engine: true,
      chatMode: "local-agent",
      settings: {
        isTestMode: true,
        enableDyadPro: true,
        providerSettings: {
          auto: { apiKey: { value: "testdyadkey" } },
        },
      },
    });
    await harness.db
      .update(apps)
      .set({ supabaseProjectId: "fake-project-id" })
      .where(eq(apps.id, harness.appId));
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  const sendTurn = async (prompt: string) => {
    const end = harness.waitForNextStreamEnd(harness.chatId);
    const { send } = await harness.typeInChat(prompt);
    send();
    await end;
    await harness.bridge.settleInFlight();
  };

  it("uploads the restored functions after the revert releases its claims", async () => {
    harness.mount();
    // 20 edge functions, deployed at the end of the turn.
    await sendTurn("tc=local-agent/supabase-deploy-progress");
    const restoredVersion = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: harness.appDir,
      encoding: "utf8",
    }).trim();
    await sendTurn("tc=local-agent/write-index");

    let uploadedOutsideRevertClaims = false;
    const revert = versionPreviewHandlerService.revertVersion({
      appId: harness.appId,
      previousVersionId: restoredVersion,
    });
    await waitFor(
      () => {
        uploadedOutsideRevertClaims =
          appOperationCoordinator.isBusy(harness.appId, [
            "supabase-functions",
          ]) &&
          !appOperationCoordinator.isBusy(harness.appId, ["chat-content"]);
        expect(uploadedOutsideRevertClaims).toBe(true);
      },
      { timeout: 15_000, interval: 10 },
    );

    const result = await revert;
    expect(result.notification).toMatchObject({ kind: "success" });
    expect(uploadedOutsideRevertClaims).toBe(true);
  }, 60_000);
});

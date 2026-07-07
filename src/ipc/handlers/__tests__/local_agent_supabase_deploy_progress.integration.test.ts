// @vitest-environment node
//
// Migrated from e2e-tests/local_agent_supabase_deploy_progress.spec.ts.
//
// The `tc=local-agent/supabase-deploy-progress` fixture writes a shared
// Supabase module (supabase/functions/_shared/cors.ts) plus 20 edge
// functions. With the app connected to a Supabase project, the local agent
// deploys the functions through a bounded-concurrency queue at the end of
// the turn, streaming `<dyad-status>` progress updates
// ("Deploying Supabase functions: X/20 complete (N active, M queued)") and
// finishing with "Supabase functions deployed: 20/20 complete".
//
// E2E_TEST_BUILD=true (set in the hoisted block, before app modules import,
// because IS_TEST_BUILD is captured at module load) makes the Supabase
// management client return fake deploy results instead of calling the real
// Supabase API — the same mode the Playwright suite runs in.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  process.env.E2E_TEST_BUILD = "true";
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
import { apps } from "@/db/schema";
import { eq } from "drizzle-orm";

describe("local agent supabase deploy progress (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      chatMode: "local-agent",
      settings: {
        enableDyadPro: true,
        providerSettings: {
          auto: { apiKey: { value: "testdyadkey" } },
        },
      },
    });
    // Connect the app to a (fake) Supabase project — the equivalent of the
    // e2e test clicking "Connect Supabase" in test-build mode.
    await harness.db
      .update(apps)
      .set({ supabaseProjectId: "fake-project-id" })
      .where(eq(apps.id, harness.appId));
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("shows Supabase deploy queue progress and completes 20/20", async () => {
    const { messages, events, eventsFor } = await harness.streamChat(
      "tc=local-agent/supabase-deploy-progress",
    );
    // The local-agent branch of chat:stream returns void; success is signaled
    // by the stream-end event and the absence of error events.
    expect(eventsFor("chat:response:error")).toHaveLength(0);
    expect(events.map((e) => e.channel)).toContain("chat:stream:end");

    // All 21 files (shared helper + 20 edge functions) were written.
    expect(harness.appFileExists("supabase/functions/_shared/cors.ts")).toBe(
      true,
    );
    for (let i = 1; i <= 20; i++) {
      const name = `queue-test-${String(i).padStart(2, "0")}`;
      expect(harness.appFileExists(`supabase/functions/${name}/index.ts`)).toBe(
        true,
      );
    }

    // In-flight queue progress was streamed to the renderer while deploys
    // were running (equivalent of the e2e progress-text polling).
    const streamedText = JSON.stringify(
      eventsFor("chat:response:chunk").map((e) => e.payload),
    );
    expect(streamedText).toMatch(
      /Deploying Supabase functions: \d+\/20 complete \(\d+ active, \d+ queued\)/,
    );

    // The final persisted assistant message carries the finished status
    // (the e2e's post-completion assertion).
    const assistant = messages.find((m) => m.role === "assistant")!;
    expect(assistant.content).toContain(
      '<dyad-status title="Supabase functions deployed: 20/20 complete" state="finished">',
    );
    // The transient in-progress statuses were not persisted — only the
    // finished one.
    expect(assistant.content).not.toContain("Deploying Supabase functions:");
  }, 60_000);
});

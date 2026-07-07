// @vitest-environment happy-dom
// @vitest-environment-options {"happyDOM": {"settings": {"fetch": {"disableSameOriginPolicy": true}}}}
//
// Migrated from e2e-tests/local_agent_supabase_deploy_progress.spec.ts, then
// converted from the node chat-flow harness to the HYBRID harness (real
// <ChatPanel> over the real IPC stack).
//
// The `tc=local-agent/supabase-deploy-progress` fixture writes a shared
// Supabase module (supabase/functions/_shared/cors.ts) plus 20 edge
// functions. With the app connected to a Supabase project, the local agent
// deploys the functions through a bounded-concurrency queue at the end of
// the turn, streaming `<dyad-status>` progress updates
// ("Deploying Supabase functions: X/20 complete (N active, M queued)") and
// finishing with "Supabase functions deployed: 20/20 complete" — which now
// renders as the real <dyad-status> card in the messages list (the surface
// the Playwright spec polled).
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

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "en", changeLanguage: async () => {} },
  }),
  Trans: ({ children }: { children?: unknown }) => children ?? null,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import { screen, waitFor } from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { apps } from "@/db/schema";
import { eq } from "drizzle-orm";

describe("local agent supabase deploy progress (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      chatMode: "local-agent",
      settings: {
        isTestMode: true,
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
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("shows Supabase deploy queue progress and completes 20/20", async () => {
    harness.mount();

    await waitFor(
      () => {
        expect(screen.getByTestId("messages-list")).toBeTruthy();
        expect(screen.getByTestId("chat-input-container")).toBeTruthy();
      },
      { timeout: 15_000 },
    );

    const { send } = await harness.typeInChat(
      "tc=local-agent/supabase-deploy-progress",
    );
    send();

    // The finished <dyad-status> card renders in the messages list — the same
    // progress surface the e2e polled, in its terminal state.
    await waitFor(
      () =>
        expect(
          screen.getByText("Supabase functions deployed: 20/20 complete"),
        ).toBeTruthy(),
      { timeout: 30_000 },
    );

    // Gate main-side assertions on the real end-of-stream event.
    await harness.waitForStreamEnd(harness.chatId);

    // The local-agent branch of chat:stream returns void; success is signaled
    // by the stream-end event and the absence of error events (read off the
    // renderer bridge that received them).
    expect(
      harness.bridge.sentEvents.filter(
        (e) => e.channel === "chat:response:error",
      ),
    ).toHaveLength(0);
    expect(harness.bridge.sentEvents.map((e) => e.channel)).toContain(
      "chat:stream:end",
    );

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
      harness.bridge.sentEvents
        .filter((e) => e.channel === "chat:response:chunk")
        .map((e) => e.args[0]),
    );
    expect(streamedText).toMatch(
      /Deploying Supabase functions: \d+\/20 complete \(\d+ active, \d+ queued\)/,
    );

    // The final persisted assistant message carries the finished status
    // (the e2e's post-completion assertion).
    const messages = await harness.db.query.messages.findMany({
      where: (messages, { eq }) => eq(messages.chatId, harness.chatId),
      orderBy: (messages, { asc }) => [asc(messages.id)],
    });
    const assistant = messages.find((m) => m.role === "assistant")!;
    expect(assistant.content).toContain(
      '<dyad-status title="Supabase functions deployed: 20/20 complete" state="finished">',
    );
    // The transient in-progress statuses were not persisted — only the
    // finished one.
    expect(assistant.content).not.toContain("Deploying Supabase functions:");

    // Every channel the UI invoked had a real handler.
    expect([...harness.bridge.missingChannels]).toEqual([]);
  }, 90_000);
});

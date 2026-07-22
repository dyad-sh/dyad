// Migrated from e2e-tests/supabase_branch.spec.ts ("supabase branch selection
// works"), then converted from the node chat-flow harness to the HYBRID
// harness (real <ChatPanel> over the real IPC stack).
//
// The e2e asserted branch selection through the token bar: the default branch
// has a small Supabase context (~6% of the 128K window) while "Test Branch"
// resolves to project ref test-branch-project-id, whose mock context is 800K
// characters — pushing the estimate to 100% of the context window. The hybrid
// conversion re-adds that UI surface: the REAL TokenBar is toggled on through
// the auxiliary-actions menu and its rendered percentage + "Context window:
// 128K" label are asserted before and after the branch switch. The branch
// dropdown funnels into supabase:list-branches + supabase:set-app-project, so
// those handlers are exercised directly (E2E_TEST_BUILD=true routes the
// Supabase management client + context to the same mocks the Playwright suite
// used).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  // Routes the Supabase management client/context to their mock test-build
  // implementations (the same ones the Playwright suite used).
  process.env.E2E_TEST_BUILD = "true";
});

import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";
import { isIpcInvokeEnvelope, unwrapIpcEnvelope } from "@/ipc/contracts/core";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { eq } from "drizzle-orm";

interface SentEvent {
  channel: string;
  payload: any;
}

function makeEvent(sink: SentEvent[] = []) {
  const frame = { url: "http://localhost:5173/" };
  return {
    sender: {
      mainFrame: frame,
      isDestroyed: () => false,
      isCrashed: () => false,
      send: (channel: string, payload: unknown) =>
        sink.push({ channel, payload }),
    },
    senderFrame: frame,
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

describe("supabase branch selection (integration)", () => {
  let harness: HybridChatHarness;

  const countTokens = () =>
    invoke("chat:count-tokens", { chatId: harness.chatId, input: "" });

  /**
   * Reads the percentage the REAL TokenBar renders ("Tokens: N", "X%",
   * "Context window: 128K").
   */
  const tokenBarPercent = () => {
    const tokenBar = screen.getByTestId("token-bar");
    // The percentage is its own <span> ("6%"); textContent-level regexes would
    // bleed into the adjacent "Tokens: N" span.
    const percentSpan = within(tokenBar).getByText(/^\d+%$/);
    return Number((percentSpan.textContent ?? "").replace("%", ""));
  };

  /**
   * Clicks the "Show/Hide token usage" item in the auxiliary-actions dropdown
   * (Base UI Menu): open with focus + ArrowDown, activate the item with the
   * pointer/click/Enter choreography happy-dom needs. Toggling also
   * invalidates the tokenCount query (ChatInput.toggleShowTokenBar), which is
   * how the UI refreshes the bar.
   */
  const toggleTokenBar = async () => {
    const trigger = await screen.findByTestId("auxiliary-actions-menu");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const item = await screen.findByTestId("token-bar-toggle");
    fireEvent.pointerDown(item);
    fireEvent.pointerUp(item);
    fireEvent.click(item);
  };

  beforeAll(async () => {
    // The hybrid harness registers the full IPC handler set (including the
    // Supabase + token-count handlers the node version registered manually).
    harness = await setupHybridChatHarness({
      electronMock: h,
      settings: { isTestMode: true },
    });
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("supabase branch selection works", async () => {
    harness.mount();
    await waitFor(
      () => {
        expect(screen.getByTestId("messages-list")).toBeTruthy();
        expect(screen.getByTestId("chat-input-container")).toBeTruthy();
      },
      { timeout: 15_000 },
    );

    // The e2e's first turn: the add-supabase fixture streams through the real
    // chat flow, driven by the real Send button. (The node version asserted
    // chat:stream's return value === chatId; here success for the same chat is
    // the end event awaited below plus the absence of error events.)
    const { send } = await harness.typeInChat("tc=add-supabase");
    send();
    await harness.waitForStreamEnd(harness.chatId);
    expect(
      harness.bridge.sentEvents.filter(
        (e) => e.channel === "chat:response:error",
      ),
    ).toHaveLength(0);

    // Connect Supabase (the connect button's test path): stores fake org
    // credentials and links the app to fake-project-id.
    await invoke(
      "supabase:fake-connect-and-set-project",
      { appId: harness.appId, fakeProjectId: "fake-project-id" },
      [],
    );

    const appRow = await db.query.apps.findFirst({
      where: eq(apps.id, harness.appId),
    });
    expect(appRow?.supabaseProjectId).toBe("fake-project-id");
    expect(appRow?.supabaseOrganizationSlug).toBe("fake-org-id");

    // Show the REAL token bar through the auxiliary-actions menu (the e2e's
    // toggle) and assert the rendered label: 128K context window, small
    // percentage (the e2e showed 6%).
    await toggleTokenBar();
    await waitFor(() => expect(screen.getByTestId("token-bar")).toBeTruthy(), {
      timeout: 15_000,
    });
    await waitFor(
      () => {
        const tokenBar = screen.getByTestId("token-bar");
        expect(within(tokenBar).getByText("Context window: 128K")).toBeTruthy();
      },
      { timeout: 15_000 },
    );
    expect(tokenBarPercent()).toBeLessThan(20);

    // The default branch has a small context: the token bar showed ~6% of
    // the 128K context window ("Context window: 128K").
    const before = await countTokens();
    expect(before.contextWindow).toBe(128_000);
    expect(before.estimatedTotalTokens).toBeGreaterThan(0);
    // Small context: well under the window (the e2e showed 6%).
    expect(before.estimatedTotalTokens).toBeLessThan(0.2 * 128_000);

    // The branch dropdown lists the mock branches.
    const branches = await invoke("supabase:list-branches", {
      projectId: appRow!.supabaseProjectId,
      organizationSlug: appRow!.supabaseOrganizationSlug,
    });
    expect(branches).toEqual([
      {
        id: "default-branch-id",
        name: "Default Branch",
        isDefault: true,
        projectRef: "fake-project-id",
        parentProjectRef: "fake-project-id",
      },
      {
        id: "test-branch-id",
        name: "Test Branch",
        isDefault: false,
        projectRef: "test-branch-project-id",
        parentProjectRef: "fake-project-id",
      },
    ]);

    // Selecting "Test Branch" sets the branch's project ref on the app
    // (keeping the same organization slug), exactly as the dropdown does.
    const testBranch = branches.find((b: any) => b.name === "Test Branch");
    await invoke("supabase:set-app-project", {
      appId: harness.appId,
      projectId: testBranch.projectRef,
      parentProjectId: testBranch.parentProjectRef,
      organizationSlug: appRow!.supabaseOrganizationSlug,
    });

    const updatedRow = await db.query.apps.findFirst({
      where: eq(apps.id, harness.appId),
    });
    expect(updatedRow?.supabaseProjectId).toBe("test-branch-project-id");
    expect(updatedRow?.supabaseParentProjectId).toBe("fake-project-id");

    // The test branch has a large context (800K chars ≈ 200K tokens) so the
    // token bar hits the 100% limit — proving the right Supabase project is
    // consulted for the selected branch.
    const after = await countTokens();
    expect(after.contextWindow).toBe(128_000);
    expect(after.estimatedTotalTokens).toBeGreaterThanOrEqual(128_000);
    expect(after.systemPromptTokens).toBeGreaterThan(before.systemPromptTokens);

    // And the REAL token bar reflects it: toggle it off and back on (each
    // toggle invalidates the tokenCount query — the UI's own refresh path)
    // and the rendered percentage caps at 100%.
    await toggleTokenBar(); // hide
    await waitFor(() => expect(screen.queryByTestId("token-bar")).toBeNull());
    await toggleTokenBar(); // show again -> refetch
    await waitFor(
      () => {
        expect(screen.getByTestId("token-bar")).toBeTruthy();
        expect(tokenBarPercent()).toBe(100);
      },
      { timeout: 15_000 },
    );

    // Every channel the UI invoked had a real handler.
    expect([...harness.bridge.missingChannels]).toEqual([]);
  }, 60_000);
});

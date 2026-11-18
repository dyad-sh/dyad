// Switching from a chat in one app to a chat or app in another must never ask
// the newly selected app's repository for the previous chat's commit. The
// selected app and the routed chat update at different moments, and the
// modified-files card used to query in between, failing with
// `fatal: bad object <hash>` (reported to telemetry as an external error).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";
import { ipc } from "@/ipc/types";

type VersionChangesArgs = { appId: number; versionId: string };

describe("MessagesList modified-files card across apps", () => {
  let harness: HybridChatHarness;
  let appACommit: string;
  let appBId: number;
  let appBChatId: number;
  const appBName = "second-app";

  const versionChangeCalls = (since = 0) =>
    harness.bridge.invokeLog
      .slice(since)
      .filter((entry) => entry.channel === "get-version-changes")
      .map((entry) => ({
        args: entry.args[0] as VersionChangesArgs,
        status: entry.status,
      }));

  // App A's chat shows its card, so the switches below start from the state
  // that used to trigger the bad lookup (and the fix has not simply hidden it).
  const expectCardShownForAppA = () =>
    screen.findByTestId("modified-files-card", undefined, { timeout: 10_000 });

  const expectNoMismatchedQueries = async (since: number) => {
    // Wait for every call the switch kicked off, and their follow-ups, to settle.
    await act(async () => {
      await harness.bridge.settleInFlight();
    });
    const calls = versionChangeCalls(since);
    expect(
      calls.filter(
        ({ args }) =>
          args.versionId === appACommit && args.appId !== harness.appId,
      ),
    ).toEqual([]);
    expect(calls.filter(({ status }) => status === "rejected")).toEqual([]);
  };

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      settings: { isTestMode: true },
    });

    const created = await ipc.app.createApp({ name: appBName });
    appBId = created.app.id;
    appBChatId = created.chatId;

    // An AI turn in app A that edits files, so its chat ends with a commit
    // and shows the modified-files card.
    harness.mount();
    await screen.findByTestId("chat-input-container", undefined, {
      timeout: 15_000,
    });
    const { send } = await harness.typeInChat(
      "tc=local-agent/dyad-write-angle",
    );
    send();
    await harness.waitForStreamEnd(harness.chatId);
    const messages = await harness.db.query.messages.findMany();
    appACommit = messages.find(
      (message) =>
        message.chatId === harness.chatId && message.role === "assistant",
    )!.commitHash!;
    expect(appACommit).toBeTruthy();
    cleanup();
  }, 90_000);

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  it("does not query the other app's repository when switching chat tabs", async () => {
    harness.mountSurface({
      route: "/chat",
      withTitleBar: true,
      withChatList: true,
    });
    await expectCardShownForAppA();

    // Open app B's chat once through the chat list so it gets a tab, then
    // return to app A's chat through its tab.
    harness.setSelectedAppId(appBId);
    const appBChatItem = await screen.findByTestId(
      `chat-list-item-${appBChatId}`,
      undefined,
      { timeout: 10_000 },
    );
    await act(async () => {
      fireEvent.click(appBChatItem);
    });
    const tabButton = async (chatId: number) =>
      (
        await screen.findByTestId(`chat-tab-${chatId}`, undefined, {
          timeout: 10_000,
        })
      ).querySelector("button")!;
    await act(async () => {
      fireEvent.pointerDown(await tabButton(harness.chatId), { button: 0 });
    });
    await waitFor(() =>
      expect(harness.currentLocation().search).toMatchObject({
        id: harness.chatId,
      }),
    );
    await expectCardShownForAppA();

    const since = harness.bridge.invokeLog.length;
    await act(async () => {
      fireEvent.pointerDown(await tabButton(appBChatId), { button: 0 });
    });
    await waitFor(() =>
      expect(harness.currentLocation().search).toMatchObject({
        id: appBChatId,
      }),
    );
    await expectNoMismatchedQueries(since);
  }, 60_000);

  it("does not query the other app's repository when opening another app from the sidebar", async () => {
    harness.mountSurface({ route: "/chat", withAppList: true });
    await expectCardShownForAppA();

    const since = harness.bridge.invokeLog.length;
    const appBItem = await screen.findByText(appBName, undefined, {
      timeout: 10_000,
    });
    await act(async () => {
      fireEvent.click(appBItem);
    });
    await waitFor(() =>
      expect(harness.currentLocation().pathname).toBe("/app-details"),
    );
    await expectNoMismatchedQueries(since);
  }, 60_000);
});

import { render, screen, waitFor } from "@testing-library/react";
import { getDefaultStore, type PrimitiveAtom } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ASSERTION_PROPOSAL_VERSION,
  type AssertionProposalPayload,
} from "@/lib/test_recorder/assertion_proposal";
import { RECORDED_TEST_DRAFT_VERSION } from "@/lib/test_recorder/draft";
import { userInputRequestsAtom } from "@/user_input/projection";
import { DyadTestAssertionsCard } from "./DyadTestAssertionsCard";

/**
 * Which way an approval is handed back to the agent. `generate_test_assertions`
 * parks on this card, so the normal path answers that request and the turn picks
 * it up as its tool result — invisibly. Only a card whose turn is gone (reload,
 * stopped stream) may fall back to sending a visible chat message.
 */

const REQUEST_ID = "user-input-1";
const SPEC_PATH = "e2e-tests/recorded-add-an-item.spec.ts";

const mocks = vi.hoisted(() => ({
  respond: vi.fn(async () => true),
  streamMessage: vi.fn(),
  applyTestAssertions: vi.fn(async () => ({
    specPath: SPEC_PATH,
    appliedCount: 1,
    warning: undefined as string | undefined,
  })),
  syncChatFromDb: vi.fn(),
}));

vi.mock("@/user_input/projection", async () => {
  const { atom } = await import("jotai");
  return {
    getUserInputProjectionAdapter: () => ({ respond: mocks.respond }),
    userInputRequestsAtom: atom(new Map()),
  };
});

/** The live user-input requests the projection exposes, set per test. */
function setLiveRequests(requests: Map<string, { status: string }>): void {
  getDefaultStore().set(
    userInputRequestsAtom as unknown as PrimitiveAtom<unknown>,
    requests,
  );
}

vi.mock("@/atoms/chatAtoms", async () => {
  const { atom } = await import("jotai");
  return {
    selectedChatIdAtom: atom(7),
    chatMessagesByIdAtom: atom(new Map()),
  };
});

vi.mock("@/atoms/appAtoms", async () => {
  const { atom } = await import("jotai");
  return { selectedAppIdAtom: atom(4), previewModeAtom: atom("preview") };
});

vi.mock("@/atoms/viewAtoms", async () => {
  const { atom } = await import("jotai");
  return { selectedFileAtom: atom(null) };
});

vi.mock("@/hooks/useStreamChat", () => ({
  useStreamChat: () => ({ streamMessage: mocks.streamMessage }),
}));

vi.mock("@/ipc/types", () => ({
  ipc: { tests: { applyTestAssertions: mocks.applyTestAssertions } },
}));

vi.mock("@/lib/resyncChat", () => ({ syncChatFromDb: mocks.syncChatFromDb }));

vi.mock("@/lib/toast", () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
  showWarning: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const PAYLOAD: AssertionProposalPayload = {
  version: ASSERTION_PROPOSAL_VERSION,
  appId: 4,
  draft: {
    version: RECORDED_TEST_DRAFT_VERSION,
    draftId: "draft-test",
    testName: "add an item",
    authMode: "none",
    actions: [
      {
        kind: "click",
        locator: { kind: "role", value: "button", name: "Add" },
      },
    ],
  },
  testTitle: "add an item",
  specPath: null,
  items: [
    { kind: "step", stepIndex: 0, text: "Open the home page" },
    { kind: "step", stepIndex: 1, text: "Click the Add button" },
    {
      kind: "assertion",
      id: "assertion-0",
      text: "The item list shows one row",
      code: `await expect(page.getByTestId("row")).toBeVisible();`,
      needsCode: false,
      origin: "model",
    },
  ],
};

function renderCard() {
  return render(
    <DyadTestAssertionsCard
      node={{
        properties: {
          "proposal-id": "proposal-1",
          "request-id": REQUEST_ID,
          status: "proposed",
          "spec-path": "",
          state: "finished",
        },
      }}
    >
      {JSON.stringify(PAYLOAD)}
    </DyadTestAssertionsCard>,
  );
}

describe("DyadTestAssertionsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.respond.mockResolvedValue(true);
    setLiveRequests(new Map());
  });

  it("resumes the parked turn instead of sending a chat message", async () => {
    setLiveRequests(new Map([[REQUEST_ID, { status: "awaiting" }]]));
    renderCard();

    screen.getByTestId("dyad-test-assertions-approve-button").click();

    await waitFor(() =>
      expect(mocks.respond).toHaveBeenCalledWith(REQUEST_ID, {
        kind: "test-assertions",
        specPath: SPEC_PATH,
        appliedCount: 1,
      }),
    );
    expect(mocks.streamMessage).not.toHaveBeenCalled();
    // The resumed turn streams the approved card down itself; re-reading the DB
    // here would race it.
    expect(mocks.syncChatFromDb).not.toHaveBeenCalled();
  });

  it("closing the card answers the parked turn with no spec", async () => {
    setLiveRequests(new Map([[REQUEST_ID, { status: "awaiting" }]]));
    renderCard();

    screen.getByTestId("dyad-test-assertions-discard-button").click();

    await waitFor(() =>
      expect(mocks.respond).toHaveBeenCalledWith(REQUEST_ID, {
        kind: "test-assertions",
        specPath: null,
        appliedCount: 0,
      }),
    );
    expect(mocks.applyTestAssertions).not.toHaveBeenCalled();
    await screen.findByTestId("dyad-test-assertions-discarded-note");
  });

  it("hands the spec over as a new turn when nothing is waiting on the card", async () => {
    // No live request: the app restarted, or the turn was stopped.
    renderCard();

    expect(
      screen.queryByTestId("dyad-test-assertions-discard-button"),
    ).toBeNull();
    screen.getByTestId("dyad-test-assertions-approve-button").click();

    await waitFor(() => expect(mocks.streamMessage).toHaveBeenCalledTimes(1));
    expect(mocks.streamMessage.mock.calls[0][0].prompt).toContain(SPEC_PATH);
    expect(mocks.respond).not.toHaveBeenCalled();
    expect(mocks.syncChatFromDb).toHaveBeenCalledTimes(1);
  });

  it("falls back to a new turn when the parked request has expired", async () => {
    setLiveRequests(new Map([[REQUEST_ID, { status: "awaiting" }]]));
    mocks.respond.mockResolvedValue(false);
    renderCard();

    screen.getByTestId("dyad-test-assertions-approve-button").click();

    await waitFor(() => expect(mocks.streamMessage).toHaveBeenCalledTimes(1));
    expect(mocks.respond).toHaveBeenCalledTimes(1);
  });
});

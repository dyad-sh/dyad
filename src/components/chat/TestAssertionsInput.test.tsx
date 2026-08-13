import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ASSERTION_PROPOSAL_VERSION,
  type AssertionProposalPayload,
} from "@/lib/test_recorder/assertion_proposal";
import { buildAssertionsTagContent } from "@/lib/test_recorder/assertion_tag";
import { RECORDED_TEST_DRAFT_VERSION } from "@/lib/test_recorder/draft";
import {
  TestAssertionsInput,
  TestAssertionsPlanCard,
} from "./TestAssertionsInput";

/**
 * Which way an approval is handed back to the agent. `generate_test_assertions`
 * parks on this card, so the normal path answers that request and the turn picks
 * it up as its tool result — invisibly. Only a card whose turn is gone (reload,
 * stopped stream) may fall back to sending a visible chat message.
 *
 * Plus the composer's half of the deal: it puts up the plan the transcript says
 * is still waiting on a review, and takes it down the moment that changes.
 */

const REQUEST_ID = "user-input-1";
const PROPOSAL_ID = "proposal-1";
const SPEC_PATH = "e2e-tests/recorded-add-an-item.spec.ts";

const mocks = vi.hoisted(() => ({
  respond: vi.fn(async () => true),
  /** The live user-input requests the read model reports, set per test. */
  liveRequests: new Map<string, { status: string }>(),
  /** The selected chat's messages, as the composer reads them. */
  chatMessages: [] as { role: string; content: string }[],
  streamMessage: vi.fn(),
  applyTestAssertions: vi.fn(async () => ({
    specPath: SPEC_PATH,
    appliedCount: 1,
    warning: undefined as string | undefined,
  })),
  discardTestAssertions: vi.fn(async () => ({ ok: true as const })),
  syncChatFromDb: vi.fn(),
  showError: vi.fn(),
}));

vi.mock("@/user_input/hooks", () => ({
  useUserInputReadModel: () => ({
    respond: mocks.respond,
    // Read live rather than from the render snapshot, so the card can tell a
    // request main has dropped from one a transient failure left parked.
    getSnapshot: () => ({
      requests: mocks.liveRequests,
      respondingRequestIds: new Set<string>(),
    }),
  }),
  useUserInputRequests: () => mocks.liveRequests,
}));

/** The live user-input requests the projection exposes, set per test. */
function setLiveRequests(requests: Map<string, { status: string }>): void {
  mocks.liveRequests = requests;
}

/** A turn parked on this card, as both the snapshot and the live read report it. */
function parkTurn(): void {
  setLiveRequests(new Map([[REQUEST_ID, { status: "awaiting" }]]));
}

vi.mock("@/hooks/useChatMessages", () => ({
  useChatMessages: () => mocks.chatMessages,
}));

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

// The card asks the manager whether the chat is streaming before re-reading it
// from the DB; nothing here streams, so it never is.
vi.mock("@/chat_stream/ChatStreamProvider", () => ({
  useChatStreamManager: () => ({ getIsStreaming: () => false }),
}));

vi.mock("@/hooks/useStreamChat", () => ({
  useStreamChat: () => ({ streamMessage: mocks.streamMessage }),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    tests: {
      applyTestAssertions: mocks.applyTestAssertions,
      discardTestAssertions: mocks.discardTestAssertions,
    },
  },
}));

vi.mock("@/lib/resyncChat", () => ({ syncChatFromDb: mocks.syncChatFromDb }));

vi.mock("@/lib/toast", () => ({
  showError: mocks.showError,
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
    <TestAssertionsPlanCard
      proposalId={PROPOSAL_ID}
      requestId={REQUEST_ID}
      payload={PAYLOAD}
    />,
  );
}

/** An assistant message carrying one card, as the tool writes it. */
function messageWithPlan(status: "proposed" | "approved" | "discarded"): {
  role: string;
  content: string;
} {
  return {
    role: "assistant",
    content: `Here's what I'd check.\n\n${buildAssertionsTagContent({
      proposalId: PROPOSAL_ID,
      requestId: status === "proposed" ? REQUEST_ID : undefined,
      status,
      payload: PAYLOAD,
    })}`,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.respond.mockResolvedValue(true);
  mocks.discardTestAssertions.mockResolvedValue({ ok: true as const });
  mocks.chatMessages = [];
  setLiveRequests(new Map());
});

describe("TestAssertionsPlanCard", () => {
  it("resumes the parked turn instead of sending a chat message", async () => {
    parkTurn();
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
    parkTurn();
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

  it("latches the discard before answering the parked turn", async () => {
    // Answering resumes the agent, which re-reads this message row and keeps
    // streaming into it. A discard written after that read is overwritten by
    // the turn's own copy, and the closed plan comes back approvable.
    const order: string[] = [];
    mocks.discardTestAssertions.mockImplementationOnce(async () => {
      order.push("discard");
      return { ok: true as const };
    });
    mocks.respond.mockImplementationOnce(async () => {
      order.push("respond");
      return true;
    });
    parkTurn();
    renderCard();

    screen.getByTestId("dyad-test-assertions-discard-button").click();

    await waitFor(() => expect(order).toEqual(["discard", "respond"]));
  });

  it("leaves the plan approvable when the discard can't be recorded", async () => {
    // Answering the turn against a card that still reads as approvable would
    // end the turn and leave the plan live with nothing waiting on it.
    mocks.discardTestAssertions.mockRejectedValueOnce(new Error("db down"));
    parkTurn();
    renderCard();

    screen.getByTestId("dyad-test-assertions-discard-button").click();

    await waitFor(() =>
      expect(mocks.discardTestAssertions).toHaveBeenCalledTimes(1),
    );
    expect(mocks.respond).not.toHaveBeenCalled();
    expect(mocks.showError).toHaveBeenCalledWith(
      expect.stringMatching(/couldn't close.*db down/i),
    );
    expect(
      screen.queryByTestId("dyad-test-assertions-discarded-note"),
    ).toBeNull();
  });

  it("hands the spec over as a new turn when nothing is waiting on the card", async () => {
    // No live request: the app restarted, or the turn was stopped.
    renderCard();

    screen.getByTestId("dyad-test-assertions-approve-button").click();

    await waitFor(() => expect(mocks.streamMessage).toHaveBeenCalledTimes(1));
    expect(mocks.streamMessage.mock.calls[0][0].prompt).toContain(SPEC_PATH);
    expect(mocks.respond).not.toHaveBeenCalled();
    expect(mocks.syncChatFromDb).toHaveBeenCalledTimes(1);
  });

  it("falls back to a new turn when the parked request has expired", async () => {
    parkTurn();
    // What the read model does on a NotFound: the request is dropped, and only
    // then is there nothing left to resume.
    mocks.respond.mockImplementation(async () => {
      setLiveRequests(new Map());
      return false;
    });
    renderCard();

    screen.getByTestId("dyad-test-assertions-approve-button").click();

    await waitFor(() => expect(mocks.streamMessage).toHaveBeenCalledTimes(1));
    expect(mocks.respond).toHaveBeenCalledTimes(1);
  });

  it("does not start a second turn when the hand-off fails but the turn is still parked", async () => {
    // A transient IPC failure also answers false, but leaves the agent sitting
    // on this card. Starting a turn there queues a second generation behind the
    // parked one and hands the agent the same spec twice.
    parkTurn();
    mocks.respond.mockResolvedValue(false);
    renderCard();

    screen.getByTestId("dyad-test-assertions-approve-button").click();

    await waitFor(() => expect(mocks.respond).toHaveBeenCalledTimes(1));
    await screen.findByTestId("dyad-test-assertions-open-file-button");
    expect(mocks.streamMessage).not.toHaveBeenCalled();
    expect(mocks.syncChatFromDb).not.toHaveBeenCalled();
  });

  it("closes a plan nothing is waiting on, without answering a request", async () => {
    // A plan left over from a stopped turn or a restart is pinned to the
    // composer, so approving a test the user doesn't want must not be its only
    // exit. The latch is the whole close; the resync is what unpins the card.
    renderCard();

    screen.getByTestId("dyad-test-assertions-discard-button").click();

    await waitFor(() =>
      expect(mocks.discardTestAssertions).toHaveBeenCalledTimes(1),
    );
    await screen.findByTestId("dyad-test-assertions-discarded-note");
    expect(mocks.respond).not.toHaveBeenCalled();
    expect(mocks.applyTestAssertions).not.toHaveBeenCalled();
    expect(mocks.syncChatFromDb).toHaveBeenCalledTimes(1);
  });

  it("caps the plan's height so a long recording can't push the composer away", () => {
    renderCard();

    const list = screen.getByRole("list");
    expect(list.className).toContain("max-h-44");
    expect(list.className).toContain("overflow-y-auto");
  });
});

describe("TestAssertionsInput", () => {
  it("puts up the plan the transcript says is still waiting on a review", () => {
    parkTurn();
    mocks.chatMessages = [
      { role: "user", content: "record this" },
      messageWithPlan("proposed"),
    ];

    render(<TestAssertionsInput />);

    expect(screen.getByTestId("dyad-test-assertions-card")).toBeTruthy();
    expect(screen.getByTestId("dyad-test-assertions-step-0")).toBeTruthy();
    expect(
      screen.getByTestId("dyad-test-assertions-approve-button"),
    ).toBeTruthy();
  });

  it.each(["approved", "discarded"] as const)(
    "takes the plan down once the message says %s",
    (status) => {
      // The transcript's own receipt renders the outcome. Leaving the composer
      // card up too would put two approve buttons — and two "Generated"
      // badges — on screen at once.
      mocks.chatMessages = [messageWithPlan(status)];

      render(<TestAssertionsInput />);

      expect(screen.queryByTestId("dyad-test-assertions-card")).toBeNull();
    },
  );

  it("ignores a card that is still streaming in", () => {
    // No closing tag yet: the plan is half-written, and offering a partial one
    // for approval would generate a test from it.
    const whole = messageWithPlan("proposed").content;
    mocks.chatMessages = [
      { role: "assistant", content: whole.slice(0, whole.length - 30) },
    ];

    render(<TestAssertionsInput />);

    expect(screen.queryByTestId("dyad-test-assertions-card")).toBeNull();
  });

  it("shows nothing when the chat has no plan", () => {
    mocks.chatMessages = [{ role: "assistant", content: "no cards here" }];

    render(<TestAssertionsInput />);

    expect(screen.queryByTestId("dyad-test-assertions-card")).toBeNull();
  });

  it("keeps an unanswered plan reachable however far the chat has moved on", () => {
    // The transcript only carries a receipt now, so a plan that scrolls out of
    // reach is one that can never be approved OR closed. There is no cutoff.
    mocks.chatMessages = [
      messageWithPlan("proposed"),
      ...Array.from({ length: 80 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `chatter ${i}`,
      })),
    ];

    render(<TestAssertionsInput />);

    expect(screen.getByTestId("dyad-test-assertions-card")).toBeTruthy();
    expect(
      screen.getByTestId("dyad-test-assertions-approve-button"),
    ).toBeTruthy();
  });

  it("puts the newest unanswered plan on top and says how many are behind it", () => {
    // Two plans waiting is a queue, not a dead end: answering this one brings
    // the older one up, so the older receipt's "waiting for your review" holds.
    const older = messageWithPlan("proposed");
    const newer = {
      role: "assistant",
      content: buildAssertionsTagContent({
        proposalId: "proposal-2",
        requestId: "user-input-2",
        status: "proposed",
        payload: { ...PAYLOAD, testTitle: "the newer flow" },
      }),
    };
    mocks.chatMessages = [older, newer];

    render(<TestAssertionsInput />);

    const card = screen.getByTestId("dyad-test-assertions-card");
    expect(card.textContent).toContain("the newer flow");
    expect(card.textContent).toContain("(1 of 2)");
  });
});

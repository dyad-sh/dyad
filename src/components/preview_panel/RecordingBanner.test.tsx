import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RecordingPhase } from "@/atoms/recorderAtoms";
import type { TestRecorderController } from "@/hooks/useTestRecorder";
import { RECORDED_TEST_DRAFT_VERSION } from "@/lib/test_recorder/draft";
import { RecordingBanner } from "./RecordingBanner";

function makeRecorder(
  phase: RecordingPhase,
  overrides: Partial<TestRecorderController> = {},
): TestRecorderController {
  return {
    phase,
    isolation: undefined,
    auth: undefined,
    warning: undefined,
    progress: undefined,
    error: undefined,
    draft: {
      version: RECORDED_TEST_DRAFT_VERSION,
      draftId: "draft-test",
      testName: "add item",
      authMode: "none",
      actions: [],
    },
    draftSteps: [
      'await page.getByRole("button", { name: "Increment" }).click();',
    ],
    entryCount: 1,
    steps: ['await page.getByRole("button", { name: "Increment" }).click();'],
    isRecording: phase === "recording",
    isBusy: false,
    awaitingAssertions: false,
    startRecording: vi.fn(),
    stopAndReview: vi.fn(),
    recordNavigation: vi.fn(),
    recordHistoryMove: vi.fn(),
    cancelRecording: vi.fn(),
    markAwaitingAssertions: vi.fn(),
    discardDraft: vi.fn(),
    ...overrides,
  } as TestRecorderController;
}

function renderBanner(recorder: TestRecorderController) {
  return render(
    <RecordingBanner recorder={recorder} onGenerateAssertions={vi.fn()} />,
  );
}

describe("RecordingBanner", () => {
  it("shows each recorded step in full, reachable by keyboard", () => {
    const long =
      'await page.getByRole("button", { name: "Save this rather long label" }).click();';
    renderBanner(makeRecorder("reviewing", { draftSteps: [long, long] }));

    const list = screen.getByTestId("preview-recorded-steps");
    // The label at the END of the locator is what tells two otherwise identical
    // steps apart, so the statement must never be cut short.
    expect(screen.getByTestId("preview-recorded-step-0").textContent).toContain(
      long,
    );
    // The list is capped and scrolls; nothing inside it takes focus, so the list
    // itself has to be reachable or the steps past the fold need a mouse.
    expect(list.getAttribute("tabindex")).toBe("0");
    expect(list.getAttribute("aria-label")).toBe("Recorded steps");
  });

  it("offers exactly one way forward and one way out", () => {
    // A recording becomes a test by being proposed and approved, so the review
    // has one action and one dismissal — nothing here can write a spec that
    // nobody has checked.
    const { container } = renderBanner(makeRecorder("reviewing"));

    expect(
      screen.getByTestId("preview-recording-generate-assertions-button")
        .textContent,
    ).toContain("Generate test proposal");
    expect(screen.getByTestId("preview-recording-discard-button")).toBeTruthy();
    // The details toggle plus those two.
    expect(container.querySelectorAll("button")).toHaveLength(3);
  });

  it("keeps both actions reachable while the AI is asked for a proposal", () => {
    // The request can fail, be cancelled, or end without the tool ever being
    // called. This bar is the only place the parked draft can still be asked
    // about again or thrown away, so neither may disappear on dispatch — and
    // the wait itself has to be visible.
    renderBanner(makeRecorder("reviewing", { awaitingAssertions: true }));

    const status = screen.getByTestId("preview-recording-review-status");
    expect(status.textContent).toContain("Asking the AI for assertions");
    expect(status.getAttribute("role")).toBe("status");
    expect(
      screen.getByTestId("preview-recording-generate-assertions-button")
        .textContent,
    ).toContain("Ask again");
    expect(screen.getByTestId("preview-recording-discard-button")).toBeTruthy();
  });

  it("confirms before throwing the recording away", () => {
    const recorder = makeRecorder("reviewing");
    renderBanner(recorder);

    // The steps exist nowhere else at this point — nothing is on disk and the
    // entries buffer was dropped when the session stopped — so the first click
    // must only arm the decision.
    fireEvent.click(screen.getByTestId("preview-recording-discard-button"));
    expect(recorder.discardDraft).not.toHaveBeenCalled();

    const confirm = screen.getByTestId(
      "preview-recording-discard-confirm-button",
    );
    // Says what is being thrown away, not just "are you sure".
    expect(confirm.textContent).toContain("1 step");
    fireEvent.click(confirm);

    expect(recorder.discardDraft).toHaveBeenCalledTimes(1);
  });

  it("lets an armed discard be backed out of", () => {
    // The reviewing phase never changes, so the phase-change effect that resets
    // the confirm never fires — armed used to mean armed for good, with the
    // destructive button sitting in the slot the trigger occupied.
    const recorder = makeRecorder("reviewing");
    renderBanner(recorder);

    fireEvent.click(screen.getByTestId("preview-recording-discard-button"));
    fireEvent.click(
      screen.getByTestId("preview-recording-discard-cancel-button"),
    );

    expect(recorder.discardDraft).not.toHaveBeenCalled();
    // Back to the trigger, so the recording is still one deliberate pair of
    // clicks away from being thrown out rather than one.
    expect(screen.getByTestId("preview-recording-discard-button")).toBeTruthy();
    expect(
      screen.queryByTestId("preview-recording-discard-confirm-button"),
    ).toBeNull();
  });

  it("disarms a discard when focus leaves the confirmation", () => {
    const recorder = makeRecorder("reviewing");
    renderBanner(recorder);

    fireEvent.click(screen.getByTestId("preview-recording-discard-button"));
    const confirm = screen.getByTestId(
      "preview-recording-discard-confirm-button",
    );
    // Focus moving between Discard and Keep is not a cancel.
    fireEvent.blur(confirm, {
      relatedTarget: screen.getByTestId(
        "preview-recording-discard-cancel-button",
      ),
    });
    expect(
      screen.queryByTestId("preview-recording-discard-confirm-button"),
    ).not.toBeNull();

    fireEvent.blur(confirm, { relatedTarget: null });

    expect(recorder.discardDraft).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("preview-recording-discard-confirm-button"),
    ).toBeNull();
  });

  it("offers a way out of a setup that is taking too long", () => {
    // `startRecording` resolves only once it holds the app's lock, so this phase
    // can wait indefinitely behind another app operation — with the preview
    // dimmed and click-swallowing and the toolbar record button disabled, this
    // is the only exit short of the 30-minute session cap.
    const recorder = makeRecorder("starting", { isBusy: true });
    renderBanner(recorder);

    fireEvent.click(
      screen.getByTestId("preview-recording-setup-cancel-button"),
    );

    expect(recorder.cancelRecording).toHaveBeenCalledTimes(1);
  });
});

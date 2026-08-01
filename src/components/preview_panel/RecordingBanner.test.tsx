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
      testName: "add item",
      authMode: "none",
      actions: [],
    },
    draftSteps: [
      'await page.getByRole("button", { name: "Increment" }).click();',
    ],
    savedSpecPath: undefined,
    entryCount: 1,
    steps: ['await page.getByRole("button", { name: "Increment" }).click();'],
    isRecording: phase === "recording",
    isBusy: false,
    awaitingAssertions: false,
    startRecording: vi.fn(),
    stopAndReview: vi.fn(),
    saveWithoutAssertions: vi.fn(),
    cancelRecording: vi.fn(),
    dismissReview: vi.fn(),
    markAwaitingAssertions: vi.fn(),
    discardDraft: vi.fn(),
    ...overrides,
  } as TestRecorderController;
}

function renderBanner(recorder: TestRecorderController) {
  return render(
    <RecordingBanner
      recorder={recorder}
      onGenerateAssertions={vi.fn()}
      onOpenSavedSpec={vi.fn()}
    />,
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

  it("keeps every recovery action reachable while the AI is asked for assertions", () => {
    // The request can fail, be cancelled, or end without the tool ever being
    // called. This bar is the only place the parked draft can still be saved
    // as-is, discarded, or asked again, so none of that may disappear on
    // dispatch — and the wait itself has to be visible.
    renderBanner(makeRecorder("reviewing", { awaitingAssertions: true }));

    const status = screen.getByTestId("preview-recording-review-status");
    expect(status.textContent).toContain("Asking the AI for assertions");
    expect(status.getAttribute("role")).toBe("status");
    expect(
      screen.getByTestId("preview-recording-generate-assertions-button")
        .textContent,
    ).toContain("Ask again");
    expect(
      screen.getByTestId("preview-recording-save-plain-button"),
    ).toBeTruthy();
    expect(screen.getByTestId("preview-recording-discard-button")).toBeTruthy();
  });

  it("hides the review on request without discarding the recording", () => {
    // The draft outlives the bar — the chat card owns it from here — so closing
    // must not be wired to discardDraft.
    const recorder = makeRecorder("reviewing");
    renderBanner(recorder);

    fireEvent.click(screen.getByTestId("preview-recording-hide-review-button"));

    expect(recorder.dismissReview).toHaveBeenCalledTimes(1);
    expect(recorder.discardDraft).not.toHaveBeenCalled();
  });
});

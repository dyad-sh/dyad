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
    startRecording: vi.fn(),
    stopAndReview: vi.fn(),
    saveWithoutAssertions: vi.fn(),
    cancelRecording: vi.fn(),
    dismissReview: vi.fn(),
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
  it("collapses and re-expands the recorded steps under review", () => {
    renderBanner(makeRecorder("reviewing"));

    expect(screen.getByTestId("preview-recorded-steps")).toBeTruthy();

    const toggle = screen.getByTestId("preview-recording-details-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(toggle);
    expect(screen.queryByTestId("preview-recorded-steps")).toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // The decision the review asks for stays reachable while collapsed.
    expect(
      screen.getByTestId("preview-recording-generate-assertions-button"),
    ).toBeTruthy();

    fireEvent.click(toggle);
    expect(screen.getByTestId("preview-recorded-steps")).toBeTruthy();
  });

  it("collapses the live code while recording", () => {
    renderBanner(makeRecorder("recording"));

    expect(screen.getByTestId("preview-recording-code")).toBeTruthy();
    fireEvent.click(screen.getByTestId("preview-recording-details-toggle"));
    expect(screen.queryByTestId("preview-recording-code")).toBeNull();
    // Stopping is the point of the bar — it must survive a collapse.
    expect(screen.getByTestId("preview-recording-stop-button")).toBeTruthy();
  });

  it("re-opens the details when the phase changes", () => {
    const { rerender } = renderBanner(makeRecorder("recording"));

    fireEvent.click(screen.getByTestId("preview-recording-details-toggle"));
    expect(screen.queryByTestId("preview-recording-code")).toBeNull();

    rerender(
      <RecordingBanner
        recorder={makeRecorder("reviewing")}
        onGenerateAssertions={vi.fn()}
        onOpenSavedSpec={vi.fn()}
      />,
    );

    expect(screen.getByTestId("preview-recorded-steps")).toBeTruthy();
  });

  it("offers no disclosure for phases with nothing to disclose", () => {
    renderBanner(
      makeRecorder("saved", { savedSpecPath: "e2e-tests/recorded.spec.ts" }),
    );

    expect(screen.queryByTestId("preview-recording-details-toggle")).toBeNull();
    expect(
      screen.getByTestId("preview-recording-open-file-button"),
    ).toBeTruthy();
  });

  it("keeps a warning inside the one banner", () => {
    renderBanner(
      makeRecorder("recording", {
        warning: "Recording without authentication.",
      }),
    );

    const bar = screen.getByTestId("preview-recording-bar");
    expect(bar.contains(screen.getByTestId("preview-recording-warning"))).toBe(
      true,
    );
  });
});

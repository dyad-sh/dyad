import { useEffect, useState, type ReactNode } from "react";
import {
  ChevronRight,
  CircleDot,
  Loader2,
  Sparkles,
  Square,
  X,
} from "lucide-react";

import type { TestRecorderController } from "@/hooks/useTestRecorder";
import { draftTitle } from "@/lib/test_recorder/draft";
import { cn } from "@/lib/utils";
import { RecordedStepsList } from "./RecordedStepsList";
import { RecordingCodePreview } from "./RecordingCodePreview";

/**
 * Quiet actions in the recording banner. The banner has a tinted surface of its
 * own, so the hover fill is a deeper tint of it — a neutral `bg-muted` would read
 * as a control pasted on top rather than part of it.
 */
const SECONDARY_BUTTON_CLASSES =
  "rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-purple-100/80 hover:text-foreground dark:hover:bg-purple-900/40";

const PRIMARY_BUTTON_CLASSES =
  "flex items-center gap-1 rounded-md bg-purple-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-purple-700 disabled:opacity-60";

/** Ties the disclosure button to the section it opens, for screen readers. */
const DETAILS_ID = "preview-recording-details";

/** Status line for the recorder's non-interactive (spinner) phases. */
export function recordingStatusMessage(
  recorder: TestRecorderController,
): string {
  switch (recorder.phase) {
    case "finishing":
      return "Wrapping up the recording…";
    case "stopping":
      return "Cleaning up the test environment…";
    case "authenticating":
      return recorder.progress ?? "Signing in the test user…";
    default:
      return recorder.progress ?? "Setting up the test environment…";
  }
}

/**
 * The recorder's whole presence in the preview: one banner, every phase.
 *
 * Deliberately a single surface — status line, live code, recorded steps and any
 * warning all sit on the same tint inside one border, or they read as a stack of
 * unrelated alerts wedged between the toolbar and the app. Everything below the
 * status line is a disclosure: collapsing keeps the decision in reach while
 * handing the preview its height back.
 */
export function RecordingBanner({
  recorder,
  onGenerateAssertions,
}: {
  recorder: TestRecorderController;
  /** Hand the recorded steps to the agent for the test proposal. */
  onGenerateAssertions: () => void;
}) {
  const [recordName, setRecordName] = useState("");
  const [isExpanded, setIsExpanded] = useState(true);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  // Each phase opens showing its details: a bar collapsed while recording still
  // opens on the review, the one part the user is asked to actually read.
  useEffect(() => {
    setIsExpanded(true);
    // A confirm armed in one phase must not still be armed in the next.
    setConfirmingDiscard(false);
  }, [recorder.phase]);

  const details: ReactNode = recorder.isRecording ? (
    <RecordingCodePreview steps={recorder.steps} />
  ) : recorder.phase === "reviewing" ? (
    <RecordedStepsList steps={recorder.draftSteps} />
  ) : null;
  const detailsLabel = recorder.isRecording
    ? "live test code"
    : "recorded steps";

  // The status line is split into the label the disclosure toggles and the rest
  // of the row (metadata plus this phase's actions), which stays clickable.
  let label: ReactNode;
  let rest: ReactNode = null;

  if (recorder.isRecording) {
    label = (
      <span className="flex items-center gap-1.5 font-medium text-purple-700 dark:text-purple-300">
        <CircleDot size={14} className="animate-pulse" />
        Recording
      </span>
    );
    rest = (
      <>
        <span
          className="text-muted-foreground"
          data-testid="preview-recording-step-count"
        >
          {recorder.entryCount} step{recorder.entryCount === 1 ? "" : "s"}
        </span>
        {recorder.isolation && recorder.isolation.mode !== "none" && (
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            isolated data
          </span>
        )}
        {recorder.isolation &&
          recorder.isolation.mode !== "none" &&
          recorder.auth?.mode === "none" && (
            <span
              className="rounded bg-purple-100 px-1.5 py-0.5 text-xs text-muted-foreground dark:bg-purple-900/40"
              data-testid="preview-recording-signed-out-badge"
            >
              signed out
            </span>
          )}
        {/* Optional: left empty, the AI names the test from what was recorded,
            which it can do knowing how the flow actually went. */}
        <input
          value={recordName}
          onChange={(e) => setRecordName(e.target.value)}
          placeholder="Test name (optional)"
          aria-label="Test name (optional)"
          title="Leave empty and the AI names the test from the recorded steps"
          data-testid="preview-recording-name-input"
          className="ml-auto min-w-0 max-w-48 flex-1 rounded-sm border border-border bg-(--background-lightest) px-2 py-1 text-xs outline-none"
        />
        <button
          onClick={() => void recorder.stopAndReview(recordName)}
          data-testid="preview-recording-stop-button"
          className={PRIMARY_BUTTON_CLASSES}
        >
          <Square size={12} /> Stop
        </button>
        <button
          onClick={() => void recorder.cancelRecording()}
          data-testid="preview-recording-cancel-button"
          className={SECONDARY_BUTTON_CLASSES}
        >
          Cancel
        </button>
      </>
    );
  } else if (recorder.phase === "reviewing") {
    // Unnamed until the AI proposes a name, which is the usual case — the name
    // input while recording is there for users who want to insist on one.
    const named = Boolean(recorder.draft?.testName);
    label = (
      <span
        className={cn(
          "min-w-0 truncate font-medium",
          named ? "text-foreground" : "text-muted-foreground italic",
        )}
        data-testid="preview-recording-review-title"
      >
        {recorder.draft ? draftTitle(recorder.draft) : ""}
      </span>
    );
    rest = (
      <>
        <span
          className={cn(
            "flex items-center gap-1.5",
            recorder.awaitingAssertions
              ? "text-purple-700 dark:text-purple-300"
              : "text-muted-foreground",
          )}
          // This line changes on its own when the agent's card arrives, fails,
          // or is cancelled. The region has to be present *before* it changes,
          // or a screen reader announces the wait starting and nothing after —
          // never that it finished.
          role="status"
          data-testid="preview-recording-review-status"
        >
          {recorder.awaitingAssertions ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              Asking the AI for assertions…
            </>
          ) : (
            <>
              {recorder.draftSteps.length} step
              {recorder.draftSteps.length === 1 ? "" : "s"} recorded — not saved
              yet
            </>
          )}
        </span>
        {/* The one way forward: the AI turns the recording into a proposed test
            — a name, the steps, and the assertions — which the user approves in
            the chat card. That approval is what writes the file. */}
        <button
          onClick={onGenerateAssertions}
          data-testid="preview-recording-generate-assertions-button"
          className={cn(PRIMARY_BUTTON_CLASSES, "ml-auto")}
        >
          <Sparkles size={12} />{" "}
          {recorder.awaitingAssertions ? "Ask again" : "Generate test proposal"}
        </button>
        {/* Two-step, because this is the only copy: nothing has been written to
            disk, the entries buffer was dropped when the session stopped, and
            the parked draft dies with it — a mis-click throws away a flow the
            user may have spent minutes performing, with no undo. An inline
            confirm rather than a dialog: the bar is already the decision
            surface, and a modal over the preview for one button is heavier than
            the action deserves. */}
        {confirmingDiscard ? (
          // "Keep" holds the slot the X occupied, and Discard sits beside it,
          // so the pointer that armed this is not already over the destructive
          // button — an accidental double-click keeps the recording. Focus
          // leaving the pair disarms it too: without an escape the confirm
          // stayed armed for the rest of the review, since the phase-change
          // effect that resets it never fires while reviewing.
          <span
            className="flex items-center gap-1"
            onBlur={(e) => {
              if (e.currentTarget.contains(e.relatedTarget)) return;
              setConfirmingDiscard(false);
            }}
          >
            <button
              onClick={() => void recorder.discardDraft()}
              data-testid="preview-recording-discard-confirm-button"
              className={cn(
                SECONDARY_BUTTON_CLASSES,
                "font-medium text-red-700 hover:bg-red-100 hover:text-red-800 dark:text-red-300 dark:hover:bg-red-900/40",
              )}
            >
              Discard {recorder.draftSteps.length} step
              {recorder.draftSteps.length === 1 ? "" : "s"}?
            </button>
            <button
              onClick={() => setConfirmingDiscard(false)}
              data-testid="preview-recording-discard-cancel-button"
              className={cn(SECONDARY_BUTTON_CLASSES, "font-medium")}
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            onClick={() => setConfirmingDiscard(true)}
            aria-label="Discard this recording"
            title="Discard this recording"
            data-testid="preview-recording-discard-button"
            className={cn(SECONDARY_BUTTON_CLASSES, "flex items-center px-1.5")}
          >
            <X size={14} />
          </button>
        )}
      </>
    );
  } else {
    label = (
      // Deliberately NOT a live region. The setup overlay covers exactly these
      // phases and announces this same line, followed by what to do about it —
      // two live regions carrying identical text announce it twice.
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Loader2 size={14} className="animate-spin" />
        {recordingStatusMessage(recorder)}
      </span>
    );
    // Setup can legitimately wait indefinitely: `startRecording` only resolves
    // once it holds the app's lock, and the handler itself reports "waiting for
    // a previous app operation to finish". Without this the user is left with a
    // dimmed, click-swallowing preview, a disabled record button and no way out
    // short of the 30-minute session cap. Not offered for the teardown phases —
    // they are already ending, and a second stop has nothing to act on.
    if (recorder.phase === "starting" || recorder.phase === "authenticating") {
      rest = (
        <button
          onClick={() => void recorder.cancelRecording()}
          data-testid="preview-recording-setup-cancel-button"
          className={cn(SECONDARY_BUTTON_CLASSES, "ml-auto")}
        >
          Cancel
        </button>
      );
    }
  }

  return (
    <div
      className="border-b border-purple-200/70 bg-purple-50/70 dark:border-purple-900/50 dark:bg-purple-950/25"
      data-testid="preview-recording-bar"
    >
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
        {details ? (
          <button
            type="button"
            onClick={() => setIsExpanded((expanded) => !expanded)}
            aria-expanded={isExpanded}
            aria-controls={DETAILS_ID}
            aria-label={`${isExpanded ? "Hide" : "Show"} ${detailsLabel}`}
            title={`${isExpanded ? "Hide" : "Show"} ${detailsLabel}`}
            data-testid="preview-recording-details-toggle"
            className="-ml-1 flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:bg-purple-100/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/40 dark:hover:bg-purple-900/40"
          >
            <ChevronRight
              size={13}
              className={cn(
                "shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
                isExpanded && "rotate-90",
              )}
            />
            {label}
          </button>
        ) : (
          label
        )}
        {rest}
      </div>

      {recorder.warning && (
        <p
          className="px-3 pb-2 text-xs text-amber-700 dark:text-amber-400"
          data-testid="preview-recording-warning"
        >
          {recorder.warning}
        </p>
      )}

      {details && isExpanded && (
        <div
          id={DETAILS_ID}
          className={cn(
            // The live code is one more row of the same status line; a hairline
            // there splits the recorder into two banners. The review list
            // scrolls, so it keeps an edge for content to disappear under.
            !recorder.isRecording &&
              "border-t border-purple-200/60 dark:border-purple-900/40",
          )}
        >
          {details}
        </div>
      )}
    </div>
  );
}

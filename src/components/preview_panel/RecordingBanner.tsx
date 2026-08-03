import { useEffect, useState, type ReactNode } from "react";
import {
  ChevronRight,
  CircleDot,
  FileCode2,
  Loader2,
  Sparkles,
  Square,
} from "lucide-react";

import type { TestRecorderController } from "@/hooks/useTestRecorder";
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
    case "saving":
      return "Generating the test file…";
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
  onOpenSavedSpec,
}: {
  recorder: TestRecorderController;
  /** Hand the recorded steps to the agent for the assertion pass. */
  onGenerateAssertions: () => void;
  /** Open the generated spec in the Code tab. */
  onOpenSavedSpec: (specPath: string) => void;
}) {
  const [recordName, setRecordName] = useState("");
  const [isExpanded, setIsExpanded] = useState(true);

  // Each phase opens showing its details: a bar collapsed while recording still
  // opens on the review, the one part the user is asked to actually read.
  useEffect(() => {
    setIsExpanded(true);
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
        <input
          value={recordName}
          onChange={(e) => setRecordName(e.target.value)}
          placeholder="Test name"
          aria-label="Test name"
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
    label = (
      <span className="min-w-0 truncate font-medium text-foreground">
        {recorder.draft?.testName}
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
        <button
          onClick={onGenerateAssertions}
          data-testid="preview-recording-generate-assertions-button"
          className={cn(PRIMARY_BUTTON_CLASSES, "ml-auto")}
        >
          <Sparkles size={12} />{" "}
          {recorder.awaitingAssertions ? "Ask again" : "Generate assertions"}
        </button>
        <button
          onClick={() => void recorder.saveWithoutAssertions()}
          data-testid="preview-recording-save-plain-button"
          className={cn(SECONDARY_BUTTON_CLASSES, "flex items-center gap-1")}
        >
          <FileCode2 size={12} /> Save without assertions
        </button>
        <button
          onClick={() => void recorder.discardDraft()}
          data-testid="preview-recording-discard-button"
          className={SECONDARY_BUTTON_CLASSES}
        >
          Discard
        </button>
        {/* The draft outlives this bar — the chat card owns it from here — so
            closing is only ever hiding, never discarding. */}
        <button
          onClick={() => recorder.dismissReview()}
          title="Hide this bar — the recording stays available in the chat card"
          data-testid="preview-recording-hide-review-button"
          className={SECONDARY_BUTTON_CLASSES}
        >
          Hide
        </button>
      </>
    );
  } else if (recorder.phase === "saved") {
    label = (
      <span className="min-w-0 truncate font-medium text-emerald-700 dark:text-emerald-300">
        Saved {recorder.savedSpecPath}
      </span>
    );
    rest = (
      <>
        <button
          onClick={() =>
            recorder.savedSpecPath && onOpenSavedSpec(recorder.savedSpecPath)
          }
          data-testid="preview-recording-open-file-button"
          className={cn(
            SECONDARY_BUTTON_CLASSES,
            "ml-auto flex items-center gap-1",
          )}
        >
          <FileCode2 size={12} /> Open test file
        </button>
        <button
          onClick={() => recorder.dismissReview()}
          data-testid="preview-recording-done-button"
          className={SECONDARY_BUTTON_CLASSES}
        >
          Done
        </button>
      </>
    );
  } else {
    label = (
      // The spinner phases only say what they're doing in this line, and it
      // changes in place — a live region is what makes that reach a screen
      // reader at all.
      <span
        role="status"
        className="flex items-center gap-1.5 text-muted-foreground"
      >
        <Loader2 size={14} className="animate-spin" />
        {recordingStatusMessage(recorder)}
      </span>
    );
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

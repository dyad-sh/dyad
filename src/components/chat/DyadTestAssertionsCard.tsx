import React, { useMemo } from "react";
import { useSetAtom } from "jotai";
import { Check, FlaskConical } from "lucide-react";

import { previewModeAtom } from "@/atoms/appAtoms";
import { selectedFileAtom } from "@/atoms/viewAtoms";
import { cn } from "@/lib/utils";
import { countAssertions } from "@/lib/test_recorder/assertion_proposal";
import { parseAssertionsPayload } from "@/lib/test_recorder/assertion_tag";
import type { CustomTagState } from "./stateTypes";

/**
 * The `<dyad-test-assertions>` tag as it appears in the transcript: a receipt,
 * not a control.
 *
 * The plan is reviewed on the composer (`TestAssertionsInput`), where the other
 * things waiting on the user live, so this stays a one-line record of what the
 * plan was and what was decided. Only ONE of the two renders a given plan at a
 * time — this one is silent while the tag still says "proposed", the composer
 * unmounts the moment it doesn't — which is what keeps a single approve button
 * and a single "Generated" badge on screen.
 */

/** The accent, in the recorder's purple. Also readable on a dark surface. */
const ACCENT_TEXT = "text-purple-700 dark:text-purple-300";

interface DyadTestAssertionsCardProps {
  node: {
    properties: {
      "proposal-id"?: string;
      "request-id"?: string;
      status?: string;
      "spec-path"?: string;
      state?: CustomTagState;
    };
  };
  children?: React.ReactNode;
}

/** Flatten the parser's children into the raw JSON payload string. */
function toText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(toText).join("");
  return children == null || typeof children === "boolean"
    ? ""
    : String(children);
}

function ReceiptShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="my-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-border/60 bg-(--background-lightest) px-3 py-2"
      data-testid="dyad-test-assertions-receipt"
    >
      <FlaskConical className={cn("size-3.5 shrink-0", ACCENT_TEXT)} />
      {children}
    </div>
  );
}

export const DyadTestAssertionsCard: React.FC<DyadTestAssertionsCardProps> = ({
  node,
  children,
}) => {
  const rawPayload = useMemo(() => toText(children), [children]);
  const payload = useMemo(
    () => parseAssertionsPayload(rawPayload),
    [rawPayload],
  );
  const status = node.properties.status ?? "proposed";
  const specPath = node.properties["spec-path"] || payload?.specPath || "";

  const setSelectedFile = useSetAtom(selectedFileAtom);
  const setPreviewMode = useSetAtom(previewModeAtom);
  const openSpecFile = () => {
    if (!specPath) return;
    setSelectedFile({ path: specPath });
    setPreviewMode("code");
  };

  if (!payload) {
    // The tag arrives a character at a time, so incomplete JSON is the normal
    // state for most of a turn — telling the user to start over while the model
    // is still writing the plan is both wrong and unrecoverable-sounding. The
    // parser hands us exactly the signal needed to tell the two apart.
    // Specifically "pending", not "not finished": `aborted`, `error` and
    // `warning` all mean the plan is never arriving, and treating them as
    // pending leaves the card spinning on "Preparing…" forever instead of
    // saying the proposal can't be read.
    const isPending = node.properties.state === "pending";
    return (
      <ReceiptShell>
        <span className="text-sm text-foreground">
          {isPending ? "Preparing the test proposal…" : "Test assertions"}
        </span>
        <span className="min-w-0 flex-1 text-xs text-muted-foreground">
          {isPending ? (
            "Naming the test, describing your recorded steps and proposing the checks."
          ) : (
            <>
              This proposal couldn&apos;t be read
              {specPath ? ` for ${specPath}` : ""}. Ask for assertions again to
              get a fresh one.
            </>
          )}
        </span>
      </ReceiptShell>
    );
  }

  // Filename only: every recorded spec lives in e2e-tests/, and in a narrow
  // chat panel the directory eats the truncation.
  const fileName = specPath ? (specPath.split("/").pop() ?? specPath) : "";
  const checkCount = countAssertions(payload.items);
  const checkCountLabel = checkCount === 1 ? "1 check" : `${checkCount} checks`;

  if (status === "approved") {
    return (
      <ReceiptShell>
        <span className="text-sm text-foreground">Recorded test</span>
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
          title={specPath || payload.testTitle}
        >
          {fileName || payload.testTitle}
        </span>
        <span
          className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
          data-testid="dyad-test-assertions-approved-badge"
        >
          <Check size={12} strokeWidth={2.5} />
          Generated with {checkCountLabel}
        </span>
        <button
          type="button"
          onClick={openSpecFile}
          disabled={!specPath}
          data-testid="dyad-test-assertions-open-file-button"
          className="shrink-0 rounded-md px-2 py-0.5 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-(--background-darker) focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default disabled:opacity-50"
        >
          Open test file
        </button>
      </ReceiptShell>
    );
  }

  if (status === "discarded") {
    return (
      <ReceiptShell>
        <span className="text-sm text-foreground">Recorded test</span>
        <span
          className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
          title={payload.testTitle}
        >
          {payload.testTitle}
        </span>
        <span
          className="shrink-0 text-xs text-muted-foreground"
          data-testid="dyad-test-assertions-discarded-note"
        >
          Closed without generating a test.
        </span>
      </ReceiptShell>
    );
  }

  // Still up for review: the composer owns it, and duplicating the plan here
  // would put two approve buttons on screen. The message keeps a pointer so it
  // still reads as a step the agent took.
  return (
    <ReceiptShell>
      <span className="text-sm text-foreground">Review recorded test</span>
      <span
        className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
        title={payload.testTitle}
      >
        {payload.testTitle}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {checkCountLabel} · waiting for your review
      </span>
    </ReceiptShell>
  );
};

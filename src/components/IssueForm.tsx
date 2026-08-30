import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePostHog } from "posthog-js/react";
import { promptSourceForKind } from "./BugScreenshotDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Camera, ChevronLeftIcon } from "lucide-react";
import {
  applyFieldEdit,
  applyTitleEdit,
  type ReportFields,
} from "@/lib/issueBody";

/** Which report the form is collecting, which decides the fields it shows. */
export type ReportKind = "bug" | "session";

/**
 * Which budget refused the last edit. Tracked per budget rather than as one
 * flag, so typing in the title cannot clear a message about the description.
 */
export interface CapState {
  prose: boolean;
  title: boolean;
}

export const NO_CAP_HIT: CapState = { prose: false, title: false };

/**
 * Fields the reporter has to fill before the report can go anywhere, matching
 * the "(required)" markers the generated body has always carried.
 *
 * Half of the issues filed today have no description at all and 5% still carry
 * the unfilled title placeholder, so those two are the point. Expected/actual
 * are gated as well because reporters who write a description almost always
 * fill them too -- blank in 2% and 7% of such reports respectively, with 93%
 * filling both -- so requiring them turns away nobody who was going to write a
 * real report. They are short (median around 25 characters), and that is fine.
 */
type RequiredField = "title" | "description" | "expected" | "actual";

const REQUIRED_BY_KIND: Record<ReportKind, RequiredField[]> = {
  bug: ["title", "description"],
  session: ["title", "description", "expected", "actual"],
};

const BLOCKED_MESSAGE: Record<RequiredField, string> = {
  title: "Please add a title so the issue can be found later.",
  description:
    "Please describe the issue. Reports without one usually can't be acted on.",
  expected: "Please say what you expected to happen.",
  actual: "Please say what actually happened.",
};

interface IssueFormProps {
  kind: ReportKind;
  fields: ReportFields;
  onChange: (fields: ReportFields) => void;
  atCap: CapState;
  onAtCapChange: (atCap: CapState) => void;
  onBack: () => void;
  onContinue: () => void;
  /** Collapsible preview of the diagnostics that will be attached. */
  diagnostics: ReactNode;
}

/**
 * The prose fields share one budget rather than getting one each: in real
 * issues the length is concentrated in whichever field the reporter chose to
 * use, so per-field caps would reserve room nobody spends.
 */
export function IssueForm({
  kind,
  fields,
  onChange,
  atCap,
  onAtCapChange,
  onBack,
  onContinue,
  diagnostics,
}: IssueFormProps) {
  const posthog = usePostHog();
  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const expectedRef = useRef<HTMLTextAreaElement>(null);
  const actualRef = useRef<HTMLTextAreaElement>(null);
  const [blocked, setBlocked] = useState<{
    field: RequiredField;
    attempt: number;
  } | null>(null);

  const valueOf = (field: RequiredField) =>
    field === "title" ? fields.title : (fields[field] ?? "");

  // Derived, so the message clears the moment the reporter types rather than
  // waiting for another attempt.
  const missing =
    REQUIRED_BY_KIND[kind].find((field) => !valueOf(field).trim()) ?? null;
  const showBlocked = blocked !== null && blocked.field === missing;
  const blockedOn = (field: RequiredField) =>
    showBlocked && blocked?.field === field;

  const refs = {
    title: titleRef,
    description: descriptionRef,
    expected: expectedRef,
    actual: actualRef,
  };

  // Focus after the render that sets aria-invalid and mounts the alert, so a
  // screen reader reaches the field already carrying its error. Keyed on the
  // attempt count so a second click on the same empty field focuses again.
  useEffect(() => {
    if (!blocked) return;
    refs[blocked.field].current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocked]);

  const handleContinue = () => {
    if (missing) {
      // Focused rather than announced from a disabled button: the reporter
      // lands in the field they have to fill.
      setBlocked((previous) => ({
        field: missing,
        attempt: (previous?.attempt ?? 0) + 1,
      }));
      posthog.capture("issue-form:blocked", {
        source: promptSourceForKind(kind),
        field: missing,
      });
      return;
    }
    setBlocked(null);
    onContinue();
  };

  const errorId = (field: RequiredField) => `issue-${field}-error`;

  const blockedMessage = (field: RequiredField) =>
    blockedOn(field) && (
      <p id={errorId(field)} className="text-xs text-destructive" role="alert">
        {BLOCKED_MESSAGE[field]}
      </p>
    );

  /** Points the field at its own error text while that error is showing. */
  const describedBy = (field: RequiredField) =>
    blockedOn(field) ? errorId(field) : undefined;

  const editField = (
    key: "description" | "expected" | "actual",
    value: string,
  ) => {
    const result = applyFieldEdit(fields, key, value, kind);
    onChange(result.fields);
    onAtCapChange({ ...atCap, prose: result.hitCap });
  };

  const editTitle = (value: string) => {
    const result = applyTitleEdit(fields, value);
    onChange(result.fields);
    onAtCapChange({ ...atCap, title: result.hitCap });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="issue-title">Title (required)</Label>
        <Input
          id="issue-title"
          ref={titleRef}
          aria-invalid={blockedOn("title")}
          aria-describedby={describedBy("title")}
          value={fields.title}
          onChange={(e) => editTitle(e.target.value)}
          placeholder={
            kind === "bug"
              ? "Short summary of the bug"
              : "Short summary of the issue"
          }
        />
        {blockedMessage("title")}
        {atCap.title && (
          <p
            className="text-xs text-amber-600 dark:text-amber-400"
            role="status"
          >
            Title limit reached.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="issue-description">
          {kind === "bug" ? "What went wrong?" : "What is the issue?"}{" "}
          (required)
        </Label>
        <Textarea
          id="issue-description"
          ref={descriptionRef}
          aria-invalid={blockedOn("description")}
          aria-describedby={describedBy("description")}
          value={fields.description}
          onChange={(e) => editField("description", e.target.value)}
          rows={kind === "bug" ? 6 : 4}
          placeholder={
            kind === "bug"
              ? "Describe the problem and how to reproduce it."
              : "Describe the problem with the AI response."
          }
        />
        {blockedMessage("description")}
      </div>

      {kind === "session" && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="issue-expected">Expected behavior (required)</Label>
            <Textarea
              id="issue-expected"
              ref={expectedRef}
              aria-invalid={blockedOn("expected")}
              aria-describedby={describedBy("expected")}
              value={fields.expected ?? ""}
              onChange={(e) => editField("expected", e.target.value)}
              rows={2}
              placeholder="What did you expect to happen?"
            />
            {blockedMessage("expected")}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="issue-actual">Actual behavior (required)</Label>
            <Textarea
              id="issue-actual"
              ref={actualRef}
              aria-invalid={blockedOn("actual")}
              aria-describedby={describedBy("actual")}
              value={fields.actual ?? ""}
              onChange={(e) => editField("actual", e.target.value)}
              rows={2}
              placeholder="What actually happened?"
            />
            {blockedMessage("actual")}
          </div>
        </>
      )}

      {atCap.prose && (
        <p
          className="text-xs text-amber-600 dark:text-amber-400"
          role="status"
          data-testid="issue-form-at-cap"
        >
          Character limit reached. You can finish writing your description on
          GitHub in the next step.
        </p>
      )}

      {diagnostics}

      <div className="flex justify-between pt-1">
        <Button
          variant="outline"
          onClick={onBack}
          className="flex items-center"
        >
          <ChevronLeftIcon className="mr-2 h-4 w-4" /> Back
        </Button>
        {/* Names the next step: nothing is filed until the reporter reaches
            GitHub, so this must not read as "create issue". */}
        <Button onClick={handleContinue} className="flex items-center">
          <Camera className="mr-2 h-4 w-4" /> Next: add a screenshot
        </Button>
      </div>
    </div>
  );
}

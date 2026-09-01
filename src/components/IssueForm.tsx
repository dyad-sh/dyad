import { useEffect, useRef, useState, type ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Github } from "lucide-react";
import {
  MIN_DESCRIPTION_LENGTH,
  applyDescriptionEdit,
  describesSomething,
} from "@/lib/issueBody";

interface IssueFormProps {
  description: string;
  onDescriptionChange: (description: string) => void;
  /** Whether the last edit was clipped by the size budget. */
  atCap: boolean;
  onAtCapChange: (atCap: boolean) => void;
  /** The screenshot control, rendered above the disclosures. */
  screenshot: ReactNode;
  /** The system-information and chat-session disclosures. */
  disclosures: ReactNode;
  onSubmit: () => void;
}

export function IssueForm({
  description,
  onDescriptionChange,
  atCap,
  onAtCapChange,
  screenshot,
  disclosures,
  onSubmit,
}: IssueFormProps) {
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const [blocked, setBlocked] = useState<{ attempt: number } | null>(null);

  const missing = !describesSomething(description);
  const showBlocked = blocked !== null && missing;

  // Focus after the render that sets aria-invalid and mounts the alert, so a
  // screen reader reaches the field already carrying its error. Keyed on the
  // attempt count so a second click focuses again.
  useEffect(() => {
    if (blocked) descriptionRef.current?.focus();
  }, [blocked]);

  const handleSubmit = () => {
    if (missing) {
      setBlocked((previous) => ({ attempt: (previous?.attempt ?? 0) + 1 }));
      return;
    }
    setBlocked(null);
    onSubmit();
  };

  const edit = (value: string) => {
    const result = applyDescriptionEdit(description, value);
    onDescriptionChange(result.value);
    onAtCapChange(result.hitCap);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="issue-description">What happened?</Label>
        <Textarea
          id="issue-description"
          ref={descriptionRef}
          aria-invalid={showBlocked}
          aria-describedby={showBlocked ? "issue-description-error" : undefined}
          value={description}
          onChange={(e) => edit(e.target.value)}
          rows={3}
          placeholder="Describe the problem and how to reproduce it. The more detail, the faster we can help."
        />
        {showBlocked && (
          <p
            id="issue-description-error"
            className="text-xs text-destructive"
            role="alert"
          >
            Please describe what happened &mdash; one sentence is enough.
          </p>
        )}
        {atCap && (
          <p
            className="text-xs text-amber-600 dark:text-amber-400"
            role="status"
          >
            Character limit reached. You can finish writing your description on
            GitHub in the next step.
          </p>
        )}
      </div>

      {screenshot}
      {disclosures}

      <Button
        onClick={handleSubmit}
        className="w-full py-5 text-base"
        size="lg"
      >
        <Github className="mr-2 h-5 w-5" />
        Create GitHub issue
      </Button>
    </div>
  );
}

export { MIN_DESCRIPTION_LENGTH };

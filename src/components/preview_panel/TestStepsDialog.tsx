import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import {
  AlertTriangle,
  ArrowRight,
  CircleCheck,
  Clock,
  Code2,
  Loader2,
  MousePointerClick,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { previewModeAtom } from "@/atoms/appAtoms";
import { isPreviewOpenAtom, selectedFileAtom } from "@/atoms/viewAtoms";
import { ipc } from "@/ipc/types";
import type { DescribedTest, TestStep } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";

/** Which test the dialog is describing. Null closes it. */
export interface TestStepsTarget {
  /** App-relative spec path, e.g. "e2e-tests/signup.spec.ts". */
  file: string;
  /** 1-based line of the `test(` call. */
  line: number;
  title: string;
}

interface TestStepsDialogProps {
  appId: number | null;
  target: TestStepsTarget | null;
  onOpenChange: (open: boolean) => void;
}

function StepIcon({ kind }: { kind: TestStep["kind"] }) {
  switch (kind) {
    case "navigation":
      return <ArrowRight size={13} className="mt-0.5 shrink-0 text-blue-500" />;
    case "assertion":
      return (
        <CircleCheck size={13} className="mt-0.5 shrink-0 text-green-600" />
      );
    case "wait":
      return <Clock size={13} className="mt-0.5 shrink-0 text-amber-500" />;
    case "raw":
      return (
        <Code2 size={13} className="mt-0.5 shrink-0 text-muted-foreground" />
      );
    case "action":
    default:
      return (
        <MousePointerClick
          size={13}
          className="mt-0.5 shrink-0 text-teal-500"
        />
      );
  }
}

function StepRow({ step, index }: { step: TestStep; index: number | null }) {
  // Groups (a `test.step(...)` title, or the "Before each test" block) are
  // headings for the steps beneath them, so they get no number and no icon.
  if (step.kind === "group") {
    return (
      <li
        className="pt-2 first:pt-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        style={{ paddingLeft: step.depth * 16 }}
      >
        {step.text}
      </li>
    );
  }

  return (
    <li
      className="flex items-start gap-2 py-0.5"
      style={{ paddingLeft: step.depth * 16 }}
    >
      <span className="w-6 shrink-0 pt-px text-right text-[11px] tabular-nums text-muted-foreground">
        {index === null ? "" : `${index}.`}
      </span>
      <StepIcon kind={step.kind} />
      <span
        className={cn(
          "min-w-0 flex-1 break-words",
          step.kind === "raw"
            ? "rounded-sm bg-(--background-darkest) px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
            : "text-[13px] text-foreground",
        )}
      >
        {step.text}
      </span>
    </li>
  );
}

function StepList({ test }: { test: DescribedTest }) {
  // Only real steps are numbered; group headings are structure, not actions.
  let stepNumber = 0;
  return (
    <ol className="space-y-0.5">
      {test.steps.map((step, i) => (
        <StepRow
          key={`${step.line}:${i}`}
          step={step}
          index={step.kind === "group" ? null : ++stepNumber}
        />
      ))}
    </ol>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
      <span className="flex-1">{children}</span>
    </div>
  );
}

/**
 * Shows what a single Playwright test does, in plain English. The sentences are
 * produced by a deterministic AST pass in the main process
 * (`src/ipc/utils/describe_test_steps.ts`) — never by a model — so the same test
 * always reads the same way.
 */
export function TestStepsDialog({
  appId,
  target,
  onOpenChange,
}: TestStepsDialogProps) {
  const setSelectedFile = useSetAtom(selectedFileAtom);
  const setPreviewMode = useSetAtom(previewModeAtom);
  const setIsPreviewOpen = useSetAtom(isPreviewOpenAtom);

  const file = target?.file ?? "";
  const stepsQuery = useQuery({
    queryKey: queryKeys.tests.steps({ appId, file }),
    queryFn: async () => {
      if (appId == null) return { tests: [] };
      return ipc.tests.describeAppTests({ appId, testFile: file });
    },
    enabled: target !== null && appId != null,
  });

  // Match on line first (what the panel listed), then fall back to the title —
  // the spec may have been edited since the test list was cached.
  const described =
    target && stepsQuery.data
      ? (stepsQuery.data.tests.find((t) => t.line === target.line) ??
        stepsQuery.data.tests.find((t) => t.title === target.title))
      : undefined;

  const viewCode = () => {
    if (!target) return;
    setSelectedFile({ path: target.file, line: target.line });
    setPreviewMode("code");
    setIsPreviewOpen(true);
    onOpenChange(false);
  };

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-4" data-testid="test-steps-dialog">
        <DialogHeader className="pb-2">
          <DialogTitle className="pr-6 text-base">
            {target?.title ?? "Test steps"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            What this test does, step by step — read straight from{" "}
            <code>{target?.file}</code>.
          </DialogDescription>
        </DialogHeader>

        <div
          className="max-h-96 overflow-y-auto scrollbar-on-hover rounded-md border border-border bg-(--background-lighter) p-2"
          data-testid="test-steps-list"
        >
          {stepsQuery.isLoading ? (
            <div className="flex items-center gap-2 px-1 py-3 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin" />
              Reading the test…
            </div>
          ) : stepsQuery.isError ? (
            <div className="space-y-2 px-1 py-2">
              <p className="text-sm text-muted-foreground">
                Couldn&apos;t read this test.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void stepsQuery.refetch()}
              >
                Retry
              </Button>
            </div>
          ) : stepsQuery.data?.parseError ? (
            <Notice>
              This test file couldn&apos;t be parsed, so its steps can&apos;t be
              listed. Open the code to read it directly.
            </Notice>
          ) : !described ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">
              This test is no longer in {target?.file}. It may have been renamed
              or removed since the list was loaded.
            </p>
          ) : described.steps.length === 0 ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">
              This test doesn&apos;t perform any steps we can describe.
            </p>
          ) : (
            <StepList test={described} />
          )}
        </div>

        {described?.truncated && (
          <p className="px-1 text-[11px] text-muted-foreground">
            This test is unusually long — only its first steps are shown.
          </p>
        )}

        <DialogFooter className="pt-2 sm:justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={viewCode}
            data-testid="test-steps-view-code"
          >
            View code
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

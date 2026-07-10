import React from "react";
import { useSetAtom } from "jotai";
import { FileCode2 } from "lucide-react";

import { previewModeAtom } from "@/atoms/appAtoms";
import { selectedFileAtom } from "@/atoms/viewAtoms";
import type {
  ExploreConfidence,
  ExplorerOutputData,
} from "@/shared/subagent_types";

const CONFIDENCE_CLASSES: Record<ExploreConfidence, string> = {
  high: "bg-green-100 dark:bg-green-950/60 text-green-700 dark:text-green-300",
  medium:
    "bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300",
  low: "bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300",
};

const ACTION_LABELS: Record<string, string> = {
  answer_from_report: "Answered from report",
  read_targets: "Read targets",
  targeted_gap_search: "Targeted gap search",
  skip_explore_result: "Nothing relevant found",
};

/** Jump-to-code link for a `path` + optional "12-48" style range. */
function FileRangeLink({
  path,
  range,
}: {
  path: string;
  range: string | null;
}) {
  const setSelectedFile = useSetAtom(selectedFileAtom);
  const setPreviewMode = useSetAtom(previewModeAtom);
  const line = range ? Number.parseInt(range.split("-")[0], 10) : null;
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 font-mono text-[11px] text-primary hover:underline cursor-pointer max-w-full"
      onClick={() => {
        setSelectedFile({ path, line: Number.isFinite(line) ? line : null });
        setPreviewMode("code");
      }}
      title={`Open ${path}${range ? `:${range}` : ""}`}
    >
      <FileCode2 size={12} className="shrink-0" />
      <span className="truncate">
        {path}
        {range ? `:${range}` : ""}
      </span>
    </button>
  );
}

/** Rich rendering of a code-explorer run's structured report. */
export function ExplorerOutput({ data }: { data: ExplorerOutputData }) {
  return (
    <div className="flex flex-col gap-3 text-xs" data-testid="explorer-output">
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-semibold ${CONFIDENCE_CLASSES[data.confidence]}`}
        >
          {data.confidence} confidence
        </span>
        <span className="text-muted-foreground">
          {ACTION_LABELS[data.action] ?? data.action}
        </span>
      </div>

      {data.flow.length > 0 && (
        <section>
          <h4 className="font-semibold text-muted-foreground uppercase tracking-wide text-[10px] mb-1.5">
            Flow
          </h4>
          <ol className="flex flex-col gap-2">
            {data.flow.map((entry, index) => (
              <li key={index} className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-muted-foreground shrink-0">
                    {index + 1}.
                  </span>
                  <FileRangeLink path={entry.path} range={entry.range} />
                  <span className="text-muted-foreground shrink-0">
                    ({entry.role})
                  </span>
                </div>
                <p className="text-foreground/90 pl-4">{entry.fact}</p>
                {entry.quote && (
                  <pre className="pl-4 text-[11px] text-muted-foreground font-mono whitespace-pre-wrap break-all">
                    {entry.quote}
                  </pre>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {data.readTargets.length > 0 && (
        <section>
          <h4 className="font-semibold text-muted-foreground uppercase tracking-wide text-[10px] mb-1.5">
            Read targets
          </h4>
          <ul className="flex flex-col gap-1">
            {data.readTargets.map((target, index) => (
              <li key={index} className="flex items-center gap-1.5 min-w-0">
                <FileRangeLink path={target.path} range={target.range} />
                <span className="text-muted-foreground truncate">
                  — {target.purpose}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.missing.length > 0 && (
        <section>
          <h4 className="font-semibold text-muted-foreground uppercase tracking-wide text-[10px] mb-1">
            Missing
          </h4>
          <ul className="list-disc pl-4 text-muted-foreground">
            {data.missing.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </section>
      )}

      {data.searchTargets.length > 0 && (
        <section>
          <h4 className="font-semibold text-muted-foreground uppercase tracking-wide text-[10px] mb-1">
            Search targets
          </h4>
          <ul className="flex flex-col gap-0.5 font-mono text-[11px] text-muted-foreground">
            {data.searchTargets.map((target, index) => (
              <li key={index} className="break-all">
                {target}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

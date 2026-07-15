import { useMemo, useState, type ReactNode } from "react";
import {
  CheckCircle2,
  ChevronRight,
  CircleX,
  FileClock,
  FileDiff,
  GitBranch,
  GitCommitHorizontal,
  History,
  LoaderCircle,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { CodeHighlight } from "./CodeHighlight";
import type { CustomTagState } from "./stateTypes";

interface DyadGitProperties {
  operation?: string;
  revision?: string;
  path?: string;
  scope?: string;
  state?: CustomTagState;
  branch?: string;
  detached?: string;
  staged_count?: string;
  unstaged_count?: string;
  untracked_count?: string;
  conflicted_count?: string;
  changed_count?: string;
  file_count?: string;
  additions?: string;
  deletions?: string;
  result_count?: string;
  line_count?: string;
  subject?: string;
  truncated?: string;
  not_staged?: string;
  detail_format?: "status" | "diff" | "log" | "commit" | "file";
}

interface DyadGitProps {
  children?: ReactNode;
  node?: { properties?: DyadGitProperties };
}

interface GitStatusDetails {
  branch: string | null;
  detached: boolean;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  conflicted: string[];
}

const OPERATION_ICONS: Record<string, LucideIcon> = {
  status: GitBranch,
  diff: FileDiff,
  log: History,
  show_commit: GitCommitHorizontal,
  show_file: FileClock,
  restore_file: RotateCcw,
};

function readCount(value: string | undefined): number {
  const count = Number(value);
  return Number.isFinite(count) ? count : 0;
}

function shortRevision(revision: string): string {
  return revision.length > 10 ? revision.slice(0, 8) : revision;
}

function parseStatusDetails(content: string): GitStatusDetails | null {
  try {
    const value = JSON.parse(content) as Partial<GitStatusDetails>;
    const isStringArray = (items: unknown): items is string[] =>
      Array.isArray(items) && items.every((item) => typeof item === "string");
    if (
      isStringArray(value.staged) &&
      isStringArray(value.unstaged) &&
      isStringArray(value.untracked) &&
      isStringArray(value.conflicted)
    ) {
      return {
        branch: typeof value.branch === "string" ? value.branch : null,
        detached: value.detached === true,
        staged: value.staged,
        unstaged: value.unstaged,
        untracked: value.untracked,
        conflicted: value.conflicted,
      };
    }
  } catch {
    // Older transcripts may contain non-JSON detail. Keep the row usable.
  }
  return null;
}

function detailLanguage(path: string, format: string | undefined): string {
  if (format !== "file") return "language-markdown";
  const extension = path.split(".").pop()?.toLowerCase();
  const languages: Record<string, string> = {
    astro: "astro",
    css: "css",
    graphql: "graphql",
    html: "html",
    java: "java",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    less: "less",
    md: "markdown",
    py: "python",
    sass: "sass",
    scss: "scss",
    sh: "shell",
    sql: "sql",
    ts: "typescript",
    tsx: "tsx",
    vue: "vue",
  };
  return `language-${languages[extension ?? ""] ?? "markdown"}`;
}

export const DyadGit = ({ children, node }: DyadGitProps) => {
  const { t } = useTranslation("chat");
  const [isExpanded, setIsExpanded] = useState(false);
  const properties = node?.properties ?? {};
  const operation = properties.operation || "status";
  const revision = properties.revision || "HEAD";
  const path = properties.path || "";
  const state = properties.state ?? "finished";
  const detailText = typeof children === "string" ? children.trim() : "";
  const statusDetails = useMemo(
    () =>
      properties.detail_format === "status" && detailText
        ? parseStatusDetails(detailText)
        : null,
    [detailText, properties.detail_format],
  );
  const hasDetails = Boolean(
    detailText && (statusDetails || operation !== "status"),
  );
  const isRestore = operation === "restore_file";
  const Icon = OPERATION_ICONS[operation] ?? GitBranch;

  const action = (() => {
    const pending = state === "pending";
    switch (operation) {
      case "status":
        return t(pending ? "git.checkingChanges" : "git.checkedChanges");
      case "diff":
        return path
          ? t(pending ? "git.reviewingChangesIn" : "git.reviewedChangesIn", {
              path,
            })
          : t(pending ? "git.reviewingChanges" : "git.reviewedChanges");
      case "log":
        return path
          ? t(pending ? "git.reviewingVersionsOf" : "git.reviewedVersionsOf", {
              path,
            })
          : t(pending ? "git.reviewingVersions" : "git.reviewedVersions");
      case "show_commit":
        return t(pending ? "git.inspectingVersion" : "git.inspectedVersion", {
          revision: shortRevision(revision),
        });
      case "show_file":
        return t(pending ? "git.readingFile" : "git.readFile", { path });
      case "restore_file":
        return t(pending ? "git.restoringFile" : "git.restoredFile", { path });
      default:
        return t(pending ? "git.working" : "git.completedWork");
    }
  })();

  const summary = (() => {
    if (state === "aborted") return t("git.didNotFinish");
    if (state === "error") return t("git.failed");
    if (state === "pending") return "";

    const parts: string[] = [];
    if (operation === "status") {
      const changed = readCount(properties.changed_count);
      const untracked = readCount(properties.untracked_count);
      const conflicted = readCount(properties.conflicted_count);
      if (changed === 0 && untracked === 0 && conflicted === 0) {
        parts.push(t("git.noChanges"));
      } else {
        if (changed > 0) parts.push(t("git.changed", { count: changed }));
        if (untracked > 0) parts.push(t("git.newFiles", { count: untracked }));
        if (conflicted > 0)
          parts.push(t("git.conflicts", { count: conflicted }));
      }
    } else if (operation === "diff" || operation === "show_commit") {
      if (operation === "show_commit" && properties.subject) {
        parts.push(properties.subject);
      } else {
        const files = readCount(properties.file_count);
        if (files === 0) parts.push(t("git.noChanges"));
        else parts.push(t("git.files", { count: files }));
      }
      const additions = readCount(properties.additions);
      const deletions = readCount(properties.deletions);
      if (additions > 0) parts.push(`+${additions}`);
      if (deletions > 0) parts.push(`−${deletions}`);
    } else if (operation === "log") {
      parts.push(
        t("git.versions", { count: readCount(properties.result_count) }),
      );
    } else if (operation === "show_file") {
      parts.push(t("git.lines", { count: readCount(properties.line_count) }));
      parts.push(t("git.fromRevision", { revision: shortRevision(revision) }));
    } else if (operation === "restore_file") {
      parts.push(t("git.fromRevision", { revision: shortRevision(revision) }));
      if (properties.not_staged === "true") parts.push(t("git.notStaged"));
    }
    if (properties.truncated === "true") parts.push(t("git.partialResult"));
    return parts.join(" · ");
  })();

  const row = (
    <>
      <span
        className={`flex size-5 shrink-0 items-center justify-center ${
          isRestore
            ? "text-amber-700 dark:text-amber-400"
            : "text-muted-foreground"
        }`}
      >
        <Icon size={15} strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
        {action}
      </span>
      {summary && (
        <span
          className={`max-w-[45%] shrink truncate text-xs ${
            state === "aborted" || state === "error"
              ? "text-red-600 dark:text-red-400"
              : "text-muted-foreground"
          }`}
          title={summary}
        >
          {summary}
        </span>
      )}
      {state === "pending" && (
        <LoaderCircle
          size={14}
          className="shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
          aria-label={t("git.inProgress")}
        />
      )}
      {(state === "aborted" || state === "error") && (
        <CircleX size={14} className="shrink-0 text-red-500" />
      )}
      {isRestore && state === "finished" && (
        <CheckCircle2
          size={14}
          className="shrink-0 text-green-600 dark:text-green-500"
        />
      )}
      {hasDetails && (
        <ChevronRight
          size={15}
          className={`shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none ${
            isExpanded ? "rotate-90" : ""
          }`}
        />
      )}
    </>
  );

  return (
    <div
      className={`my-1 overflow-hidden rounded-lg transition-colors duration-150 motion-reduce:transition-none ${
        isRestore
          ? "bg-amber-500/7 hover:bg-amber-500/11"
          : "hover:bg-(--background-lightest)"
      }`}
      data-testid="dyad-git"
    >
      {hasDetails ? (
        <button
          type="button"
          className="flex min-h-8 w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          onClick={() => setIsExpanded((expanded) => !expanded)}
          aria-expanded={isExpanded}
          title={path || undefined}
        >
          {row}
        </button>
      ) : (
        <div
          className="flex min-h-8 w-full items-center gap-2 px-2 py-1.5"
          aria-live={state === "pending" ? "polite" : undefined}
          title={path || undefined}
        >
          {row}
        </div>
      )}

      {hasDetails && isExpanded && (
        <div className="border-t border-border/50 px-2.5 py-2">
          {statusDetails ? (
            <StatusDetails details={statusDetails} />
          ) : (
            <div onClick={(event) => event.stopPropagation()}>
              <CodeHighlight
                className={detailLanguage(path, properties.detail_format)}
              >
                {detailText}
              </CodeHighlight>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

function StatusDetails({ details }: { details: GitStatusDetails }) {
  const { t } = useTranslation("chat");
  const groups = [
    ["staged", details.staged],
    ["unstaged", details.unstaged],
    ["untracked", details.untracked],
    ["conflicted", details.conflicted],
  ] as const;

  return (
    <div className="space-y-2 text-xs">
      <div className="text-muted-foreground">
        {details.detached
          ? t("git.detachedHead")
          : t("git.branch", { branch: details.branch ?? "—" })}
      </div>
      {groups.map(([label, paths]) =>
        paths.length > 0 ? (
          <div key={label}>
            <div className="mb-0.5 font-medium text-foreground">
              {t(`git.${label}`, { count: paths.length })}
            </div>
            <div className="space-y-0.5 pl-2 font-mono text-[11px] text-muted-foreground">
              {paths.map((filePath) => (
                <div key={filePath} className="truncate" title={filePath}>
                  {filePath}
                </div>
              ))}
            </div>
          </div>
        ) : null,
      )}
    </div>
  );
}

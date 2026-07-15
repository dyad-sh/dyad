import type React from "react";
import { GitCommitVertical } from "lucide-react";
import {
  DyadBadge,
  DyadCard,
  DyadCardHeader,
  DyadFilePath,
  DyadStateIndicator,
} from "./DyadCardPrimitives";
import type { CustomTagState } from "./stateTypes";

interface DyadGitProps {
  node?: any;
}

const OPERATION_LABELS: Record<string, string> = {
  status: "Status",
  diff: "Diff",
  log: "Log",
  show_commit: "Show commit",
  show_file: "Show file",
  restore_file: "Restore file",
};

export const DyadGit: React.FC<DyadGitProps> = ({ node }) => {
  const operation = node?.properties?.operation || "git";
  const revision = node?.properties?.revision || "";
  const path = node?.properties?.path || "";
  const scope = node?.properties?.scope || "";
  const state = node?.properties?.state as CustomTagState;
  const label = OPERATION_LABELS[operation] ?? operation;

  return (
    <DyadCard accentColor="indigo" state={state}>
      <DyadCardHeader
        icon={<GitCommitVertical size={15} />}
        accentColor="indigo"
      >
        <span className="font-medium text-sm text-foreground truncate">
          Git
        </span>
        <DyadBadge color="indigo">{label}</DyadBadge>
        {scope && <DyadBadge color="slate">{scope}</DyadBadge>}
        <span className="ml-auto">
          {state === "pending" && (
            <DyadStateIndicator state="pending" pendingLabel="Inspecting..." />
          )}
          {state === "aborted" && (
            <DyadStateIndicator state="aborted" abortedLabel="Did not finish" />
          )}
          {state === "finished" && (
            <DyadStateIndicator state="finished" finishedLabel="Done" />
          )}
        </span>
      </DyadCardHeader>
      {revision && <DyadFilePath path={`Revision: ${revision}`} />}
      {path && <DyadFilePath path={path} />}
    </DyadCard>
  );
};

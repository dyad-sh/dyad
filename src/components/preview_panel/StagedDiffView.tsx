import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { stagedDiffFileAtom } from "@/atoms/viewAtoms";
import { useUncommittedFiles } from "@/hooks/useUncommittedFiles";
import { useUncommittedFileDiff } from "@/hooks/useUncommittedFileDiff";
import {
  getStatusIcon,
  LineStats,
} from "@/components/chat/uncommittedFileStatus";
import { FileDiffEditor } from "./FileDiffEditor";

interface StagedDiffViewProps {
  appId: number;
}

/**
 * Shows the staged (uncommitted) files on the left and a read-only side-by-side
 * Monaco diff of the selected file (HEAD vs working tree) on the right.
 */
export function StagedDiffView({ appId }: StagedDiffViewProps) {
  const { t } = useTranslation("home");
  const { uncommittedFiles, isLoading } = useUncommittedFiles(appId);
  const [selectedPath, setSelectedPath] = useAtom(stagedDiffFileAtom);

  // Derive the displayed file from the user's selection, falling back to the
  // first staged file so a valid selection shows even if the clicked file was
  // just committed away.
  const selected =
    uncommittedFiles.find((f) => f.path === selectedPath) ??
    uncommittedFiles[0] ??
    null;

  const { diff, loading: diffLoading } = useUncommittedFileDiff(
    appId,
    selected?.path ?? null,
  );

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-gray-500">
        {t("preview.loadingChanges")}
      </div>
    );
  }

  if (uncommittedFiles.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-gray-500">
        {t("preview.noStagedChanges")}
      </div>
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden" data-testid="staged-diff-view">
      <div className="w-1/3 border-r overflow-auto min-h-0">
        {uncommittedFiles.map((file) => (
          <button
            key={file.path}
            onClick={() => setSelectedPath(file.path)}
            data-testid="staged-diff-file"
            className={cn(
              "flex items-center gap-2 w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--background-darkest)]",
              selected?.path === file.path && "bg-[var(--background-darkest)]",
            )}
          >
            {getStatusIcon(file.status)}
            <span
              className={cn(
                "flex-1 truncate font-mono text-xs",
                file.status === "deleted" && "line-through opacity-60",
              )}
              title={file.path}
            >
              {file.path}
            </span>
            <LineStats file={file} />
          </button>
        ))}
      </div>
      <div className="w-2/3 min-h-0">
        {selected && diff && !diffLoading ? (
          <FileDiffEditor
            key={`${appId}:${selected.path}`}
            filePath={selected.path}
            oldContent={diff.oldContent}
            newContent={diff.newContent}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-gray-500">
            {t("preview.loadingChanges")}
          </div>
        )}
      </div>
    </div>
  );
}

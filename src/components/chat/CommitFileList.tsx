import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { UncommittedFile } from "@/hooks/useUncommittedFiles";
import {
  getStatusIcon,
  getStatusLabel,
  getStatusBadgeClassName,
  LineStats,
} from "@/components/chat/uncommittedFileStatus";

interface CommitFileListProps {
  files: UncommittedFile[];
  /** Opens the file's working-tree diff. Closes the dialog it was clicked in. */
  onSelectFile: (path: string) => void;
  /**
   * Blocks navigation while a commit or discard is in flight. Opening a diff
   * closes the dialog directly, so without this it would slip past the dialog's
   * own "don't close while busy" guard.
   */
  disabled?: boolean;
  testId: string;
}

/**
 * The scrollable list of uncommitted files inside a commit dialog. Each row is
 * a button that opens that file's diff; the row's accessible name is the file
 * path itself, so this needs no translated string of its own.
 */
export function CommitFileList({
  files,
  onSelectFile,
  disabled = false,
  testId,
}: CommitFileListProps) {
  return (
    <TooltipProvider delay={300}>
      <div
        className="max-h-60 overflow-y-auto rounded-md border p-2 space-y-1"
        data-testid={testId}
      >
        {files.map((file) => (
          <Tooltip key={file.path}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={() => onSelectFile(file.path)}
                  disabled={disabled}
                  data-testid="commit-file-item"
                  className="flex w-full items-center gap-2 text-sm py-1 px-2 rounded text-left cursor-pointer hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent"
                />
              }
            >
              {getStatusIcon(file.status)}
              <span
                className={cn(
                  "flex-1 truncate font-mono text-xs",
                  file.status === "deleted" && "line-through opacity-60",
                )}
              >
                {file.path}
              </span>
              <LineStats file={file} />
              <span className={getStatusBadgeClassName(file.status)}>
                {getStatusLabel(file.status)}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" align="start">
              <p className="max-w-[400px] break-all">{file.path}</p>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}

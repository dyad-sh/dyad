import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FileTypeIcon } from "./FileTypeIcon";

interface CodeEditorTabsProps {
  activePath: string | null;
  paths: string[];
  onClose: (path: string) => void;
  onSelect: (path: string) => void;
}

const getFileName = (path: string) => path.split("/").pop() ?? path;

export function CodeEditorTabs({
  activePath,
  paths,
  onClose,
  onSelect,
}: CodeEditorTabsProps) {
  if (paths.length === 0) return null;

  return (
    <div
      className="scrollbar-on-hover flex min-h-9 overflow-x-auto border-b bg-muted/25"
      role="tablist"
      aria-label="Open files"
      data-testid="code-editor-tabs"
    >
      {paths.map((path) => {
        const isActive = path === activePath;
        return (
          <div
            key={path}
            role="presentation"
            title={path}
            className={cn(
              "group relative flex h-9 max-w-56 shrink-0 cursor-default items-center gap-1.5 border-r px-2.5 text-xs text-muted-foreground",
              isActive
                ? "bg-background text-foreground"
                : "hover:bg-muted/60 hover:text-foreground",
            )}
            onAuxClick={(event) => {
              if (event.button === 1) onClose(path);
            }}
            data-testid={`code-editor-tab-${path}`}
          >
            {isActive && (
              <span className="absolute inset-x-0 top-0 h-0.5 bg-primary" />
            )}
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              onClick={() => onSelect(path)}
            >
              <FileTypeIcon path={path} className="size-3.5" />
              <span className="truncate">{getFileName(path)}</span>
            </button>
            <button
              type="button"
              aria-label={`Close ${getFileName(path)}`}
              className={cn(
                "ml-0.5 rounded-sm p-0.5 hover:bg-muted",
                isActive
                  ? "opacity-70 hover:opacity-100"
                  : "opacity-0 group-hover:opacity-70 group-focus-within:opacity-70",
              )}
              onClick={(event) => {
                event.stopPropagation();
                onClose(path);
              }}
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

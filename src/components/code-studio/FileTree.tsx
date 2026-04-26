/**
 * File Tree Component for Code Studio
 */

import { useState } from "react";
import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from "lucide-react";
import { codeStudioClient, type FsEntry } from "@/ipc/code_studio_client";
import { useDirListing } from "@/hooks/useCodeStudio";
import { cn } from "@/lib/utils";

interface FileTreeProps {
  selected: string | null;
  onSelect: (relPath: string) => void;
}

export function FileTree({ selected, onSelect }: FileTreeProps) {
  return (
    <div className="text-xs font-mono select-none p-1">
      <FileTreeNode relPath="" depth={0} expandedByDefault selected={selected} onSelect={onSelect} />
    </div>
  );
}

interface NodeProps {
  relPath: string;
  depth: number;
  expandedByDefault?: boolean;
  selected: string | null;
  onSelect: (relPath: string) => void;
}

function FileTreeNode({ relPath, depth, expandedByDefault, selected, onSelect }: NodeProps) {
  const [expanded, setExpanded] = useState(!!expandedByDefault);
  const { data: entries, isLoading } = useDirListing(relPath, expanded);

  return (
    <div>
      {entries?.map((entry) => (
        <FileTreeRow
          key={entry.path}
          entry={entry}
          depth={depth}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
      {isLoading && expanded && (
        <div style={{ paddingLeft: depth * 12 + 16 }} className="text-muted-foreground py-0.5">
          loading…
        </div>
      )}
    </div>
  );
}

interface RowProps {
  entry: FsEntry;
  depth: number;
  selected: string | null;
  onSelect: (relPath: string) => void;
}

function FileTreeRow({ entry, depth, selected, onSelect }: RowProps) {
  const [expanded, setExpanded] = useState(false);
  const isSelected = selected === entry.relPath;

  if (entry.type === "directory") {
    return (
      <div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center gap-1 hover:bg-accent/50 rounded-sm py-0.5 text-left"
          style={{ paddingLeft: depth * 12 + 4 }}
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )}
          {expanded ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-blue-500" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-blue-500" />
          )}
          <span className="truncate">{entry.name}</span>
        </button>
        {expanded && (
          <FileTreeNode
            relPath={entry.relPath}
            depth={depth + 1}
            selected={selected}
            onSelect={onSelect}
          />
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(entry.relPath)}
      className={cn(
        "w-full flex items-center gap-1 rounded-sm py-0.5 text-left",
        isSelected ? "bg-primary/15 text-primary" : "hover:bg-accent/50",
      )}
      style={{ paddingLeft: depth * 12 + 16 }}
    >
      <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{entry.name}</span>
    </button>
  );
}

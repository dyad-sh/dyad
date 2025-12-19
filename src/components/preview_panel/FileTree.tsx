import React from "react";
import { Folder, FolderOpen, Loader2, Search, X } from "lucide-react";
import { selectedFileAtom } from "@/atoms/viewAtoms";
import { useSetAtom } from "jotai";
import { Input } from "@/components/ui/input";
import type { AppFileSearchResult } from "@/ipc/ipc_types";
import { useSearchAppFiles } from "@/hooks/useSearchAppFiles";

interface FileTreeProps {
  appId: number | null;
  files: string[];
}

interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: TreeNode[];
}

const useDebouncedValue = <T,>(value: T, delay = 200) => {
  const [debouncedValue, setDebouncedValue] = React.useState(value);

  React.useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
};

const highlightMatch = (text: string, query: string) => {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return text;

  const lowerText = text.toLowerCase();
  const lowerQuery = trimmedQuery.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);

  if (index === -1) {
    return text;
  }

  const end = index + trimmedQuery.length;

  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-sm bg-primary/15 px-0.5 text-foreground">
        {text.slice(index, end)}
      </mark>
      {text.slice(end)}
    </>
  );
};

// Convert flat file list to tree structure
const buildFileTree = (files: string[]): TreeNode[] => {
  const root: TreeNode[] = [];

  files.forEach((path) => {
    const parts = path.split("/");
    let currentLevel = root;

    parts.forEach((part, index) => {
      const isLastPart = index === parts.length - 1;
      const currentPath = parts.slice(0, index + 1).join("/");

      // Check if this node already exists at the current level
      const existingNode = currentLevel.find((node) => node.name === part);

      if (existingNode) {
        // If we found the node, just drill down to its children for the next level
        currentLevel = existingNode.children;
      } else {
        // Create a new node
        const newNode: TreeNode = {
          name: part,
          path: currentPath,
          isDirectory: !isLastPart,
          children: [],
        };

        currentLevel.push(newNode);
        currentLevel = newNode.children;
      }
    });
  });

  return root;
};

// File tree component
export const FileTree = ({ appId, files }: FileTreeProps) => {
  const [searchValue, setSearchValue] = React.useState("");
  const debouncedSearch = useDebouncedValue(searchValue, 250);
  const isSearchMode = debouncedSearch.trim().length > 0;

  const {
    results: searchResults,
    loading: searchLoading,
    error: searchError,
  } = useSearchAppFiles(appId, debouncedSearch);

  const matchesByPath = React.useMemo(() => {
    const map = new Map<string, AppFileSearchResult>();
    for (const result of searchResults) {
      map.set(result.path, result);
    }
    return map;
  }, [searchResults]);

  const visibleFiles = React.useMemo(() => {
    if (!isSearchMode) {
      return files;
    }
    return files.filter((filePath) => matchesByPath.has(filePath));
  }, [files, isSearchMode, matchesByPath]);

  const treeData = React.useMemo(
    () => buildFileTree(visibleFiles),
    [visibleFiles],
  );

  return (
    <div className="file-tree mt-2 flex h-full flex-col">
      <div className="px-2 pb-2">
        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="Search files or content"
            className="h-8 pl-7 pr-16 text-sm"
            data-testid="file-tree-search"
            disabled={!appId}
          />
          {searchValue && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setSearchValue("")}
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
          {searchLoading && (
            <Loader2
              size={14}
              className="absolute right-7 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground"
            />
          )}
        </div>
        {isSearchMode && (
          <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {searchLoading
                ? "Searching files..."
                : `${matchesByPath.size} match${matchesByPath.size === 1 ? "" : "es"}`}
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {isSearchMode && searchError && (
          <div className="px-3 py-2 text-xs text-red-500">
            {searchError.message}
          </div>
        )}
        {isSearchMode && !searchLoading && matchesByPath.size === 0 ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">
            No files matched your search.
          </div>
        ) : (
          <TreeNodes
            nodes={treeData}
            level={0}
            matchesByPath={matchesByPath}
            isSearchMode={isSearchMode}
            searchQuery={debouncedSearch}
          />
        )}
      </div>
    </div>
  );
};

interface TreeNodesProps {
  nodes: TreeNode[];
  level: number;
  matchesByPath: Map<string, AppFileSearchResult>;
  isSearchMode: boolean;
  searchQuery: string;
}

// Sort nodes to show directories first
const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
  return [...nodes].sort((a, b) => {
    if (a.isDirectory === b.isDirectory) {
      return a.name.localeCompare(b.name);
    }
    return a.isDirectory ? -1 : 1;
  });
};

// Tree nodes component
const TreeNodes = ({
  nodes,
  level,
  matchesByPath,
  isSearchMode,
  searchQuery,
}: TreeNodesProps) => (
  <ul className="ml-4">
    {sortNodes(nodes).map((node) => (
      <TreeNode
        key={node.path}
        node={node}
        level={level}
        matchesByPath={matchesByPath}
        isSearchMode={isSearchMode}
        searchQuery={searchQuery}
      />
    ))}
  </ul>
);

interface TreeNodeProps {
  node: TreeNode;
  level: number;
  matchesByPath: Map<string, AppFileSearchResult>;
  isSearchMode: boolean;
  searchQuery: string;
}

// Individual tree node component
const TreeNode = ({
  node,
  level,
  matchesByPath,
  isSearchMode,
  searchQuery,
}: TreeNodeProps) => {
  const [expanded, setExpanded] = React.useState(level < 2);
  const setSelectedFile = useSetAtom(selectedFileAtom);
  const match = isSearchMode ? matchesByPath.get(node.path) : undefined;

  React.useEffect(() => {
    if (isSearchMode && node.isDirectory) {
      setExpanded(true);
    }
  }, [isSearchMode, node.isDirectory]);

  const handleClick = () => {
    if (node.isDirectory) {
      setExpanded(!expanded);
    } else {
      setSelectedFile({
        path: node.path,
      });
    }
  };

  return (
    <li className="py-0.5">
      <div
        className="flex items-center rounded px-1.5 py-0.5 text-sm hover:bg-(--sidebar)"
        onClick={handleClick}
      >
        {node.isDirectory && (
          <span className="mr-1 text-gray-500">
            {expanded ? <FolderOpen size={16} /> : <Folder size={16} />}
          </span>
        )}
        <span className="truncate">
          {isSearchMode ? highlightMatch(node.name, searchQuery) : node.name}
        </span>
        {match && match.matchesContent && (
          <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase text-primary">
            content
          </span>
        )}
      </div>

      {match?.matchesContent && match.snippet && (
        <div className="ml-6 mr-2 mt-1 border-l pl-2 text-xs text-muted-foreground">
          <div className="font-mono text-[10px] uppercase tracking-wide text-primary">
            line {match.snippet.line}
          </div>
          <div className="line-clamp-2 leading-relaxed">
            {match.snippet.before}
            <mark className="bg-transparent text-foreground underline decoration-primary">
              {match.snippet.match}
            </mark>
            {match.snippet.after}
          </div>
        </div>
      )}

      {node.isDirectory && expanded && node.children.length > 0 && (
        <TreeNodes
          nodes={node.children}
          level={level + 1}
          matchesByPath={matchesByPath}
          isSearchMode={isSearchMode}
          searchQuery={searchQuery}
        />
      )}
    </li>
  );
};

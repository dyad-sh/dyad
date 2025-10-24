import React from "react";
import { Folder, FolderOpen, Plus, Trash2 } from "lucide-react";
import { selectedFileAtom } from "@/atoms/viewAtoms";
import { useSetAtom } from "jotai";
import { useFileManagement } from "@/hooks/useFileManagement";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface FileTreeProps {
  files: string[];
  appId: number | null;
}

interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: TreeNode[];
}

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
export const FileTree = ({ files, appId }: FileTreeProps) => {
  const treeData = buildFileTree(files);
  const { createFile, deleteFile, isCreating, isDeleting } = useFileManagement(appId);

  const handleCreateFile = async (parentPath: string = "") => {
    const fileName = prompt("Enter file name:");
    if (!fileName) return;
    
    const filePath = parentPath ? `${parentPath}/${fileName}` : fileName;
    await createFile({ appId: appId!, filePath, content: "" });
  };

  const handleDeleteFile = async (filePath: string) => {
    if (!confirm(`Are you sure you want to delete ${filePath}?`)) return;
    await deleteFile({ appId: appId!, filePath });
  };

  return (
    <div className="file-tree mt-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">Files</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleCreateFile()}
              disabled={isCreating || !appId}
              className="h-6 w-6 p-0"
            >
              <Plus size={12} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Create new file</TooltipContent>
        </Tooltip>
      </div>
      <TreeNodes 
        nodes={treeData} 
        level={0} 
        onCreateFile={handleCreateFile}
        onDeleteFile={handleDeleteFile}
        isDeleting={isDeleting}
        appId={appId}
      />
    </div>
  );
};

interface TreeNodesProps {
  nodes: TreeNode[];
  level: number;
  onCreateFile: (parentPath: string) => void;
  onDeleteFile: (filePath: string) => void;
  isDeleting: boolean;
  appId: number | null;
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
const TreeNodes = ({ nodes, level, onCreateFile, onDeleteFile, isDeleting, appId }: TreeNodesProps) => (
  <ul className="ml-4">
    {sortNodes(nodes).map((node, index) => (
      <TreeNode 
        key={index} 
        node={node} 
        level={level} 
        onCreateFile={onCreateFile}
        onDeleteFile={onDeleteFile}
        isDeleting={isDeleting}
        appId={appId}
      />
    ))}
  </ul>
);

interface TreeNodeProps {
  node: TreeNode;
  level: number;
  onCreateFile: (parentPath: string) => void;
  onDeleteFile: (filePath: string) => void;
  isDeleting: boolean;
  appId: number | null;
}

// Individual tree node component
const TreeNode = ({ node, level, onCreateFile, onDeleteFile, isDeleting, appId }: TreeNodeProps) => {
  const [expanded, setExpanded] = React.useState(level < 2);
  const [showActions, setShowActions] = React.useState(false);
  const setSelectedFile = useSetAtom(selectedFileAtom);

  const handleClick = () => {
    if (node.isDirectory) {
      setExpanded(!expanded);
    } else {
      setSelectedFile({
        path: node.path,
      });
    }
  };

  const handleCreateFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    onCreateFile(node.path);
  };

  const handleDeleteFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDeleteFile(node.path);
  };

  return (
    <li className="py-0.5">
      <div
        className="flex items-center hover:bg-(--sidebar) rounded cursor-pointer px-1.5 py-0.5 text-sm group"
        onClick={handleClick}
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
      >
        {node.isDirectory && (
          <span className="mr-1 text-gray-500">
            {expanded ? <FolderOpen size={16} /> : <Folder size={16} />}
          </span>
        )}
        <span className="flex-1">{node.name}</span>
        
        {showActions && appId && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {node.isDirectory && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCreateFile}
                    className="h-4 w-4 p-0"
                  >
                    <Plus size={10} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Create file in {node.name}</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDeleteFile}
                  disabled={isDeleting}
                  className="h-4 w-4 p-0 text-red-500 hover:text-red-700"
                >
                  <Trash2 size={10} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete {node.name}</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>

      {node.isDirectory && expanded && node.children.length > 0 && (
        <TreeNodes 
          nodes={node.children} 
          level={level + 1} 
          onCreateFile={onCreateFile}
          onDeleteFile={onDeleteFile}
          isDeleting={isDeleting}
          appId={appId}
        />
      )}
    </li>
  );
};

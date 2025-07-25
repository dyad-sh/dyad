import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GitBranch } from "lucide-react";
import type { NeonBranch } from "@/ipc/ipc_types";

interface NeonBranchGraphProps {
  branches: NeonBranch[];
}

interface GraphNode {
  branch: NeonBranch;
  children: GraphNode[];
  level: number;
}

const getBranchTypeColor = (type: NeonBranch["type"]) => {
  switch (type) {
    case "production":
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
    case "development":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
    case "snapshot":
      return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
    case "preview":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300";
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
  }
};

const getBranchIcon = (type: NeonBranch["type"]) => {
  switch (type) {
    case "production":
      return "🏠"; // Home for main/production
    case "development":
      return "🔧"; // Wrench for development
    case "preview":
      return "👁️"; // Eye for preview
    case "snapshot":
      return "📸"; // Camera for snapshot
    default:
      return "🌿"; // Leaf for branch
  }
};

export const NeonBranchGraph = ({ branches }: NeonBranchGraphProps) => {
  const graphData = useMemo(() => {
    // Build a tree structure from the branches
    const branchMap = new Map<string, NeonBranch>();
    branches.forEach((branch) => {
      branchMap.set(branch.branchId, branch);
    });

    // Find root branches (branches without parents)
    const rootBranches = branches.filter((branch) => !branch.parentBranchId);

    // Recursive function to build the tree
    const buildTree = (branch: NeonBranch, level = 0): GraphNode => {
      const children = branches
        .filter((b) => b.parentBranchId === branch.branchId)
        .map((child) => buildTree(child, level + 1));

      return {
        branch,
        children,
        level,
      };
    };

    // Build trees for each root branch
    return rootBranches.map((root) => buildTree(root));
  }, [branches]);

  const renderNode = (
    node: GraphNode,
    isLast = false,
    prefix = "",
  ): React.ReactElement[] => {
    const elements: React.ReactElement[] = [];
    const { branch, children } = node;

    // Current node
    elements.push(
      <div key={branch.branchId} className="flex items-center gap-2 py-1">
        {/* Tree connector lines */}
        <div className="flex items-center text-muted-foreground text-xs font-mono">
          <span className="whitespace-pre">{prefix}</span>
          <span>{isLast ? "└─" : "├─"}</span>
        </div>

        {/* Branch icon */}
        <span className="text-sm">{getBranchIcon(branch.type)}</span>

        {/* Branch info */}
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="font-medium text-sm truncate max-w-[120px]"
            title={branch.branchName}
          >
            {branch.branchName}
          </span>
          <Badge
            variant="secondary"
            className={`${getBranchTypeColor(branch.type)} text-xs px-1.5 py-0.5`}
          >
            {branch.type}
          </Badge>
        </div>
      </div>,
    );

    // Children nodes
    children.forEach((child, index) => {
      const isLastChild = index === children.length - 1;
      const childPrefix = prefix + (isLast ? "   " : "│  ");
      elements.push(...renderNode(child, isLastChild, childPrefix));
    });

    return elements;
  };

  if (branches.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitBranch size={20} />
          Branch Hierarchy
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="font-mono text-sm space-y-0">
          {graphData.map((rootNode, index) => {
            const isLastRoot = index === graphData.length - 1;
            return (
              <div key={rootNode.branch.branchId}>
                {renderNode(rootNode, isLastRoot)}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-6 pt-4 border-t">
          <div className="text-xs text-muted-foreground mb-2">Legend:</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center gap-1">
              <span>🏠</span>
              <span>Production</span>
            </div>
            <div className="flex items-center gap-1">
              <span>🔧</span>
              <span>Development</span>
            </div>
            <div className="flex items-center gap-1">
              <span>👁️</span>
              <span>Preview</span>
            </div>
            <div className="flex items-center gap-1">
              <span>📸</span>
              <span>Snapshot</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

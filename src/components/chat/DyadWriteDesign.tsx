import React from "react";
import { Palette, Eye, Loader2 } from "lucide-react";
import { useSetAtom } from "jotai";
import { previewModeAtom } from "@/atoms/appAtoms";
import { isPreviewOpenAtom } from "@/atoms/viewAtoms";
import { CustomTagState } from "./stateTypes";

interface DyadWriteDesignProps {
  node: {
    properties: {
      title: string;
      interfaces?: string;
      complete?: string;
      state?: CustomTagState;
    };
  };
  children?: React.ReactNode;
}

export const DyadWriteDesign: React.FC<DyadWriteDesignProps> = ({ node }) => {
  const { title, interfaces, complete, state } = node.properties;
  const setPreviewMode = useSetAtom(previewModeAtom);
  const setIsPreviewOpen = useSetAtom(isPreviewOpenAtom);

  const isInProgress = state === "pending" || complete === "false";
  const interfaceCount = interfaces ? Number(interfaces) : undefined;

  return (
    <div
      className={`my-4 border rounded-lg overflow-hidden ${
        isInProgress ? "border-pink-500/60" : "border-pink-500/20"
      } bg-pink-500/5`}
    >
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Palette
            className={`text-pink-500 ${isInProgress ? "animate-pulse" : ""}`}
            size={20}
          />
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">{title}</span>
            {interfaceCount != null && !Number.isNaN(interfaceCount) && (
              <span className="text-xs text-muted-foreground">
                {interfaceCount} interface{interfaceCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center">
          {!isInProgress ? (
            <button
              type="button"
              onClick={() => {
                setPreviewMode("design");
                setIsPreviewOpen(true);
              }}
              className="flex items-center gap-1.5 text-xs font-medium text-white px-4 py-1.5 bg-pink-500 rounded-md hover:bg-pink-500/90 transition-colors"
            >
              <Eye size={14} />
              View Design
            </button>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-pink-600 dark:text-pink-400 px-3 py-1 bg-pink-500/20 rounded-md font-medium">
              <Loader2 size={12} className="animate-spin" />
              Designing...
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

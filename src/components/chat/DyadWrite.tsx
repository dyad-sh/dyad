import type React from "react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Pencil, Edit, X } from "lucide-react";
import { CodeHighlight } from "./CodeHighlight";
import { CustomTagState } from "./stateTypes";
import { FileEditor } from "../preview_panel/FileEditor";
import { useAtomValue } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  DyadCard,
  DyadCardHeader,
  DyadExpandIcon,
  DyadStateIndicator,
  DyadDescription,
  DyadCardContent,
} from "./DyadCardPrimitives";

interface DyadWriteProps {
  children?: ReactNode;
  node?: any;
  path?: string;
  description?: string;
}

export const DyadWrite: React.FC<DyadWriteProps> = ({
  children,
  node,
  path: pathProp,
  description: descriptionProp,
}) => {
  const [isContentVisible, setIsContentVisible] = useState(false);

  const path = pathProp || node?.properties?.path || "";
  const description = descriptionProp || node?.properties?.description || "";
  const state = node?.properties?.state as CustomTagState;

  const aborted = state === "aborted";
  const appId = useAtomValue(selectedAppIdAtom);
  const [isEditing, setIsEditing] = useState(false);
  const inProgress = state === "pending";

  const handleCancel = () => {
    setIsEditing(false);
  };

  const handleEdit = () => {
    setIsEditing(true);
    setIsContentVisible(true);
  };

  const fileName = path ? path.split("/").pop() : "";

  return (
    <DyadCard
      state={state}
      accentColor="blue"
      onClick={() => setIsContentVisible(!isContentVisible)}
      isExpanded={isContentVisible}
    >
      <DyadCardHeader icon={<Pencil size={15} />} accentColor="blue">
        <div className="min-w-0 truncate">
          {fileName && (
            <span className="font-medium text-sm text-foreground truncate block">
              {fileName}
            </span>
          )}
          {path && (
            <span className="text-[11px] text-muted-foreground truncate block">
              {path}
            </span>
          )}
        </div>
        {inProgress && (
          <DyadStateIndicator state="pending" pendingLabel="Writing..." />
        )}
        {aborted && (
          <DyadStateIndicator state="aborted" abortedLabel="Did not finish" />
        )}
        <div className="ml-auto flex items-center gap-1">
          {!inProgress && (
            <>
              {isEditing ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCancel();
                  }}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded transition-colors cursor-pointer"
                >
                  <X size={14} />
                  Cancel
                </button>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleEdit();
                  }}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded transition-colors cursor-pointer"
                >
                  <Edit size={14} />
                  Edit
                </button>
              )}
            </>
          )}
          <DyadExpandIcon isExpanded={isContentVisible} />
        </div>
      </DyadCardHeader>
      {description && (
        <DyadDescription>
          <span className={!isContentVisible ? "line-clamp-2" : undefined}>
            <span className="font-medium">Summary: </span>
            {description}
          </span>
        </DyadDescription>
      )}
      <DyadCardContent isExpanded={isContentVisible}>
        <div
          className="text-xs cursor-text"
          onClick={(e) => e.stopPropagation()}
        >
          {isEditing ? (
            <div className="h-96 min-h-96 border border-border rounded-lg overflow-hidden">
              <FileEditor appId={appId ?? null} filePath={path} />
            </div>
          ) : (
            <CodeHighlight className="language-typescript">
              {children}
            </CodeHighlight>
          )}
        </div>
      </DyadCardContent>
    </DyadCard>
  );
};

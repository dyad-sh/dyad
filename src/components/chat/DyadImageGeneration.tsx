import type React from "react";
import { useEffect, useState, type ReactNode } from "react";
import { Eye, ImageIcon } from "lucide-react";
import { useAtomValue } from "jotai";
import { CustomTagState } from "./stateTypes";
import {
  DyadCard,
  DyadCardHeader,
  DyadBadge,
  DyadExpandIcon,
  DyadStateIndicator,
  DyadCardContent,
} from "./DyadCardPrimitives";
import { ImageLightbox } from "./ImageLightbox";
import { currentAppAtom } from "@/atoms/appAtoms";

interface DyadImageGenerationNode {
  properties: {
    prompt: string;
    path: string;
    state: CustomTagState;
  };
}

interface DyadImageGenerationProps {
  children?: ReactNode;
  node?: DyadImageGenerationNode;
}

export const DyadImageGeneration: React.FC<DyadImageGenerationProps> = ({
  children,
  node,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [imageError, setImageError] = useState(false);
  const prompt = node?.properties?.prompt ?? "";
  const imagePath = node?.properties?.path ?? "";

  useEffect(() => {
    setImageError(false);
  }, [imagePath]);
  const state = node?.properties?.state;
  const inProgress = state === "pending";
  const aborted = state === "aborted";

  const app = useAtomValue(currentAppAtom);
  const appPath = app?.resolvedPath ?? app?.path ?? "";
  const normalizedImagePath = imagePath.split("\\").join("/");
  const hasTraversal = normalizedImagePath
    .split("/")
    .some((seg: string) => seg === "..");
  const imageUrl =
    appPath && normalizedImagePath && !hasTraversal
      ? `dyad-media://media/${encodeURIComponent(appPath)}/${normalizedImagePath
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`
      : "";
  const absolutePath =
    appPath && normalizedImagePath && !hasTraversal
      ? `${appPath}/${normalizedImagePath}`
      : undefined;
  const canViewImage =
    state === "finished" && !!imagePath && !!imageUrl && !imageError;

  return (
    <>
      <DyadCard
        state={state}
        accentColor="violet"
        isExpanded={isExpanded}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-start">
          <div className="flex-1 min-w-0">
            <DyadCardHeader icon={<ImageIcon size={15} />} accentColor="violet">
              <DyadBadge color="violet">Image Generation</DyadBadge>
              {!isExpanded && prompt && (
                <span className="text-sm text-muted-foreground italic truncate">
                  {prompt}
                </span>
              )}
              {inProgress && (
                <DyadStateIndicator
                  state="pending"
                  pendingLabel="Generating..."
                />
              )}
              {aborted && (
                <DyadStateIndicator
                  state="aborted"
                  abortedLabel="Did not finish"
                />
              )}
              <div className="ml-auto flex items-center gap-1">
                <DyadExpandIcon isExpanded={isExpanded} />
              </div>
            </DyadCardHeader>
            <DyadCardContent isExpanded={isExpanded}>
              <div className="text-sm text-muted-foreground space-y-2">
                {prompt && (
                  <div>
                    <span className="text-xs font-medium text-muted-foreground">
                      Prompt:
                    </span>
                    <div className="italic mt-0.5 text-foreground">
                      {prompt}
                    </div>
                  </div>
                )}
                {imagePath && (
                  <div>
                    <span className="text-xs font-medium text-muted-foreground">
                      Saved to:
                    </span>
                    <div className="mt-0.5 font-mono text-xs text-foreground">
                      {imagePath}
                    </div>
                  </div>
                )}
                {children && (
                  <div className="mt-0.5 text-foreground">{children}</div>
                )}
              </div>
            </DyadCardContent>
          </div>
          {canViewImage && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsLightboxOpen(true);
              }}
              className="group/thumb shrink-0 m-2 rounded-xl overflow-hidden transition-shadow cursor-pointer shadow-sm hover:shadow-xl relative"
              title="View generated image"
              aria-label="View generated image"
            >
              <img
                src={imageUrl}
                alt={prompt || "Generated image"}
                className="h-20 w-20 object-cover rounded-xl"
                onError={() => setImageError(true)}
              />
              <div className="absolute inset-0 bg-black/0 group-hover/thumb:bg-black/40 transition-colors rounded-xl flex items-center justify-center">
                <Eye
                  size={20}
                  className="text-white opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                />
              </div>
            </button>
          )}
        </div>
      </DyadCard>
      {isLightboxOpen && imageUrl && (
        <ImageLightbox
          imageUrl={imageUrl}
          alt={prompt || "Generated image"}
          filePath={absolutePath}
          onClose={() => setIsLightboxOpen(false)}
          onError={() => {
            setImageError(true);
            setIsLightboxOpen(false);
          }}
        />
      )}
    </>
  );
};

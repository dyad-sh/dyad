import type React from "react";
import { useEffect, useState, type ReactNode } from "react";
import { Eye, ImageIcon } from "lucide-react";
import { useAtomValue } from "jotai";
import { CustomTagState } from "./stateTypes";
import {
  ProteaAICard,
  ProteaAICardHeader,
  ProteaAIBadge,
  ProteaAIExpandIcon,
  ProteaAIStateIndicator,
  ProteaAICardContent,
} from "./ProteaAICardPrimitives";
import { ImageLightbox } from "./ImageLightbox";
import { currentAppAtom } from "@/atoms/appAtoms";
import { buildProteaAIMediaUrl } from "@/lib/dyadMediaUrl";

interface ProteaAIImageGenerationNode {
  properties: {
    prompt: string;
    path: string;
    state: CustomTagState;
  };
}

interface ProteaAIImageGenerationProps {
  children?: ReactNode;
  node?: ProteaAIImageGenerationNode;
}

export const ProteaAIImageGeneration: React.FC<ProteaAIImageGenerationProps> = ({
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
  const MEDIA_PREFIX = ".proteaai/media/";
  const imageUrl =
    appPath && normalizedImagePath && !hasTraversal
      ? normalizedImagePath.startsWith(MEDIA_PREFIX)
        ? buildProteaAIMediaUrl(
            appPath,
            normalizedImagePath.slice(MEDIA_PREFIX.length),
          )
        : `proteaai-media://media/${encodeURIComponent(appPath)}/${normalizedImagePath
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
      <ProteaAICard
        state={state}
        accentColor="violet"
        isExpanded={isExpanded}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-start">
          <div className="flex-1 min-w-0">
            <ProteaAICardHeader icon={<ImageIcon size={15} />} accentColor="violet">
              <ProteaAIBadge color="violet">Image Generation</ProteaAIBadge>
              {!isExpanded && prompt && (
                <span className="text-sm text-muted-foreground italic truncate">
                  {prompt}
                </span>
              )}
              {inProgress && (
                <ProteaAIStateIndicator
                  state="pending"
                  pendingLabel="Generating..."
                />
              )}
              {aborted && (
                <ProteaAIStateIndicator
                  state="aborted"
                  abortedLabel="Did not finish"
                />
              )}
              <div className="ml-auto flex items-center gap-1">
                <ProteaAIExpandIcon isExpanded={isExpanded} />
              </div>
            </ProteaAICardHeader>
            <ProteaAICardContent isExpanded={isExpanded}>
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
            </ProteaAICardContent>
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
      </ProteaAICard>
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

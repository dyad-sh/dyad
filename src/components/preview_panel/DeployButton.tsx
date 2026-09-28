import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { CloudUpload } from "lucide-react";
import { previewNativeViewAppIdAtom } from "@/atoms/previewAtoms";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useVersionPreview } from "@/hooks/useVersionPreview";
import { diffVersionIdForState } from "@/version_preview/state";
import { DeployDialog } from "./DeployDialog";
import { PREVIEW_TOOLBAR_BUTTON_CLASSES } from "./previewToolbarStyles";
import { usePreviewNativeOverlay } from "./usePreviewNativeOverlay";

export function DeployButton({ appId }: { appId: number | null }) {
  const nativeViewAppId = useAtomValue(previewNativeViewAppIdAtom);
  const useNativePreview = appId !== null && nativeViewAppId === appId;
  const syncDeployOverlay = usePreviewNativeOverlay("preview-deploy-dialog");
  const [deployAppId, setDeployAppId] = useState<number | null>(null);
  const { state: previewState } = useVersionPreview(appId);
  const isVersionSelected = diffVersionIdForState(previewState) !== null;

  useEffect(() => {
    syncDeployOverlay(
      deployAppId !== null && deployAppId === appId && useNativePreview,
    );
  }, [deployAppId, appId, syncDeployOverlay, useNativePreview]);
  useEffect(() => {
    setDeployAppId(null);
  }, [appId, isVersionSelected]);

  if (appId === null || isVersionSelected) return null;

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="Deploy"
              data-testid="deploy-button"
              className={PREVIEW_TOOLBAR_BUTTON_CLASSES}
              onClick={() => {
                syncDeployOverlay(useNativePreview);
                setDeployAppId(appId);
              }}
            />
          }
        >
          <CloudUpload size={16} aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent side="bottom">Deploy</TooltipContent>
      </Tooltip>
      {deployAppId !== null && deployAppId === appId && (
        <DeployDialog
          key={deployAppId}
          appId={deployAppId}
          onClose={() => {
            setDeployAppId(null);
            syncDeployOverlay(false);
          }}
        />
      )}
    </>
  );
}

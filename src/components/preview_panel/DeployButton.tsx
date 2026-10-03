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

export function DeployButton({
  appId,
  disabledReason = null,
}: {
  appId: number | null;
  /** Disables the button and shows why in its tooltip. */
  disabledReason?: string | null;
}) {
  const nativeViewAppId = useAtomValue(previewNativeViewAppIdAtom);
  const useNativePreview = appId !== null && nativeViewAppId === appId;
  const syncDeployOverlay = usePreviewNativeOverlay("preview-deploy-dialog");
  const [deployAppId, setDeployAppId] = useState<number | null>(null);
  const { state: previewState } = useVersionPreview(appId);
  const isVersionSelected = diffVersionIdForState(previewState) !== null;

  useEffect(() => {
    syncDeployOverlay(
      deployAppId !== null &&
        deployAppId === appId &&
        useNativePreview &&
        !isVersionSelected,
    );
  }, [
    deployAppId,
    appId,
    syncDeployOverlay,
    useNativePreview,
    isVersionSelected,
  ]);
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
              disabled={!!disabledReason}
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
        <TooltipContent side="bottom">
          {disabledReason || "Deploy"}
        </TooltipContent>
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

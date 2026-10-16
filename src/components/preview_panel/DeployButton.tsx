import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { CloudUpload } from "lucide-react";
import { previewNativeViewAppIdAtom } from "@/atoms/previewAtoms";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLoadApp } from "@/hooks/useLoadApp";
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
  const { app } = useLoadApp(appId);
  const isNeonApp = !!app?.neonProjectId;
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
        isNeonApp &&
        useNativePreview &&
        !isVersionSelected,
    );
  }, [
    deployAppId,
    appId,
    isNeonApp,
    syncDeployOverlay,
    useNativePreview,
    isVersionSelected,
  ]);
  useEffect(() => {
    setDeployAppId(null);
  }, [appId, isVersionSelected, isNeonApp]);

  if (appId === null || !isNeonApp || isVersionSelected) return null;

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

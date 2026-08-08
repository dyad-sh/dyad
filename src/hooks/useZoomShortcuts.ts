import { useCallback, useEffect, useMemo } from "react";
import { useSettings } from "@/hooks/useSettings";
import {
  type ZoomLevel,
  ZoomLevelSchema,
  ZOOM_LEVELS,
  DEFAULT_ZOOM_LEVEL,
} from "@/lib/schemas";
import { useIsMac } from "@/hooks/useChatModeToggle";

export function useZoomShortcuts() {
  const { settings, updateSettings } = useSettings();
  const isMac = useIsMac();

  const currentZoomLevel: ZoomLevel = useMemo(() => {
    const value = settings?.zoomLevel ?? DEFAULT_ZOOM_LEVEL;
    return ZoomLevelSchema.safeParse(value).success
      ? (value as ZoomLevel)
      : DEFAULT_ZOOM_LEVEL;
  }, [settings?.zoomLevel]);

  const zoomIn = useCallback(() => {
    const currentIndex = ZOOM_LEVELS.indexOf(currentZoomLevel);
    if (currentIndex < ZOOM_LEVELS.length - 1) {
      updateSettings({ zoomLevel: ZOOM_LEVELS[currentIndex + 1] });
    }
  }, [currentZoomLevel, updateSettings]);

  const zoomOut = useCallback(() => {
    const currentIndex = ZOOM_LEVELS.indexOf(currentZoomLevel);
    if (currentIndex > 0) {
      updateSettings({ zoomLevel: ZOOM_LEVELS[currentIndex - 1] });
    }
  }, [currentZoomLevel, updateSettings]);

  const resetZoom = useCallback(() => {
    updateSettings({ zoomLevel: DEFAULT_ZOOM_LEVEL });
  }, [updateSettings]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      ) {
        return;
      }

      const modifier = isMac ? event.metaKey : event.ctrlKey;
      if (!modifier) return;

      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        zoomIn();
      } else if (event.key === "-") {
        event.preventDefault();
        zoomOut();
      } else if (event.key === "0") {
        event.preventDefault();
        resetZoom();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isMac, zoomIn, zoomOut, resetZoom]);
}

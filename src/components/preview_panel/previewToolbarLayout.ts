const SHOW_OPEN_BROWSER_MIN_WIDTH_PX = 720;

export function getPreviewToolbarActionVisibility(width: number | null): {
  showOpenBrowser: boolean;
} {
  return {
    showOpenBrowser: width === null || width >= SHOW_OPEN_BROWSER_MIN_WIDTH_PX,
  };
}

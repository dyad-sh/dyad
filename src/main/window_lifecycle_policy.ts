export type ClosedWindowSessionDisposition = "forget" | "retain";

export function closedWindowSessionDisposition({
  isAppQuitting,
  openWindowCountBeforeClose,
}: {
  isAppQuitting: boolean;
  openWindowCountBeforeClose: number;
}): ClosedWindowSessionDisposition {
  return !isAppQuitting && openWindowCountBeforeClose > 1 ? "forget" : "retain";
}

export function shouldQuitAfterAllWindowsClosed(
  platform: NodeJS.Platform,
): boolean {
  return platform !== "darwin";
}

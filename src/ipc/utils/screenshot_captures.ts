/**
 * Recent screenshot captures at full resolution, keyed so a report can ask for
 * its own. Kept in main rather than sent to the renderer: a capture is a
 * multi-megabyte picture of the window, and the renderer only ever needs a
 * preview of it.
 *
 * A capture is held until the report it belongs to files it -- uploaded to
 * the screenshot bucket, or, if that fails, put on the clipboard for pasting.
 * Keyed rather than latest-wins: a second report can be started and captured
 * while the first is still uploading.
 */

/** Enough for a couple of overlapping reports; these are megabytes each. */
const MAX_RETAINED_CAPTURES = 3;

const captures = new Map<string, Electron.NativeImage>();

/** Stores a capture under `captureId`, evicting the oldest past the cap. */
export function retainCapture(
  captureId: string,
  image: Electron.NativeImage,
): void {
  captures.set(captureId, image);
  while (captures.size > MAX_RETAINED_CAPTURES) {
    captures.delete(captures.keys().next().value as string);
  }
}

export function getCapture(
  captureId: string,
): Electron.NativeImage | undefined {
  return captures.get(captureId);
}

/** Forgets a capture. True if there was one to forget. */
export function discardCapture(captureId: string): boolean {
  return captures.delete(captureId);
}

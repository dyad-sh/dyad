import { ipc } from "@/ipc/types";
import { showError } from "@/lib/toast";

/** Real extension for the bytes, since servers mislabel by filename. */
export function extensionForBytes(bytes: Uint8Array, mimeType: string): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "gif";
  if (bytes[8] === 0x57 && bytes[9] === 0x45) return "webp";
  const fromMime = /^image\/([a-z0-9.+-]+)/i.exec(mimeType)?.[1];
  return fromMime === "jpeg" ? "jpg" : (fromMime ?? "png");
}

/** A filesystem-safe stem taken from the prompt that produced the image. */
export function fileNameFromPrompt(prompt: string): string {
  return (
    prompt
      .slice(0, 40)
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .toLowerCase() || "image"
  );
}

/**
 * Saves an image to disk.
 *
 * The `download` attribute is only honoured for same-origin URLs: point an
 * anchor at a remote image and Chromium *navigates* to it instead, which in a
 * chrome-less window leaves nowhere to go back to. Fetching the bytes into a
 * blob first keeps a download a download, whatever the image's origin.
 */
export async function downloadImage(source: string, prompt: string) {
  const name = fileNameFromPrompt(prompt);

  let objectUrl: string | undefined;
  try {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    objectUrl = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = `${name}.${extensionForBytes(head, blob.type)}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    // Never fall back to navigating the window. Hand it to the browser, which
    // has its own chrome to get back from.
    if (/^https?:\/\//i.test(source)) {
      void ipc.system.openExternalUrl(source);
    } else {
      showError("Could not download that image.");
    }
  } finally {
    // Give the click a moment to start before the blob is released.
    const created = objectUrl;
    if (created) setTimeout(() => URL.revokeObjectURL(created), 10_000);
  }
}

/**
 * Saves a generated video to disk.
 *
 * Same reasoning as `downloadImage`: an anchor's `download` attribute is
 * ignored cross-origin, so a remote video would navigate the window instead of
 * saving. Fetching the bytes first keeps it a download.
 */
export async function downloadVideo(source: string, prompt: string) {
  const name = fileNameFromPrompt(prompt) || "video";

  let objectUrl: string | undefined;
  try {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    objectUrl = URL.createObjectURL(blob);

    const extension = /^video\/(mp4|webm|quicktime)/i.exec(blob.type)?.[1];
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = `${name}.${extension === "quicktime" ? "mov" : (extension ?? "mp4")}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    if (/^https?:\/\//i.test(source)) {
      void ipc.system.openExternalUrl(source);
    } else {
      showError("Could not download that video.");
    }
  } finally {
    const created = objectUrl;
    if (created) setTimeout(() => URL.revokeObjectURL(created), 10_000);
  }
}

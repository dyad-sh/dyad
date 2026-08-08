import { useEffect, useState } from "react";

/**
 * Object URLs for image files, created once per file and released together.
 *
 * Calling `URL.createObjectURL` inline during render leaks one URL per frame,
 * and revoking on the image's `onLoad` breaks the preview as soon as React
 * re-renders it. Owning them in an effect keeps both problems away.
 */
export function useImagePreviews(files: File[]): Map<File, string> {
  const [previews, setPreviews] = useState<Map<File, string>>(new Map());
  // Files arrive as a fresh array each render; key off identity and order.
  const signature = files
    .map((file) => `${file.name}:${file.size}:${file.lastModified}`)
    .join("|");

  useEffect(() => {
    const next = new Map<File, string>();
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        next.set(file, URL.createObjectURL(file));
      }
    }
    setPreviews(next);
    return () => {
      for (const url of next.values()) URL.revokeObjectURL(url);
    };
    // `signature` stands in for the file list: a new array with the same files
    // must not tear down and rebuild every URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return previews;
}

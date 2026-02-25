import { useState, useEffect } from "react";
import { ipc } from "@/ipc/types";

/**
 * Loads a media file via IPC and returns a data URI for rendering in <img>.
 * Electron blocks `file://` URLs by default, so we use the readMediaFile
 * IPC handler to fetch the base64 content and construct a data URI.
 */
export function useMediaDataUri(appId: number, fileName: string) {
  const [dataUri, setDataUri] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    ipc.media
      .readMediaFile({ appId, fileName })
      .then((res) => {
        if (!cancelled) {
          setDataUri(`data:${res.mimeType};base64,${res.base64Data}`);
        }
      })
      .catch(() => {
        // File may have been deleted or is unreadable – leave as null
      });

    return () => {
      cancelled = true;
    };
  }, [appId, fileName]);

  return dataUri;
}

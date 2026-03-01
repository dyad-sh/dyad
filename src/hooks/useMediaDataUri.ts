import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";

/**
 * Loads a media file via IPC and returns a data URI for rendering in <img>.
 * Electron blocks `file://` URLs by default, so we use the readMediaFile
 * IPC handler to fetch the base64 content and construct a data URI.
 */
export function useMediaDataUri(appId: number, fileName: string) {
  const { data: dataUri = null } = useQuery({
    queryKey: ["media-data-uri", appId, fileName],
    queryFn: async () => {
      const res = await ipc.media.readMediaFile({ appId, fileName });
      return `data:${res.mimeType};base64,${res.base64Data}`;
    },
  });

  return dataUri;
}

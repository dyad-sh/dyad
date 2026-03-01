import { useMediaDataUri } from "@/hooks/useMediaDataUri";
import type { ListAllMediaResponse } from "@/ipc/types";
import { parseMediaMentions } from "@/shared/parse_media_mentions";

interface MediaMentionPreviewProps {
  inputValue: string;
  mediaApps: ListAllMediaResponse["apps"];
}

export function MediaMentionPreview({
  inputValue,
  mediaApps,
}: MediaMentionPreviewProps) {
  const mediaRefs = parseMediaMentions(inputValue);
  if (mediaRefs.length === 0) return null;

  return (
    <div className="flex gap-2 px-3 py-1.5 overflow-x-auto">
      {mediaRefs.map((ref) => {
        const slashIdx = ref.indexOf("/");
        if (slashIdx === -1) return null;
        const appName = ref.substring(0, slashIdx);
        const fileName = ref.substring(slashIdx + 1);
        const app = mediaApps.find((a) => a.appName === appName);
        const file = app?.files.find((f) => f.fileName === fileName);
        if (!file || !app) return null;

        return (
          <MediaMentionThumbnail
            key={ref}
            appId={app.appId}
            appName={appName}
            fileName={fileName}
          />
        );
      })}
    </div>
  );
}

function MediaMentionThumbnail({
  appId,
  appName,
  fileName,
}: {
  appId: number;
  appName: string;
  fileName: string;
}) {
  const dataUri = useMediaDataUri(appId, fileName);

  return (
    <div
      className="w-16 h-16 rounded border overflow-hidden shrink-0"
      title={`${appName}/${fileName}`}
    >
      {dataUri ? (
        <img
          src={dataUri}
          alt={fileName}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full bg-muted animate-pulse" />
      )}
    </div>
  );
}

import { useState } from "react";
import { Image } from "lucide-react";
import { buildDyadMediaUrl } from "@/lib/dyadMediaUrl";

export function ImagePreview({
  appPath,
  fileName,
}: {
  appPath: string;
  fileName: string;
}) {
  const [imgError, setImgError] = useState(false);

  if (imgError) {
    return (
      <div className="flex items-center justify-center h-[60vh] text-muted-foreground">
        <Image className="h-10 w-10" />
      </div>
    );
  }

  return (
    <img
      src={buildDyadMediaUrl(appPath, fileName)}
      alt={fileName}
      className="w-full max-h-[80vh] object-contain"
      onError={() => setImgError(true)}
    />
  );
}

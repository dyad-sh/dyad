import { useEffect, useState } from "react";
import type { ListedApp } from "@/ipc/types/app";

interface AppShowcaseCardProps {
  app: ListedApp;
  thumbnailUrl: string | null;
  onClick: (appId: number) => void;
}

function getInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const codePoint = trimmed.codePointAt(0);
  return codePoint
    ? String.fromCodePoint(codePoint).toUpperCase()
    : trimmed[0].toUpperCase();
}

export function AppShowcaseCard({
  app,
  thumbnailUrl,
  onClick,
}: AppShowcaseCardProps) {
  const [imageBroken, setImageBroken] = useState(false);
  useEffect(() => {
    setImageBroken(false);
  }, [thumbnailUrl]);
  const showImage = thumbnailUrl && !imageBroken;

  return (
    <button
      type="button"
      onClick={() => onClick(app.id)}
      title={app.name}
      data-testid={`app-showcase-card-${app.name}`}
      className="group relative w-full aspect-[4/3] rounded-xl overflow-hidden border border-border bg-muted hover:border-primary/40 hover:shadow-md transition-all duration-200 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
    >
      {showImage ? (
        <img
          src={thumbnailUrl!}
          alt=""
          loading="lazy"
          onError={() => setImageBroken(true)}
          className="absolute inset-0 w-full h-full object-cover object-top"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/10 to-primary/30">
          <span className="text-3xl font-semibold text-primary/80">
            {getInitial(app.name)}
          </span>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent pt-8 pb-2.5 px-3">
        <p className="text-sm font-semibold text-white truncate text-left">
          {app.name}
        </p>
      </div>
    </button>
  );
}

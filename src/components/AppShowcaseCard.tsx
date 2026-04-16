import { useQuery } from "@tanstack/react-query";
import { ImageOff } from "lucide-react";
import { ipc } from "@/ipc/types";
import type { ListedApp } from "@/ipc/types/app";
import { queryKeys } from "@/lib/queryKeys";

interface AppShowcaseCardProps {
  app: ListedApp;
  onClick: (appId: number) => void;
}

export function AppShowcaseCard({ app, onClick }: AppShowcaseCardProps) {
  const { data: screenshotsData } = useQuery({
    queryKey: queryKeys.apps.screenshots({ appId: app.id }),
    queryFn: () => ipc.app.listAppScreenshots({ appId: app.id }),
  });

  const thumbnailUrl = screenshotsData?.screenshots[0]?.url ?? null;

  return (
    <button
      type="button"
      onClick={() => onClick(app.id)}
      title={app.name}
      data-testid={`app-showcase-card-${app.name}`}
      className="group relative w-full aspect-[4/3] rounded-xl overflow-hidden border border-border bg-muted hover:border-primary/40 hover:shadow-md transition-all duration-200 active:scale-[0.99]"
    >
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt=""
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover object-top"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <ImageOff className="w-6 h-6 text-muted-foreground" />
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

import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useOpenApp } from "@/hooks/useOpenApp";
import { AppShowcaseCard } from "@/components/AppShowcaseCard";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { sortAppsForShowcase } from "@/lib/sortApps";

const MAX_FEATURED_APPS = 10;

export function FeaturedAppShowcase() {
  const { apps } = useLoadApps();
  const openApp = useOpenApp();
  const navigate = useNavigate();

  const sortedApps = useMemo(() => sortAppsForShowcase(apps), [apps]);

  const featured = useMemo(
    () => sortedApps.slice(0, MAX_FEATURED_APPS),
    [sortedApps],
  );
  const featuredIds = useMemo(() => featured.map((a) => a.id), [featured]);

  const { data: thumbnailsData } = useQuery({
    queryKey: [...queryKeys.apps.thumbnails, "featured", featuredIds],
    queryFn: () => ipc.app.listAppThumbnails({ appIds: featuredIds }),
    enabled: featuredIds.length > 0,
  });
  const thumbnailByAppId = useMemo(() => {
    const map = new Map<number, string | null>();
    for (const t of thumbnailsData?.thumbnails ?? []) {
      map.set(t.appId, t.thumbnailUrl);
    }
    return map;
  }, [thumbnailsData]);

  if (sortedApps.length === 0) {
    return null;
  }

  const hasMore = sortedApps.length > MAX_FEATURED_APPS;

  return (
    <section
      data-testid="featured-app-showcase"
      className="w-full max-w-6xl mx-auto px-8 mt-8 mb-12"
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Featured App Showcase</h2>
        <button
          type="button"
          onClick={() => navigate({ to: "/apps" })}
          className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          See more
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      <div
        tabIndex={0}
        role="region"
        aria-label="App showcase"
        className="flex gap-4 overflow-x-auto scrollbar-on-hover pb-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-lg"
      >
        {featured.map((app) => (
          <div key={app.id} className="w-56 flex-shrink-0">
            <AppShowcaseCard
              app={app}
              thumbnailUrl={thumbnailByAppId.get(app.id) ?? null}
              onClick={openApp}
            />
          </div>
        ))}
        {hasMore && (
          <button
            type="button"
            onClick={() => navigate({ to: "/apps" })}
            className="flex flex-col items-center justify-center w-56 aspect-[4/3] flex-shrink-0 rounded-xl border border-dashed border-border bg-(--background-lighter) hover:border-primary/40 hover:bg-(--background-lightest) transition-all duration-200 active:scale-[0.99]"
          >
            <ChevronRight className="w-6 h-6 text-muted-foreground mb-1" />
            <span className="text-sm font-medium">See more</span>
          </button>
        )}
      </div>
    </section>
  );
}

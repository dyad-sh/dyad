import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useOpenApp } from "@/hooks/useOpenApp";
import { AppShowcaseCard } from "@/components/AppShowcaseCard";
import { useAppThumbnails } from "@/hooks/useAppThumbnails";
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

  const thumbnailByAppId = useAppThumbnails(featuredIds);

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
        <h2 className="text-lg font-semibold">Featured Apps </h2>
        <button
          type="button"
          onClick={() => navigate({ to: "/apps" })}
          className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          See more
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      <div className="relative">
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
        {/* Trailing fade hints that more cards exist off-screen, since the
            scrollbar is hidden until hover and the cards fill the width. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-background to-transparent rounded-r-lg"
        />
      </div>
    </section>
  );
}

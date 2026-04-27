import { useMemo, useState } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useOpenApp } from "@/hooks/useOpenApp";
import { AppShowcaseCard } from "@/components/AppShowcaseCard";
import { useAppThumbnails } from "@/hooks/useAppThumbnails";
import { sortAppsForShowcase } from "@/lib/sortApps";

export default function AppsPage() {
  const router = useRouter();
  const navigate = useNavigate();
  const { apps, loading } = useLoadApps();
  const openApp = useOpenApp();
  const [searchQuery, setSearchQuery] = useState("");

  const filteredApps = useMemo(() => {
    const sorted = sortAppsForShowcase(apps);
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((app) => app.name.toLowerCase().includes(q));
  }, [apps, searchQuery]);

  // Fetch thumbnails for ALL apps once and filter client-side so typing in
  // the search box doesn't trigger a burst of IPC + filesystem reads. This
  // also lets the underlying query cache be shared with the featured
  // showcase on the home page.
  const allAppIds = useMemo(() => apps.map((a) => a.id), [apps]);
  const thumbnailByAppId = useAppThumbnails(allAppIds);

  const handleGoBack = () => {
    if (router.history.length > 1) {
      router.history.back();
    } else {
      navigate({ to: "/" });
    }
  };

  return (
    <div className="min-h-screen w-full px-8 py-4">
      <div className="max-w-6xl mx-auto pb-12">
        <Button
          onClick={handleGoBack}
          variant="outline"
          size="sm"
          className="flex items-center gap-2 mb-4 bg-(--background-lightest) py-5"
        >
          <ArrowLeft className="h-4 w-4" />
          Go Back
        </Button>

        <header className="mb-6 text-left">
          <h1 className="text-3xl font-bold mb-2">Apps</h1>
        </header>

        <div className="mb-6">
          <div
            className={cn(
              "relative flex items-center border border-border rounded-2xl bg-(--background-lighter) transition-colors duration-200",
              "hover:border-primary/30",
              "focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-primary/20",
            )}
          >
            <Search className="absolute left-4 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search apps..."
              aria-label="Search apps"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-transparent py-3 pl-11 pr-4 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>

        {loading ? (
          <div className="text-muted-foreground text-center py-12">
            Loading apps...
          </div>
        ) : filteredApps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <p className="text-muted-foreground text-center">
              {searchQuery
                ? "No apps match your search."
                : "You haven't created any apps yet."}
            </p>
            {!searchQuery && (
              <Button onClick={() => navigate({ to: "/" })} size="sm">
                Create your first app
              </Button>
            )}
          </div>
        ) : (
          <div
            data-testid="apps-grid"
            className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4"
          >
            {filteredApps.map((app) => (
              <AppShowcaseCard
                key={app.id}
                app={app}
                thumbnailUrl={thumbnailByAppId.get(app.id) ?? null}
                onClick={openApp}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

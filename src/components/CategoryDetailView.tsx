import { useMemo, useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppShowcaseCard } from "@/components/AppShowcaseCard";
import { useAppThumbnails } from "@/hooks/useAppThumbnails";
import { useOpenApp } from "@/hooks/useOpenApp";
import { sortAppsForShowcase } from "@/lib/sortApps";
import type { ListedApp } from "@/ipc/types/app";
import type { Category } from "@/hooks/useCategories";
import { AddAppsToCategoryDialog } from "@/components/AddAppsToCategoryDialog";

interface CategoryDetailViewProps {
  category: Category;
  apps: ListedApp[];
  categories: Category[];
  onBack: () => void;
}

export function CategoryDetailView({
  category,
  apps,
  categories,
  onBack,
}: CategoryDetailViewProps) {
  const openApp = useOpenApp();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  const memberApps = useMemo(() => {
    const memberSet = new Set(category.appIds);
    return sortAppsForShowcase(apps.filter((a) => memberSet.has(a.id)));
  }, [apps, category.appIds]);

  const memberAppIds = useMemo(() => memberApps.map((a) => a.id), [memberApps]);
  const thumbnailByAppId = useAppThumbnails(memberAppIds);

  return (
    <div data-testid={`category-detail-${category.id}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            variant="outline"
            size="sm"
            onClick={onBack}
            className="flex items-center gap-2"
            data-testid="category-detail-back-button"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <h2 className="text-xl font-semibold truncate">{category.name}</h2>
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {memberApps.length} app{memberApps.length === 1 ? "" : "s"}
          </span>
        </div>
        <Button
          size="sm"
          onClick={() => setIsAddDialogOpen(true)}
          className="flex items-center gap-1"
          data-testid="category-detail-add-apps-button"
        >
          <Plus className="h-4 w-4" />
          Add apps
        </Button>
      </div>

      {memberApps.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <p className="text-muted-foreground text-center">
            No apps in this category yet.
          </p>
          <Button size="sm" onClick={() => setIsAddDialogOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Add apps
          </Button>
        </div>
      ) : (
        <div
          data-testid="category-apps-grid"
          className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4"
        >
          {memberApps.map((app) => (
            <AppShowcaseCard
              key={app.id}
              app={app}
              thumbnailUrl={thumbnailByAppId.get(app.id) ?? null}
              onClick={openApp}
            />
          ))}
        </div>
      )}

      <AddAppsToCategoryDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        category={category}
        allApps={apps}
        categories={categories}
      />
    </div>
  );
}

import { useMemo, useState } from "react";
import { Star } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useMcpCatalog } from "@/hooks/useMcpCatalog";
import { CatalogCard } from "./CatalogCard";
import { StdioCatalogConsentDialog } from "./StdioCatalogConsentDialog";
import { useAddFromCatalog } from "./useAddFromCatalog";

export function CatalogSection() {
  const [search, setSearch] = useState("");
  const {
    addFromCatalog,
    addingSlug,
    pendingStdioEntry,
    confirmPendingStdio,
    cancelPendingStdio,
  } = useAddFromCatalog();

  const catalogQuery = useMcpCatalog();

  const entries = catalogQuery.data?.entries ?? [];
  const addedSlugs = useMemo(
    () => new Set(catalogQuery.data?.addedSlugs ?? []),
    [catalogQuery.data?.addedSlugs],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((e) =>
      [e.name, e.slug, e.description ?? "", e.category ?? ""].some((field) =>
        field.toLowerCase().includes(needle),
      ),
    );
  }, [entries, search]);

  // Featured entries are highlighted at the top and still listed in
  // their own category below.
  const featured = useMemo(
    () => filtered.filter((e) => e.featured),
    [filtered],
  );

  const byCategory = useMemo(() => {
    const groups = new Map<string, typeof filtered>();
    for (const entry of filtered) {
      const category = entry.category ?? "Other";
      const group = groups.get(category) ?? [];
      group.push(entry);
      groups.set(category, group);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  // Nothing renders while loading or when the catalog is empty or
  // unreachable: the section either appears complete or not at all.
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="mt-10" data-testid="catalog-section">
      <StdioCatalogConsentDialog
        entry={pendingStdioEntry}
        onConfirm={confirmPendingStdio}
        onCancel={cancelPendingStdio}
      />
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Add from catalog
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Curated plugins that connect with minimal configuration.
          </p>
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search catalog"
          aria-label="Search catalog"
          className="max-w-xs"
        />
      </div>
      {filtered.length === 0 && (
        <div className="text-sm text-muted-foreground">
          No catalog entries match your search.
        </div>
      )}
      {featured.length > 0 && (
        <div className="mb-6" data-testid="catalog-featured">
          <h3 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
            <Star className="w-3.5 h-3.5" />
            Featured
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {featured.map((entry) => (
              <CatalogCard
                key={entry.slug}
                entry={entry}
                isAdded={addedSlugs.has(entry.slug)}
                isAdding={addingSlug === entry.slug}
                onAdd={addFromCatalog}
              />
            ))}
          </div>
        </div>
      )}
      {byCategory.map(([category, group]) => (
        <div key={category} className="mb-6">
          <h3 className="text-sm font-medium text-muted-foreground mb-2">
            {category}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {group.map((entry) => (
              <CatalogCard
                key={entry.slug}
                entry={entry}
                isAdded={addedSlugs.has(entry.slug)}
                isAdding={addingSlug === entry.slug}
                onAdd={addFromCatalog}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

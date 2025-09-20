import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "./ui/command";
import { useState, useEffect } from "react";
import { useSearchApps } from "@/hooks/useSearchApps";
import type { AppSearchResult } from "@/lib/schemas";

type AppSearchDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectApp: (appId: number) => void;
  allApps: AppSearchResult[];
};

export function AppSearchDialog({
  open,
  onOpenChange,
  onSelectApp,
  allApps,
}: AppSearchDialogProps) {
  const [searchQuery, setSearchQuery] = useState<string>("");
  function useDebouncedValue<T>(value: T, delay: number): T {
    const [debounced, setDebounced] = useState<T>(value);
    useEffect(() => {
      const handle = setTimeout(() => setDebounced(value), delay);
      return () => clearTimeout(handle);
    }, [value, delay]);
    return debounced;
  }

  const debouncedQuery = useDebouncedValue(searchQuery, 150);
  const { apps: searchResults } = useSearchApps(debouncedQuery);

  // Show all apps if search is empty, otherwise show search results
  const appsToShow: AppSearchResult[] =
    debouncedQuery.trim() === "" ? allApps : searchResults;

  const commandFilter = (
    value: string,
    search: string,
    keywords?: string[],
  ): number => {
    const q = search.trim().toLowerCase();
    if (!q) return 1;
    const v = (value || "").toLowerCase();
    if (v.includes(q)) {
      // Higher score for earlier match in title/value
      return 100 - Math.max(0, v.indexOf(q));
    }
    const foundInKeywords = (keywords || []).some((k) =>
      (k || "").toLowerCase().includes(q),
    );
    return foundInKeywords ? 50 : 0;
  };

  function getSnippet(
    text: string,
    query: string,
    radius = 50,
  ): {
    before: string;
    match: string;
    after: string;
    raw: string;
  } {
    const q = query.trim();
    const lowerText = text.toLowerCase();
    const lowerQuery = q.toLowerCase();
    const idx = lowerText.indexOf(lowerQuery);
    if (idx === -1) {
      const raw =
        text.length > radius * 2 ? text.slice(0, radius * 2) + "…" : text;
      return { before: "", match: "", after: "", raw };
    }
    const start = Math.max(0, idx - radius);
    const end = Math.min(text.length, idx + q.length + radius);
    const before = (start > 0 ? "…" : "") + text.slice(start, idx);
    const match = text.slice(idx, idx + q.length);
    const after =
      text.slice(idx + q.length, end) + (end < text.length ? "…" : "");
    return { before, match, after, raw: before + match + after };
  }

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, onOpenChange]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      data-testid="app-search-dialog"
      filter={commandFilter}
    >
      <CommandInput
        placeholder="Search apps"
        value={searchQuery}
        onValueChange={setSearchQuery}
        data-testid="app-search-input"
      />
      <CommandList data-testid="app-search-list">
        <CommandEmpty data-testid="app-search-empty">
          No results found.
        </CommandEmpty>
        <CommandGroup heading="Apps" data-testid="app-search-group">
          {appsToShow.map((app) => {
            const isSearch = searchQuery.trim() !== "";
            let snippet = null;
            if (isSearch && app.matchedChatMessage) {
              snippet = getSnippet(app.matchedChatMessage, searchQuery);
            } else if (isSearch && app.matchedChatTitle) {
              snippet = getSnippet(app.matchedChatTitle, searchQuery);
            }
            return (
              <CommandItem
                key={app.id}
                onSelect={() => onSelectApp(app.id)}
                value={app.name + (snippet ? ` ${snippet.raw}` : "")}
                keywords={snippet ? [snippet.raw] : []}
                data-testid={`app-search-item-${app.id}`}
              >
                <div className="flex flex-col">
                  <span>{app.name}</span>
                  {snippet && (
                    <span className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {snippet.before}
                      <mark className="bg-transparent underline decoration-2 decoration-primary">
                        {snippet.match}
                      </mark>
                      {snippet.after}
                    </span>
                  )}
                </div>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

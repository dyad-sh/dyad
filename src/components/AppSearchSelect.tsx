import { useState, useMemo } from "react";
import { ChevronsUpDown, Check, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export function AppSearchSelect({
  apps,
  selectedAppId,
  onSelect,
  disabled,
}: {
  apps: { id: number; name: string }[];
  selectedAppId: number | null;
  onSelect: (appId: number) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filteredApps = useMemo(() => {
    if (!search.trim()) return apps;
    const q = search.toLowerCase();
    return apps.filter((app) => app.name.toLowerCase().includes(q));
  }, [apps, search]);

  const selectedApp = apps.find((a) => a.id === selectedAppId);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setSearch("");
      }}
    >
      <PopoverTrigger
        disabled={disabled}
        aria-label="Select target app"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={selectedApp ? "" : "text-muted-foreground"}>
          {selectedApp?.name ?? "Select an app..."}
        </span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-[--anchor-width] p-0" align="start">
        <div className="flex items-center border-b px-3">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <Input
            placeholder="Search apps..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 border-0 shadow-none focus-visible:ring-0 px-0"
          />
        </div>
        <div className="max-h-[200px] overflow-y-auto p-1">
          {filteredApps.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No apps found.
            </p>
          ) : (
            filteredApps.map((app) => (
              <button
                key={app.id}
                type="button"
                onClick={() => {
                  onSelect(app.id);
                  setOpen(false);
                  setSearch("");
                }}
                className="relative flex w-full cursor-default items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
              >
                {app.id === selectedAppId && (
                  <Check className="absolute left-2 h-4 w-4" />
                )}
                {app.name}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

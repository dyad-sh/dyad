import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export function LibrarySearchBar({
  value,
  onChange,
  placeholder = "Search themes and prompts...",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
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
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent py-3 pl-11 pr-4 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  );
}

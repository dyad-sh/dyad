import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useRef, useState } from "react";
import { useScrollAndNavigateTo } from "@/hooks/useScrollAndNavigateTo";
import { useAtom } from "jotai";
import { activeSettingsSectionAtom } from "@/atoms/viewAtoms";
import { SETTINGS_SEARCH_INDEX } from "@/lib/settingsSearchIndex";
import Fuse from "fuse.js";
import { SearchIcon, XIcon } from "lucide-react";

type SettingsSection = {
  id: string;
  label: string;
};

const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "general-settings", label: "General" },
  { id: "workflow-settings", label: "Workflow" },
  { id: "ai-settings", label: "AI" },
  { id: "provider-settings", label: "Model Providers" },
  { id: "telemetry", label: "Telemetry" },
  { id: "integrations", label: "Integrations" },
  {
    id: "agent-permissions",
    label: "Agent Permissions",
  },
  { id: "tools-mcp", label: "Tools (MCP)" },
  { id: "experiments", label: "Experiments" },
  { id: "danger-zone", label: "Danger Zone" },
];

const fuse = new Fuse(SETTINGS_SEARCH_INDEX, {
  keys: [
    { name: "label", weight: 2 },
    { name: "description", weight: 1 },
    { name: "keywords", weight: 1.5 },
    { name: "sectionLabel", weight: 0.5 },
  ],
  threshold: 0.4,
  includeScore: true,
  ignoreLocation: true,
});

export function SettingsList({ show }: { show: boolean }) {
  const [activeSection, setActiveSection] = useAtom(activeSettingsSectionAtom);
  const [searchQuery, setSearchQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollAndNavigateTo = useScrollAndNavigateTo("/settings", {
    behavior: "smooth",
    block: "start",
  });

  const scrollAndNavigateToWithHighlight = useScrollAndNavigateTo("/settings", {
    behavior: "smooth",
    block: "start",
    highlight: true,
  });

  const settingsSections = SETTINGS_SECTIONS;

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return null;
    return fuse.search(searchQuery.trim());
  }, [searchQuery]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
            return;
          }
        }
      },
      { rootMargin: "-20% 0px -80% 0px", threshold: 0 },
    );

    for (const section of settingsSections) {
      const el = document.getElementById(section.id);
      if (el) {
        observer.observe(el);
      }
    }

    return () => {
      observer.disconnect();
    };
  }, [settingsSections, setActiveSection]);

  if (!show) {
    return null;
  }

  const handleScrollAndNavigateTo = scrollAndNavigateTo;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 p-4">
        <h2 className="text-lg font-semibold tracking-tight">Settings</h2>
      </div>
      <div className="flex-shrink-0 px-4 pb-2">
        <div className="relative">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search settings..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md border border-input bg-transparent pl-8 pr-8 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery("");
                inputRef.current?.focus();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <ScrollArea className="flex-grow">
        <div className="space-y-1 p-4 pt-0">
          {searchResults !== null ? (
            searchResults.length > 0 ? (
              searchResults.map((result) => (
                <button
                  key={result.item.id}
                  onClick={() => {
                    scrollAndNavigateToWithHighlight(result.item.id);
                    setSearchQuery("");
                  }}
                  className="w-full text-left px-3 py-2 rounded-md text-sm transition-colors hover:bg-sidebar-accent"
                >
                  <div className="font-medium">{result.item.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {result.item.sectionLabel}
                  </div>
                </button>
              ))
            ) : (
              <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                No settings found
              </div>
            )
          ) : (
            settingsSections.map((section) => (
              <button
                key={section.id}
                onClick={() => handleScrollAndNavigateTo(section.id)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                  activeSection === section.id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
                    : "hover:bg-sidebar-accent",
                )}
              >
                {section.label}
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

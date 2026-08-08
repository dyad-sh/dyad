import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useMemo, useRef, useState } from "react";
import { useScrollAndNavigateTo } from "@/hooks/useScrollAndNavigateTo";
import { useAtom } from "jotai";
import {
  activeSettingsSectionAtom,
  activeSettingsTabAtom,
} from "@/atoms/viewAtoms";
import { SECTION_IDS, SETTINGS_SEARCH_INDEX } from "@/lib/settingsSearchIndex";
import { SETTINGS_TABS } from "@/lib/settingsTabs";
import Fuse from "fuse.js";
import { SearchIcon, XIcon } from "lucide-react";

type SettingsSection = {
  id: string;
  label: string;
};

const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: SECTION_IDS.general, label: "General" },
  { id: SECTION_IDS.workflow, label: "Workflow" },
  { id: SECTION_IDS.ai, label: "AI" },
  { id: SECTION_IDS.chatAgent, label: "Chat Agent" },
  { id: SECTION_IDS.providers, label: "Model Providers" },
  { id: SECTION_IDS.telemetry, label: "Telemetry" },
  { id: SECTION_IDS.integrations, label: "Integrations" },
  { id: SECTION_IDS.agentPermissions, label: "Tool Permissions" },
  { id: SECTION_IDS.toolsMcp, label: "Tools (MCP)" },
  { id: SECTION_IDS.experiments, label: "Experiments" },
  { id: SECTION_IDS.dangerZone, label: "Danger Zone" },
];

const sectionLabelById = new Map(
  SETTINGS_SECTIONS.map((section) => [section.id, section.label]),
);

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
  const [activeSection] = useAtom(activeSettingsSectionAtom);
  const [activeTab, setActiveTab] = useAtom(activeSettingsTabAtom);
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

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return null;
    return fuse.search(searchQuery.trim());
  }, [searchQuery]);

  const navigateToSection = (sectionId: string, settingId?: string) => {
    const targetId = settingId ?? sectionId;
    void scrollAndNavigateTo(targetId, sectionId);
  };

  if (!show) {
    return null;
  }

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
            aria-label="Search settings"
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
              aria-label="Clear search"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <ScrollArea className="flex-grow">
        <div className="space-y-3 p-4 pt-0">
          {searchResults !== null ? (
            searchResults.length > 0 ? (
              searchResults.map((result) => (
                <button
                  key={`${result.item.id}-${result.refIndex}`}
                  onClick={() => {
                    void scrollAndNavigateToWithHighlight(
                      result.item.id,
                      result.item.sectionId,
                    );
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
            SETTINGS_TABS.map((tab) => (
              <div key={tab.id} className="space-y-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                    const firstSection = tab.sectionIds[0];
                    if (firstSection) {
                      navigateToSection(firstSection);
                    }
                  }}
                  className={cn(
                    "w-full text-left px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wide transition-colors",
                    activeTab === tab.id
                      ? "text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab.label}
                </button>
                {tab.sectionIds.map((sectionId) => (
                  <button
                    key={sectionId}
                    type="button"
                    onClick={() => navigateToSection(sectionId)}
                    className={cn(
                      "w-full text-left pl-5 pr-3 py-2 rounded-md text-sm transition-colors",
                      activeSection === sectionId
                        ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
                        : "hover:bg-sidebar-accent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {sectionLabelById.get(sectionId) ?? sectionId}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

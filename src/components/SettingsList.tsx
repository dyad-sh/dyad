import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useRef, useState } from "react";
import { useScrollAndNavigateTo } from "@/hooks/useScrollAndNavigateTo";
import { useAtom } from "jotai";
import { activeSettingsSectionAtom } from "@/atoms/viewAtoms";
import { SECTION_IDS, SETTINGS_SEARCH_INDEX } from "@/lib/settingsSearchIndex";
import Fuse from "fuse.js";
import { SearchIcon, XIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

type SettingsSection = {
  id: string;
};

const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: SECTION_IDS.general },
  { id: SECTION_IDS.workflow },
  { id: SECTION_IDS.ai },
  { id: SECTION_IDS.providers },
  { id: SECTION_IDS.telemetry },
  { id: SECTION_IDS.integrations },
  { id: SECTION_IDS.agentPermissions },
  { id: SECTION_IDS.advanced },
  { id: SECTION_IDS.experiments },
  { id: SECTION_IDS.dangerZone },
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
  const { t } = useTranslation("settings");
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

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return null;
    return fuse.search(searchQuery.trim());
  }, [searchQuery]);

  const getSectionLabel = (id: string) => {
    switch (id) {
      case SECTION_IDS.general:
        return t("sections.general");
      case SECTION_IDS.workflow:
        return t("sections.workflow");
      case SECTION_IDS.ai:
        return t("sections.ai");
      case SECTION_IDS.providers:
        return t("sections.providers");
      case SECTION_IDS.telemetry:
        return t("sections.telemetry");
      case SECTION_IDS.integrations:
        return t("sections.integrations");
      case SECTION_IDS.agentPermissions:
        return t("sections.agentPermissions");
      case SECTION_IDS.advanced:
        return t("sections.advanced");
      case SECTION_IDS.experiments:
        return t("sections.experiments");
      case SECTION_IDS.dangerZone:
        return t("sections.dangerZone");
      default:
        return id;
    }
  };

  useEffect(() => {
    if (!show) return;

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

    for (const section of SETTINGS_SECTIONS) {
      const el = document.getElementById(section.id);
      if (el) {
        observer.observe(el);
      }
    }

    return () => {
      observer.disconnect();
    };
  }, [show, setActiveSection]);

  if (!show) {
    return null;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 p-4">
        <h2 className="text-lg font-semibold tracking-tight">{t("title")}</h2>
      </div>
      <div className="flex-shrink-0 px-4 pb-2">
        <div className="relative">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            placeholder={t("search.placeholder")}
            aria-label={t("search.ariaLabel")}
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
              aria-label={t("search.clear")}
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
                  key={`${result.item.id}-${result.refIndex}`}
                  onClick={() => {
                    scrollAndNavigateToWithHighlight(
                      result.item.id,
                      result.item.sectionId,
                    );
                    setSearchQuery("");
                  }}
                  className="w-full text-left px-3 py-2 rounded-md text-sm transition-colors hover:bg-sidebar-accent"
                >
                  <div className="font-medium">{result.item.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {getSectionLabel(result.item.sectionId)}
                  </div>
                </button>
              ))
            ) : (
              <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                {t("search.noResults")}
              </div>
            )
          ) : (
            SETTINGS_SECTIONS.map((section) => (
              <button
                key={section.id}
                onClick={() => scrollAndNavigateTo(section.id)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                  activeSection === section.id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
                    : "hover:bg-sidebar-accent",
                )}
              >
                {getSectionLabel(section.id)}
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

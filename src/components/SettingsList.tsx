import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useEffect } from "react";
import { useScrollAndNavigateTo } from "@/hooks/useScrollAndNavigateTo";
import { useAtom } from "jotai";
import { activeSettingsSectionAtom } from "@/atoms/viewAtoms";

const SETTINGS_SECTIONS = [
  { id: "general-settings", label: "General" },
  { id: "workflow-settings", label: "Workflow" },
  { id: "ai-settings", label: "AI" },
  { id: "provider-settings", label: "Model Providers" },
  { id: "telemetry", label: "Telemetry" },
  { id: "integrations", label: "Integrations" },
  { id: "tools-mcp", label: "Tools (MCP)" },
  { id: "experiments", label: "Experiments" },
  { id: "danger-zone", label: "Danger Zone" },
];

export function SettingsList({ show }: { show: boolean }) {
  const [activeSection, setActiveSection] = useAtom(activeSettingsSectionAtom);
  const scrollAndNavigateTo = useScrollAndNavigateTo("/settings", {
    behavior: "smooth",
    block: "start",
  });

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

    for (const section of SETTINGS_SECTIONS) {
      const el = document.getElementById(section.id);
      if (el) {
        observer.observe(el);
      }
    }

    return () => {
      observer.disconnect();
    };
  }, []);

  if (!show) {
    return null;
  }

  const handleScrollAndNavigateTo = scrollAndNavigateTo;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 p-4">
        <h2 className="text-lg font-semibold tracking-tight">Settings</h2>
      </div>
      <ScrollArea className="flex-grow">
        <div className="space-y-1 p-4 pt-0">
          {SETTINGS_SECTIONS.map((section) => (
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
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Link, useRouterState } from "@tanstack/react-router";
import { Palette, FileText } from "lucide-react";

type LibrarySection = {
  id: string;
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
};

const LIBRARY_SECTIONS: LibrarySection[] = [
  { id: "themes", label: "Themes", to: "/themes", icon: Palette },
  { id: "prompts", label: "Prompts", to: "/library", icon: FileText },
];

export function LibraryList({ show }: { show: boolean }) {
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;

  if (!show) {
    return null;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 p-4">
        <h2 className="text-lg font-semibold tracking-tight">Library</h2>
      </div>
      <ScrollArea className="flex-grow">
        <div className="space-y-1 p-4 pt-0">
          {LIBRARY_SECTIONS.map((section) => {
            const isActive =
              section.to === pathname ||
              (section.to !== "/" && pathname.startsWith(section.to));

            return (
              <Link
                key={section.id}
                to={section.to}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
                    : "hover:bg-sidebar-accent",
                )}
              >
                <section.icon className="h-4 w-4" />
                {section.label}
              </Link>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

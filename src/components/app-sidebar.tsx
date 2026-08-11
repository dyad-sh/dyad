import {
  Brain,
  Cpu,
  HardDrive,
  DraftingCompass,
  type LucideIcon,
  MessageSquare,
  BookOpen,
  Bot,
  CalendarDays,
  GitFork,
} from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useSidebar } from "@/components/ui/sidebar";
import type { ComponentType } from "react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  type AppSidebarItemTitle,
  isSidebarItemActive,
} from "./app-sidebar-state";
import { useSettings } from "@/hooks/useSettings";
import { hasEnabledDevOpsPlugins } from "@/lib/dev_ops_plugins";

const mainNavItems = [
  { title: "Chat Agent", to: "/chat-agent", icon: MessageSquare },
  { title: "Planner", to: "/planner", icon: CalendarDays },
  // Memory sits under the agents that use it. The Knowledge Core and
  // Knowledge Base live inside.
  { title: "Memory", to: "/memory", icon: Brain },
  // Agents and Build sit directly under the coding agent, which is where
  // the build tools belong together.
  { title: "Agents", to: "/agents", icon: Bot },
  { title: "Build", to: "/build", icon: DraftingCompass },
  { title: "Dev Ops", to: "/dev-ops", icon: GitFork },
  { title: "Library", to: "/library", icon: BookOpen },
  // Storage keeps its own rail entry as well as its place under System, and
  // the coding projects gallery now lives inside it.
  { title: "Storage", to: "/storage", icon: HardDrive },
] satisfies Array<{
  title: AppSidebarItemTitle;
  to: string;
  icon: ComponentType<{ className?: string }>;
}>;

/**
 * System sits where the settings gear used to.
 *
 * There is only one place to configure anything now, so there is only one
 * entry for it. Keeping both would have been two doors into the same room.
 */
const settingsNavItem = {
  title: "System" as const,
  to: "/system",
  icon: Cpu,
};

type AppSidebarItemTo =
  | (typeof mainNavItems)[number]["to"]
  | typeof settingsNavItem.to;

function AppSidebarNavItem({
  icon: Icon,
  label,
  isExpanded,
  isActive = false,
  to,
  onClick,
}: {
  icon: LucideIcon | ComponentType<{ className?: string }>;
  label: string;
  isExpanded: boolean;
  isActive?: boolean;
  to?: AppSidebarItemTo;
  onClick?: () => void;
}) {
  const className = cn(
    "flex items-center rounded-lg text-sidebar-foreground outline-none transition-colors",
    "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
    "focus-visible:ring-2 focus-visible:ring-sidebar-ring",
    isActive && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
    isExpanded
      ? "h-10 w-full gap-3 px-3 text-sm"
      : "mx-auto size-10 justify-center",
  );

  const content = (
    <>
      <Icon className={cn("size-5 shrink-0", isActive && "text-primary")} />
      {isExpanded && <span className="truncate">{label}</span>}
    </>
  );

  const node = to ? (
    <Link to={to} aria-label={label} className={className}>
      {content}
    </Link>
  ) : (
    <button
      type="button"
      aria-label={label}
      className={className}
      onClick={onClick}
    >
      {content}
    </button>
  );

  if (isExpanded) {
    return node;
  }

  return (
    <Tooltip>
      <TooltipTrigger render={node} />
      <TooltipContent side="right" align="center">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function AppSidebar() {
  const { state } = useSidebar();
  const isExpanded = state === "expanded";
  const { settings } = useSettings();
  const showDevOps = hasEnabledDevOpsPlugins(settings);

  const routerState = useRouterState();
  const pathname = routerState.location.pathname;

  return (
    <Sidebar collapsible="icon" className="shadow-lg">
      <SidebarHeader
        className={cn(
          "mt-[calc(var(--layout-title-bar-offset)+0.25rem)] min-h-10 px-2 pb-0",
          !isExpanded && "items-center",
        )}
      />

      <SidebarContent className="gap-0 overflow-hidden px-2">
        <SidebarGroup className="py-2">
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {mainNavItems
                .filter((item) => item.title !== "Dev Ops" || showDevOps)
                .map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <AppSidebarNavItem
                      icon={item.icon}
                      label={item.title}
                      to={item.to}
                      isExpanded={isExpanded}
                      isActive={isSidebarItemActive({
                        title: item.title,
                        pathname,
                      })}
                    />
                  </SidebarMenuItem>
                ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="mt-auto px-2 pb-3">
        <SidebarMenu className="gap-0.5">
          <SidebarMenuItem>
            <AppSidebarNavItem
              icon={settingsNavItem.icon}
              label={settingsNavItem.title}
              to={settingsNavItem.to}
              isExpanded={isExpanded}
              isActive={isSidebarItemActive({
                title: settingsNavItem.title,
                pathname,
              })}
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

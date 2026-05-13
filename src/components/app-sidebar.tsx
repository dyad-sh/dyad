import {
  type LucideIcon,
  Home,
  Inbox,
  Settings,
  HelpCircle,
  Store,
  BookOpen,
} from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useSidebar } from "@/components/ui/sidebar"; // import useSidebar hook
import { useEffect, useRef, useState } from "react";
import { useAtom } from "jotai";
import { dropdownOpenAtom } from "@/atoms/uiAtoms";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { ChatList } from "./ChatList";
import { AppList } from "./AppList";
import { HelpDialog } from "./HelpDialog"; // Import the new dialog
import { SettingsList } from "./SettingsList";
import { LibraryList } from "./LibraryList";

// Menu items.
const items = [
  {
    title: "Apps",
    to: "/",
    icon: Home,
  },
  {
    title: "Chat",
    to: "/chat",
    icon: Inbox,
  },
  {
    title: "Settings",
    to: "/settings",
    icon: Settings,
  },
  {
    title: "Library",
    to: "/library",
    icon: BookOpen,
  },
  {
    title: "Hub",
    to: "/hub",
    icon: Store,
  },
];

type AppSidebarItemTo = (typeof items)[number]["to"];

function AppSidebarRailButton({
  icon: Icon,
  label,
  isExpanded,
  isActive = false,
  to,
  onClick,
  onMouseEnter,
}: {
  icon: LucideIcon;
  label: string;
  isExpanded: boolean;
  isActive?: boolean;
  to?: AppSidebarItemTo;
  onClick?: () => void;
  onMouseEnter?: () => void;
}) {
  const className = cn(
    "group/rail-button relative mb-1 flex h-10 items-center justify-center rounded-xl outline-none transition-[width,background-color] duration-200 ease-linear focus-visible:ring-2 focus-visible:ring-sidebar-ring",
    isExpanded ? "w-14" : "w-10",
    isActive
      ? "bg-primary/15"
      : "hover:bg-sidebar-accent active:bg-sidebar-accent",
  );
  const content = (
    <>
      <span
        className={cn(
          "absolute left-1/2 -translate-x-1/2 -translate-y-1/2 transition-[top] duration-200 ease-linear",
          isExpanded ? "top-[42%]" : "top-1/2",
        )}
      >
        <Icon className={cn("size-5", isActive && "text-primary")} />
      </span>
      <span
        className={cn(
          "pointer-events-none absolute bottom-0.5 left-1/2 max-w-[calc(100%-0.5rem)] -translate-x-1/2 truncate text-[10px] leading-3 transition-[opacity,transform] duration-200 ease-linear",
          isExpanded ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
          isActive ? "font-medium text-primary" : "text-sidebar-foreground/80",
        )}
      >
        {label}
      </span>
    </>
  );

  if (to) {
    return (
      <Link
        to={to}
        aria-label={label}
        className={className}
        onMouseEnter={onMouseEnter}
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      aria-label={label}
      className={className}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      {content}
    </button>
  );
}

// Hover state types
type HoverState =
  | "start-hover:app"
  | "start-hover:chat"
  | "start-hover:settings"
  | "start-hover:library"
  | "clear-hover"
  | "no-hover";

export function AppSidebar() {
  const { state, toggleSidebar } = useSidebar();
  const [hoverState, setHoverState] = useState<HoverState>("no-hover");
  const expandedByHover = useRef(false);
  const [isHelpDialogOpen, setIsHelpDialogOpen] = useState(false);
  const [isDropdownOpen] = useAtom(dropdownOpenAtom);

  useEffect(() => {
    if (hoverState.startsWith("start-hover") && state === "collapsed") {
      expandedByHover.current = true;
      toggleSidebar();
    }
    if (
      hoverState === "clear-hover" &&
      state === "expanded" &&
      expandedByHover.current &&
      !isDropdownOpen
    ) {
      toggleSidebar();
      expandedByHover.current = false;
      setHoverState("no-hover");
    }
  }, [hoverState, toggleSidebar, state, setHoverState, isDropdownOpen]);

  const routerState = useRouterState();
  const isAppRoute =
    routerState.location.pathname === "/" ||
    routerState.location.pathname.startsWith("/app-details");
  const isChatRoute = routerState.location.pathname === "/chat";
  const isSettingsRoute = routerState.location.pathname.startsWith("/settings");
  const isLibraryRoute = routerState.location.pathname.startsWith("/library");

  let selectedItem: string | null = null;
  if (hoverState === "start-hover:app") {
    selectedItem = "Apps";
  } else if (hoverState === "start-hover:chat") {
    selectedItem = "Chat";
  } else if (hoverState === "start-hover:settings") {
    selectedItem = "Settings";
  } else if (hoverState === "start-hover:library") {
    selectedItem = "Library";
  } else if (state === "expanded") {
    if (isAppRoute) {
      selectedItem = "Apps";
    } else if (isChatRoute) {
      selectedItem = "Chat";
    } else if (isSettingsRoute) {
      selectedItem = "Settings";
    } else if (isLibraryRoute) {
      selectedItem = "Library";
    }
  }

  return (
    <Sidebar
      collapsible="icon"
      className="shadow-lg"
      onMouseLeave={() => {
        if (!isDropdownOpen) {
          setHoverState("clear-hover");
        }
      }}
    >
      <SidebarContent className="overflow-hidden">
        <div className="flex mt-8">
          {/* Left Column: Icon rail */}
          <div
            className={`px-1 transition-[width] duration-200 ease-linear ${
              state === "expanded" ? "w-16" : "w-12"
            }`}
          >
            <SidebarTrigger
              onMouseEnter={() => {
                setHoverState("clear-hover");
              }}
            />
            <AppIcons
              onHoverChange={setHoverState}
              isExpanded={state === "expanded"}
            />
          </div>
          {/* Right Column: Contextual sub-list (only visible when expanded) */}
          <div className="w-[224px] border-l border-sidebar-border">
            <AppList show={selectedItem === "Apps"} />
            <ChatList show={selectedItem === "Chat"} />
            <SettingsList show={selectedItem === "Settings"} />
            <LibraryList show={selectedItem === "Library"} />
          </div>
        </div>
      </SidebarContent>

      <SidebarFooter className="px-1 items-start">
        <SidebarMenu>
          <SidebarMenuItem>
            <AppSidebarRailButton
              icon={HelpCircle}
              label="Help"
              isExpanded={state === "expanded"}
              onClick={() => setIsHelpDialogOpen(true)}
            />
            <HelpDialog
              isOpen={isHelpDialogOpen}
              onClose={() => setIsHelpDialogOpen(false)}
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

function AppIcons({
  onHoverChange,
  isExpanded,
}: {
  onHoverChange: (state: HoverState) => void;
  isExpanded: boolean;
}) {
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;

  const hoverForTitle = (title: string): HoverState => {
    switch (title) {
      case "Apps":
        return "start-hover:app";
      case "Chat":
        return "start-hover:chat";
      case "Settings":
        return "start-hover:settings";
      case "Library":
        return "start-hover:library";
      default:
        // Items without a sub-list (e.g. Hub) dismiss any open preview so a
        // stale list doesn't linger while hovering an unrelated icon.
        return "clear-hover";
    }
  };

  return (
    <SidebarGroup className="p-0 py-2">
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const isActive =
              (item.to === "/" && pathname === "/") ||
              (item.to !== "/" && pathname.startsWith(item.to));

            return (
              <SidebarMenuItem key={item.title}>
                <AppSidebarRailButton
                  icon={item.icon}
                  label={item.title}
                  to={item.to}
                  isActive={isActive}
                  isExpanded={isExpanded}
                  onMouseEnter={() => onHoverChange(hoverForTitle(item.title))}
                />
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

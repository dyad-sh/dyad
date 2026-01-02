import {
  Home,
  MessageSquare,
  Settings,
  HelpCircle,
  Store,
  BookOpen,
  Bot,
  Workflow,
  Shield,
  Sparkles,
  PanelLeftClose,
  PanelLeft,
  Plus,
} from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useSidebar } from "@/components/ui/sidebar";
import { useEffect, useState, useRef } from "react";
import { useAtom } from "jotai";
import { dropdownOpenAtom } from "@/atoms/uiAtoms";
import { cn } from "@/lib/utils";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { ChatList } from "./ChatList";
import { AppList } from "./AppList";
import { HelpDialog } from "./HelpDialog";
import { SettingsList } from "./SettingsList";
import { Button } from "./ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Menu items - Lovable style navigation
const navItems = [
  {
    title: "Apps",
    to: "/",
    icon: Home,
    gradient: "from-blue-500 to-indigo-500",
    hoverBg: "hover:bg-blue-500/10",
    activeBg: "bg-blue-500/15",
    activeText: "text-blue-600 dark:text-blue-400",
  },
  {
    title: "Agents",
    to: "/agents",
    icon: Bot,
    gradient: "from-violet-500 to-purple-500",
    hoverBg: "hover:bg-violet-500/10",
    activeBg: "bg-violet-500/15",
    activeText: "text-violet-600 dark:text-violet-400",
  },
  {
    title: "Workflows",
    to: "/workflows",
    icon: Workflow,
    gradient: "from-orange-500 to-amber-500",
    hoverBg: "hover:bg-orange-500/10",
    activeBg: "bg-orange-500/15",
    activeText: "text-orange-600 dark:text-orange-400",
  },
  {
    title: "Local AI",
    to: "/local-models",
    icon: Shield,
    gradient: "from-emerald-500 to-teal-500",
    hoverBg: "hover:bg-emerald-500/10",
    activeBg: "bg-emerald-500/15",
    activeText: "text-emerald-600 dark:text-emerald-400",
  },
  {
    title: "Chat",
    to: "/chat",
    icon: MessageSquare,
    gradient: "from-cyan-500 to-blue-500",
    hoverBg: "hover:bg-cyan-500/10",
    activeBg: "bg-cyan-500/15",
    activeText: "text-cyan-600 dark:text-cyan-400",
  },
  {
    title: "Library",
    to: "/library",
    icon: BookOpen,
    gradient: "from-amber-500 to-yellow-500",
    hoverBg: "hover:bg-amber-500/10",
    activeBg: "bg-amber-500/15",
    activeText: "text-amber-600 dark:text-amber-400",
  },
  {
    title: "Hub",
    to: "/hub",
    icon: Store,
    gradient: "from-pink-500 to-rose-500",
    hoverBg: "hover:bg-pink-500/10",
    activeBg: "bg-pink-500/15",
    activeText: "text-pink-600 dark:text-pink-400",
  },
];

const bottomItems = [
  {
    title: "Settings",
    to: "/settings",
    icon: Settings,
    hoverBg: "hover:bg-gray-500/10",
    activeBg: "bg-gray-500/15",
    activeText: "text-gray-600 dark:text-gray-400",
  },
];

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
  const isCollapsed = state === "collapsed";

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
  const pathname = routerState.location.pathname;
  const isAppRoute = pathname === "/" || pathname.startsWith("/app-details");
  const isChatRoute = pathname === "/chat";
  const isSettingsRoute = pathname.startsWith("/settings");

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
    if (isAppRoute) selectedItem = "Apps";
    else if (isChatRoute) selectedItem = "Chat";
    else if (isSettingsRoute) selectedItem = "Settings";
  }

  return (
    <Sidebar
      collapsible="icon"
      onMouseLeave={() => {
        if (!isDropdownOpen) {
          setHoverState("clear-hover");
        }
      }}
      className="border-r-0"
    >
      {/* Main sidebar with glass effect */}
      <div className="flex h-full flex-col bg-gradient-to-b from-background/95 via-background/90 to-background/95 backdrop-blur-xl">
        {/* Logo Header */}
        <div className="flex h-16 items-center justify-between px-4 border-b border-border/50">
          <Link to="/" className="flex items-center gap-3 group">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl blur-md opacity-50 group-hover:opacity-75 transition-opacity" />
              <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
            </div>
            <span className={cn(
              "font-bold text-xl tracking-tight transition-all duration-200",
              "bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 bg-clip-text text-transparent",
              isCollapsed && "opacity-0 w-0"
            )}>
              JoyCreate
            </span>
          </Link>
          
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleSidebar}
                className={cn(
                  "h-8 w-8 rounded-lg hover:bg-muted/80 transition-all",
                  isCollapsed && "absolute right-2"
                )}
              >
                {isCollapsed ? (
                  <PanelLeft className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <PanelLeftClose className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            </TooltipContent>
          </Tooltip>
        </div>

        <SidebarContent className="flex-1 overflow-hidden px-2 py-3">
          <div className="flex h-full">
            {/* Left Column: Navigation Icons */}
            <div className="flex flex-col w-[60px] shrink-0">
              {/* Quick Actions */}
              <div className="mb-4 px-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      className={cn(
                        "w-full h-10 rounded-xl",
                        "bg-gradient-to-r from-violet-500/10 to-purple-500/10",
                        "hover:from-violet-500/20 hover:to-purple-500/20",
                        "border border-violet-500/20 hover:border-violet-500/40",
                        "transition-all duration-200",
                        isCollapsed ? "justify-center px-0" : "justify-start px-3"
                      )}
                    >
                      <Plus className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                      {!isCollapsed && (
                        <span className="ml-2 text-sm font-medium text-violet-600 dark:text-violet-400">New</span>
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">Create new project</TooltipContent>
                </Tooltip>
              </div>

              {/* Main Navigation */}
              <SidebarGroup className="px-0">
                <SidebarGroupContent>
                  <SidebarMenu className="space-y-1">
                    {navItems.map((item) => {
                      const isActive =
                        (item.to === "/" && pathname === "/") ||
                        (item.to !== "/" && pathname.startsWith(item.to));

                      return (
                        <SidebarMenuItem key={item.title}>
                          <Tooltip delayDuration={0}>
                            <TooltipTrigger asChild>
                              <SidebarMenuButton asChild className="p-0">
                                <Link
                                  to={item.to}
                                  className={cn(
                                    "flex items-center gap-3 w-full rounded-xl px-3 py-2.5 transition-all duration-200",
                                    isActive
                                      ? cn(item.activeBg, "shadow-sm")
                                      : cn("hover:bg-muted/60", item.hoverBg)
                                  )}
                                  onMouseEnter={() => {
                                    if (item.title === "Apps") setHoverState("start-hover:app");
                                    else if (item.title === "Chat") setHoverState("start-hover:chat");
                                    else if (item.title === "Settings") setHoverState("start-hover:settings");
                                    else if (item.title === "Library") setHoverState("start-hover:library");
                                  }}
                                >
                                  <div className={cn(
                                    "relative flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-200",
                                    isActive && `bg-gradient-to-br ${item.gradient} shadow-md`
                                  )}>
                                    <item.icon className={cn(
                                      "h-[18px] w-[18px] transition-colors duration-200",
                                      isActive ? "text-white" : "text-muted-foreground"
                                    )} />
                                  </div>
                                  <span className={cn(
                                    "text-sm font-medium transition-all duration-200",
                                    isActive ? item.activeText : "text-muted-foreground",
                                    isCollapsed && "opacity-0 w-0 overflow-hidden"
                                  )}>
                                    {item.title}
                                  </span>
                                </Link>
                              </SidebarMenuButton>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="font-medium">
                              {item.title}
                            </TooltipContent>
                          </Tooltip>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>

              {/* Spacer */}
              <div className="flex-1" />

              {/* Bottom Navigation */}
              <SidebarGroup className="px-0 mt-auto">
                <SidebarGroupContent>
                  <SidebarMenu className="space-y-1">
                    {bottomItems.map((item) => {
                      const isActive = pathname.startsWith(item.to);

                      return (
                        <SidebarMenuItem key={item.title}>
                          <Tooltip delayDuration={0}>
                            <TooltipTrigger asChild>
                              <SidebarMenuButton asChild className="p-0">
                                <Link
                                  to={item.to}
                                  className={cn(
                                    "flex items-center gap-3 w-full rounded-xl px-3 py-2.5 transition-all duration-200",
                                    isActive
                                      ? cn(item.activeBg, "shadow-sm")
                                      : cn("hover:bg-muted/60", item.hoverBg)
                                  )}
                                  onMouseEnter={() => {
                                    if (item.title === "Settings") setHoverState("start-hover:settings");
                                  }}
                                >
                                  <div className={cn(
                                    "relative flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-200",
                                    isActive && "bg-muted"
                                  )}>
                                    <item.icon className={cn(
                                      "h-[18px] w-[18px] transition-colors duration-200",
                                      isActive ? item.activeText : "text-muted-foreground"
                                    )} />
                                  </div>
                                  <span className={cn(
                                    "text-sm font-medium transition-all duration-200",
                                    isActive ? item.activeText : "text-muted-foreground",
                                    isCollapsed && "opacity-0 w-0 overflow-hidden"
                                  )}>
                                    {item.title}
                                  </span>
                                </Link>
                              </SidebarMenuButton>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="font-medium">
                              {item.title}
                            </TooltipContent>
                          </Tooltip>
                        </SidebarMenuItem>
                      );
                    })}

                    {/* Help Button */}
                    <SidebarMenuItem>
                      <Tooltip delayDuration={0}>
                        <TooltipTrigger asChild>
                          <SidebarMenuButton
                            className={cn(
                              "flex items-center gap-3 w-full rounded-xl px-3 py-2.5 transition-all duration-200",
                              "hover:bg-muted/60"
                            )}
                            onClick={() => setIsHelpDialogOpen(true)}
                          >
                            <div className="relative flex items-center justify-center w-8 h-8 rounded-lg">
                              <HelpCircle className="h-[18px] w-[18px] text-muted-foreground" />
                            </div>
                            <span className={cn(
                              "text-sm font-medium text-muted-foreground transition-all duration-200",
                              isCollapsed && "opacity-0 w-0 overflow-hidden"
                            )}>
                              Help
                            </span>
                          </SidebarMenuButton>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="font-medium">
                          Help & Support
                        </TooltipContent>
                      </Tooltip>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </div>

            {/* Right Column: Expandable Content Panel */}
            <div className={cn(
              "flex-1 overflow-hidden transition-all duration-200 pl-2",
              isCollapsed ? "w-0 opacity-0" : "w-[200px] opacity-100"
            )}>
              <div className="h-full rounded-xl bg-muted/30 border border-border/50 overflow-hidden">
                <AppList show={selectedItem === "Apps"} />
                <ChatList show={selectedItem === "Chat"} />
                <SettingsList show={selectedItem === "Settings"} />
              </div>
            </div>
          </div>
        </SidebarContent>

        {/* Footer */}
        <SidebarFooter className="border-t border-border/50 p-3">
          <div className={cn(
            "flex items-center gap-2 px-2 py-1.5 rounded-lg bg-muted/30",
            isCollapsed && "justify-center"
          )}>
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            {!isCollapsed && (
              <span className="text-xs text-muted-foreground">All systems operational</span>
            )}
          </div>
        </SidebarFooter>
      </div>

      <HelpDialog
        isOpen={isHelpDialogOpen}
        onClose={() => setIsHelpDialogOpen(false)}
      />

      <SidebarRail />
    </Sidebar>
  );
}

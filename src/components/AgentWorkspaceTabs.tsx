import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  LayoutDashboard,
  MapPin,
  MessageSquare,
  X,
} from "lucide-react";
import { useAtom, useAtomValue } from "jotai";
import {
  Link,
  useNavigate,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import {
  activeAgentWorkspaceTabAtom,
  hermesDashboardTabOpenAtom,
  agentWorkspaceTabsAtom,
  activeChatAgentTabAtom,
  chatAgentOpenTabsAtom,
  busyChatSessionsAtom,
} from "@/atoms/chatAgentAtoms";
import { closeHermesWorkspaceTab } from "@/lib/hermes_workspace_tabs";
import { closeChatAgentTab } from "@/lib/chat_agent_tabs";
import { useScreenTabs } from "@/hooks/useScreenTabs";
import {
  HOME_PATH,
  navigationTitleForPath,
  screenForPath,
} from "@/lib/workspace_screens";
import { cn } from "@/lib/utils";
import { ChatTabs } from "@/components/chat/ChatTabs";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";

function TabAvatar({ icon, name }: { icon: string; name: string }) {
  const isImage =
    icon.startsWith("data:image/") ||
    icon.startsWith("blob:") ||
    /^https?:\/\//i.test(icon);
  return (
    <span className="grid size-5 shrink-0 place-items-center overflow-hidden rounded-md border border-border/70 bg-primary/10 text-[10px] text-primary">
      {isImage ? (
        <img src={icon} alt="" className="size-full object-cover" />
      ) : (
        <span aria-label={`${name} avatar`} role="img">
          {icon || name.charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}

export function AgentWorkspaceTabs() {
  const [tabs, setTabs] = useAtom(agentWorkspaceTabsAtom);
  const [activeTab, setActiveTab] = useAtom(activeAgentWorkspaceTabAtom);
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const historyIndex = useRouterState({
    select: (state) => state.location.state.__TSR_index ?? 0,
  });
  const navigate = useNavigate();
  const router = useRouter();
  const isAgentWorkspace = pathname.startsWith("/agent-os");

  const canGoBack = router.history.canGoBack();
  const canGoForward = historyIndex < router.history.length - 1;
  const currentLocationTitle = navigationTitleForPath(pathname);
  const lastLocationRef = useRef({
    path: pathname,
    title: currentLocationTitle,
  });
  const [previousLocation, setPreviousLocation] = useState<{
    path: string;
    title: string;
  } | null>(null);

  // Keep the origin visible after navigation. This is intentionally session
  // history rather than persisted workspace state: after a restart there is no
  // meaningful page the user just came from.
  useEffect(() => {
    if (lastLocationRef.current.path === pathname) return;
    setPreviousLocation(lastLocationRef.current);
    lastLocationRef.current = { path: pathname, title: currentLocationTitle };
  }, [pathname, currentLocationTitle]);

  // Chat Agent conversations live in this same bar rather than a second one
  // stacked inside the page.
  const [chatTabs, setChatTabs] = useAtom(chatAgentOpenTabsAtom);
  const busySessions = useAtomValue(busyChatSessionsAtom);
  // Coder chats are a family in this bar rather than a second row above it.
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const [activeChatId, setActiveChatId] = useAtom(activeChatAgentTabAtom);
  // "/" is the dashboard now, so only the chat agent's own route counts.
  const isChatAgent = pathname.startsWith("/chat-agent");

  // Every other screen — Helix, Settings, Knowledge Base — also keeps a tab.
  const {
    tabs: screenTabs,
    activeScreen,
    close: closeScreen,
  } = useScreenTabs();

  const [dashboardTabOpen, setDashboardTabOpen] = useAtom(
    hermesDashboardTabOpenAtom,
  );
  // Visiting Agent OS reopens its own tab: a screen you are looking at should
  // always have a tab, the same as every other screen in this bar.
  useEffect(() => {
    if (isAgentWorkspace) setDashboardTabOpen(true);
  }, [isAgentWorkspace, setDashboardTabOpen]);

  const closeScreenAndLeave = (path: string) => {
    const fallback = closeScreen(path);
    // Closing the screen being viewed has to go somewhere; a browser moves to
    // the neighbouring tab, and the dashboard is the home surface when there is
    // no neighbour left.
    if (fallback) {
      void navigate({ to: fallback.path });
    } else if (activeScreen?.path === path) {
      void navigate({ to: HOME_PATH });
    }
  };

  const closeChat = (tabId: string) => {
    const { tabs: remaining, fallback } = closeChatAgentTab(chatTabs, tabId);
    setChatTabs(remaining);
    if (activeChatId !== tabId) return;

    setActiveChatId(fallback?.id ?? null);
    // Closing the last conversation while looking at it should reveal another
    // open workspace tab. Going straight home made the closed Chat Agent tab
    // race its unmount sync and appear to reopen itself.
    if (!fallback && isChatAgent) {
      const screenFallback = screenTabs.at(-1);
      if (screenFallback) {
        void navigate({ to: screenFallback.path });
      } else if (tabs.length > 0 || dashboardTabOpen) {
        void navigate({ to: "/agent-os" });
      } else {
        void navigate({ to: HOME_PATH });
      }
    }
  };

  const activate = (tabId: string) => {
    setActiveTab(tabId);
  };

  const closeDashboardTab = () => {
    setDashboardTabOpen(false);
    if (!isAgentWorkspace) return;
    // Closing the tab you are on has to go somewhere. A neighbouring agent
    // chat if there is one, and otherwise the section this screen lives in.
    if (tabs.length > 0) {
      setActiveTab(tabs[0].id);
    } else {
      void navigate({ to: "/agents" });
    }
  };

  const closeTab = (tabId: string) => {
    const ids = tabs.map((tab) => tab.id);
    const next = closeHermesWorkspaceTab(ids, tabId, activeTab);
    setTabs((current) => current.filter((tab) => tab.id !== tabId));
    setActiveTab(next.activeTab);
  };

  return (
    <div
      className="no-app-region-drag flex h-11 shrink-0 border-b border-border/70 bg-background/92 backdrop-blur-xl"
      data-testid="agent-workspace-tabs"
    >
      <nav
        aria-label="Navigation history"
        className="flex h-full max-w-[24rem] shrink-0 items-center gap-1 border-r border-border/60 px-2"
        data-testid="workspace-navigation-history"
      >
        <button
          type="button"
          onClick={() => router.history.back()}
          disabled={!canGoBack}
          className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted/70 hover:text-foreground active:scale-95 disabled:pointer-events-none disabled:opacity-30"
          aria-label="Go back"
          title="Go back"
          data-testid="workspace-go-back"
        >
          <ArrowLeft className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => router.history.forward()}
          disabled={!canGoForward}
          className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted/70 hover:text-foreground active:scale-95 disabled:pointer-events-none disabled:opacity-30"
          aria-label="Go forward"
          title="Go forward"
          data-testid="workspace-go-forward"
        >
          <ArrowRight className="size-4" />
        </button>

        <div className="ml-1 flex min-w-0 items-center gap-1 text-xs">
          {previousLocation && canGoBack && (
            <>
              <button
                type="button"
                onClick={() => router.history.back()}
                className="hidden max-w-28 truncate rounded-md px-1.5 py-1 text-muted-foreground transition hover:bg-muted/65 hover:text-foreground lg:block"
                title={`Back to ${previousLocation.title}`}
                data-testid="workspace-previous-location"
              >
                {previousLocation.title}
              </button>
              <ChevronRight className="hidden size-3.5 shrink-0 text-muted-foreground/55 lg:block" />
            </>
          )}
          <div
            className="flex min-w-0 items-center gap-1.5 rounded-md bg-primary/8 px-2 py-1 text-foreground ring-1 ring-inset ring-primary/15"
            aria-current="page"
            title={`Current location: ${currentLocationTitle}`}
            data-testid="workspace-current-location"
          >
            <MapPin className="size-3 shrink-0 text-primary" />
            <span className="max-w-32 truncate font-medium">
              {currentLocationTitle}
            </span>
          </div>
        </div>
      </nav>

      <nav
        aria-label="Open tabs"
        className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto px-2 pt-1.5 scrollbar-on-hover"
      >
        {dashboardTabOpen && (
          <div
            className={cn(
              "flex h-9 shrink-0 items-center rounded-t-lg border border-b-0 text-xs font-medium transition-colors",
              isAgentWorkspace && activeTab === "dashboard"
                ? "border-border bg-muted text-foreground"
                : "border-transparent text-muted-foreground hover:bg-muted/55 hover:text-foreground",
            )}
          >
            <Link
              to="/agent-os"
              onClick={() => activate("dashboard")}
              className="flex h-full items-center gap-2 pl-3 pr-1"
              data-testid="hermes-dashboard-tab"
            >
              <LayoutDashboard className="size-3.5" />
              Dashboard
            </Link>
            <button
              type="button"
              onClick={closeDashboardTab}
              className="mr-1 grid size-6 place-items-center rounded-md text-current opacity-50 transition hover:bg-foreground/8 hover:opacity-100"
              aria-label="Close Dashboard"
              data-testid="hermes-close-dashboard-tab"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {tabs.map((tab) => {
          const isActive = isAgentWorkspace && activeTab === tab.id;
          return (
            <div
              key={tab.id}
              className={cn(
                "flex h-9 shrink-0 items-center rounded-t-lg border border-b-0 transition-colors",
                isActive
                  ? "border-primary/30 bg-primary/10 text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-muted/55 hover:text-foreground",
              )}
            >
              <Link
                to="/agent-os"
                onClick={() => activate(tab.id)}
                className="flex h-full min-w-0 items-center gap-2 pl-2.5 pr-1"
                data-testid={`hermes-chat-tab-${tab.id}`}
              >
                <TabAvatar icon={tab.icon} name={tab.name} />
                <span className="max-w-36 truncate text-xs font-medium">
                  {tab.name}
                </span>
              </Link>
              <button
                type="button"
                onClick={() => closeTab(tab.id)}
                className="mr-1 grid size-6 place-items-center rounded-md text-current opacity-50 transition hover:bg-foreground/8 hover:opacity-100"
                aria-label={`Close ${tab.name} chat`}
                data-testid={`hermes-close-tab-${tab.id}`}
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}

        {chatTabs.map((tab) => {
          const isActive = isChatAgent && activeChatId === tab.id;
          const title = tab.title?.trim() || "New conversation";
          const isBusy = busySessions.includes(tab.id);
          return (
            <div
              key={tab.id}
              className={cn(
                "flex h-9 shrink-0 items-center rounded-t-lg border border-b-0 transition-colors",
                isActive
                  ? "border-primary/30 bg-primary/10 text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-muted/55 hover:text-foreground",
              )}
            >
              <Link
                to="/chat-agent"
                onClick={() => setActiveChatId(tab.id)}
                className="flex h-full min-w-0 items-center gap-2 pr-1 pl-2.5"
                data-testid={`chat-agent-tab-${tab.id}`}
              >
                {/* A working tab shows a pulse in place of its icon, so an
                  answer arriving offscreen is still visible. */}
                {isBusy ? (
                  <span
                    className="chat-tab-busy-dot shrink-0"
                    role="status"
                    aria-label={`${title} is still responding`}
                  />
                ) : (
                  <MessageSquare className="size-3.5 shrink-0 opacity-65" />
                )}
                <span className="max-w-36 truncate text-xs font-medium">
                  {title}
                </span>
              </Link>
              <button
                type="button"
                onClick={() => closeChat(tab.id)}
                className="mr-1 grid size-6 place-items-center rounded-md text-current opacity-50 transition hover:bg-foreground/8 hover:opacity-100"
                aria-label={`Close ${title}`}
                data-testid={`chat-agent-close-tab-${tab.id}`}
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}

        {screenTabs.map((tab) => {
          const screen = screenForPath(tab.path);
          const Icon = screen?.icon ?? LayoutDashboard;
          const isActive = activeScreen?.path === tab.path;
          return (
            <div
              key={tab.path}
              className={cn(
                "flex h-9 shrink-0 items-center rounded-t-lg border border-b-0 transition-colors",
                isActive
                  ? "border-primary/30 bg-primary/10 text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-muted/55 hover:text-foreground",
              )}
            >
              <Link
                to={tab.path}
                className="flex h-full min-w-0 items-center gap-2 pl-2.5 pr-1"
                data-testid={`screen-tab-${tab.path}`}
              >
                <Icon className="size-3.5 shrink-0 opacity-65" />
                <span className="max-w-36 truncate text-xs font-medium">
                  {tab.title}
                </span>
              </Link>
              <button
                type="button"
                onClick={() => closeScreenAndLeave(tab.path)}
                className="mr-1 grid size-6 place-items-center rounded-md text-current opacity-50 transition hover:bg-foreground/8 hover:opacity-100"
                aria-label={`Close ${tab.title}`}
                data-testid={`screen-close-tab-${tab.path}`}
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}

        {/* Coder chats: the original dyad tab strip, now inside the one bar
          instead of a second row stacked above it in the title bar. */}
        <div
          className="flex min-w-0 flex-1 items-end self-end"
          data-testid="coder-chat-tabs"
        >
          <ChatTabs selectedChatId={selectedChatId} />
        </div>
      </nav>
    </div>
  );
}

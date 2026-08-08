import { LayoutDashboard, MessageSquare, Monitor, X } from "lucide-react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  activeAgentWorkspaceTabAtom,
  agentWorkspaceTabsAtom,
  activeChatAgentTabAtom,
  chatAgentOpenTabsAtom,
  busyChatSessionsAtom,
} from "@/atoms/chatAgentAtoms";
import { closeHermesWorkspaceTab } from "@/lib/hermes_workspace_tabs";
import { closeChatAgentTab } from "@/lib/chat_agent_tabs";
import { useScreenTabs } from "@/hooks/useScreenTabs";
import { screenForPath } from "@/lib/workspace_screens";
import { desktopModeAtom } from "@/atoms/desktopAtoms";
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
  const navigate = useNavigate();
  const isAgentWorkspace = pathname.startsWith("/agent-os");

  // Chat Agent conversations live in this same bar rather than a second one
  // stacked inside the page.
  const [chatTabs, setChatTabs] = useAtom(chatAgentOpenTabsAtom);
  const busySessions = useAtomValue(busyChatSessionsAtom);
  // Coder chats are a family in this bar rather than a second row above it.
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const [activeChatId, setActiveChatId] = useAtom(activeChatAgentTabAtom);
  const isChatAgent = pathname === "/" || pathname.startsWith("/chat-agent");

  // Every other screen — Helix, Settings, Knowledge Base — also keeps a tab.
  const {
    tabs: screenTabs,
    activeScreen,
    close: closeScreen,
  } = useScreenTabs();
  const setDesktopMode = useSetAtom(desktopModeAtom);

  const closeScreenAndLeave = (path: string) => {
    const fallback = closeScreen(path);
    // Closing the screen being viewed has to go somewhere; a browser moves to
    // the neighbouring tab, and Chat is the equivalent of a new tab page.
    if (fallback) {
      void navigate({ to: fallback.path });
    } else if (activeScreen?.path === path) {
      void navigate({ to: "/chat-agent" });
    }
  };

  // A coder chat is enough on its own to warrant the bar, so this no longer
  // hides the row that now carries them.
  const isCoderWorkspace =
    pathname.startsWith("/chat") || pathname.startsWith("/coder");

  if (
    !isAgentWorkspace &&
    !isChatAgent &&
    !isCoderWorkspace &&
    tabs.length === 0 &&
    screenTabs.length === 0
  ) {
    return null;
  }

  const closeChat = (tabId: string) => {
    const { tabs: remaining, fallback } = closeChatAgentTab(chatTabs, tabId);
    setChatTabs(remaining);
    if (activeChatId === tabId) {
      setActiveChatId(fallback?.id ?? null);
    }
  };

  const activate = (tabId: string) => {
    setActiveTab(tabId);
  };

  const closeTab = (tabId: string) => {
    const ids = tabs.map((tab) => tab.id);
    const next = closeHermesWorkspaceTab(ids, tabId, activeTab);
    setTabs((current) => current.filter((tab) => tab.id !== tabId));
    setActiveTab(next.activeTab);
  };

  return (
    <nav
      aria-label="Open tabs"
      className="no-app-region-drag flex h-11 shrink-0 items-end gap-1 overflow-x-auto border-b border-border/70 bg-background/92 px-3 pt-1.5 backdrop-blur-xl scrollbar-on-hover"
      data-testid="agent-workspace-tabs"
    >
      <Link
        to="/agent-os"
        onClick={() => activate("dashboard")}
        className={cn(
          "flex h-9 shrink-0 items-center gap-2 rounded-t-lg border border-b-0 px-3 text-xs font-medium transition-colors",
          isAgentWorkspace && activeTab === "dashboard"
            ? "border-border bg-muted text-foreground"
            : "border-transparent text-muted-foreground hover:bg-muted/55 hover:text-foreground",
        )}
        data-testid="hermes-dashboard-tab"
      >
        <LayoutDashboard className="size-3.5" />
        Dashboard
      </Link>

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

      <button
        type="button"
        onClick={() => setDesktopMode(true)}
        className="mb-1 grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
        aria-label="Enter Desktop Mode"
        title="Desktop Mode (⌘⇧D)"
        data-testid="enter-desktop-mode"
      >
        <Monitor className="size-4" />
      </button>
    </nav>
  );
}

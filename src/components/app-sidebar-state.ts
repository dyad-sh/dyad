export type AppSidebarPanel = "Apps" | "Settings" | "Library";

export type AgentSidebarItemTitle = "Chat Agent" | "Coding Agent" | "Planner";

export type AppSidebarItemTitle =
  | AgentSidebarItemTitle
  | "Memory"
  | "Build"
  | "Agents"
  | "Dev Ops"
  | "System"
  | "Storage"
  | "Settings"
  | "Library";

const AGENT_ROUTES: Record<AgentSidebarItemTitle, string> = {
  "Chat Agent": "/chat-agent",
  "Coding Agent": "/coder",
  Planner: "/planner",
};

export function getAgentRoute(title: AgentSidebarItemTitle) {
  return AGENT_ROUTES[title];
}

export function isCodingAgentRoute(pathname: string) {
  return (
    pathname === "/coder" ||
    pathname.startsWith("/coder/") ||
    pathname.startsWith("/app-details") ||
    pathname === "/chat"
  );
}

/**
 * Routes where the Apps chat rail should open. The /coder agent selector and
 * the Helix workspace keep the rail closed for a focused screen (like Ops).
 */
export function isBuildStudioRoute(pathname: string) {
  return (
    pathname === "/coder/studio" ||
    pathname.startsWith("/app-details") ||
    pathname === "/chat"
  );
}

export function getRouteSidebarPanel(pathname: string): AppSidebarPanel | null {
  if (isBuildStudioRoute(pathname)) {
    return "Apps";
  }

  if (pathname.startsWith("/settings")) {
    return "Settings";
  }

  if (pathname.startsWith("/library")) {
    return "Library";
  }

  return null;
}

export function getSelectedSidebarPanel({
  sidebarState,
  pathname,
}: {
  sidebarState: "expanded" | "collapsed";
  pathname: string;
}): AppSidebarPanel | null {
  if (sidebarState === "expanded") {
    return getRouteSidebarPanel(pathname);
  }

  return null;
}

export function isSidebarItemActive({
  title,
  pathname,
}: {
  title: AppSidebarItemTitle;
  pathname: string;
}) {
  if (title === "Coding Agent") {
    return isCodingAgentRoute(pathname);
  }
  if (title === "Chat Agent" && pathname === "/") {
    return true;
  }
  if (title === "Planner" && pathname === "/social-media-agent") {
    return true;
  }
  if (title in AGENT_ROUTES) {
    const route = AGENT_ROUTES[title as AgentSidebarItemTitle];
    return pathname === route || pathname.startsWith(`${route}/`);
  }
  if (title === "Build") {
    // Engineering was renamed, and its path still resolves, so both light up
    // the same entry.
    return pathname.startsWith("/build") || pathname.startsWith("/engineering");
  }
  if (title === "Memory") {
    // Both knowledge screens live under Memory, so they light this entry.
    return (
      pathname.startsWith("/memory") ||
      pathname.startsWith("/knowledge-core") ||
      pathname.startsWith("/knowledge-base")
    );
  }
  if (title === "Settings") {
    return pathname.startsWith("/settings");
  }
  if (title === "Library") {
    return pathname.startsWith("/library");
  }
  if (title === "Agents") {
    // The index and the dashboard it categorises. The coding routes are also
    // reachable from here, but they keep lighting up Coding Agent, which is
    // where they have always lived in the rail.
    return pathname.startsWith("/agents") || pathname.startsWith("/agent-os");
  }
  if (title === "Dev Ops") {
    return (
      pathname.startsWith("/devops") ||
      pathname.startsWith("/dev-ops") ||
      pathname.startsWith("/github") ||
      pathname.startsWith("/vercel")
    );
  }
  if (title === "Storage") {
    // The projects gallery and the template hub live under Storage, so they
    // light this entry.
    return (
      pathname.startsWith("/storage") ||
      // The drive and the vector store are Storage destinations, so they light
      // Storage rather than System, which used to claim them.
      pathname.startsWith("/meta-hd") ||
      pathname.startsWith("/vector") ||
      pathname.startsWith("/apps") ||
      pathname.startsWith("/hub") ||
      pathname.startsWith("/local-storage")
    );
  }
  if (title === "System") {
    // Every technical destination lives under System now, including the ones
    // that kept their original routes so existing links keep working.
    return (
      pathname.startsWith("/system") ||
      // /settings renders System too, so the one entry stays lit there.
      pathname.startsWith("/settings") ||
      pathname.startsWith("/data-sources") ||
      pathname.startsWith("/infrastructure")
    );
  }
  return false;
}

export function shouldShowSelectedAppChatList({
  selectedPanel,
  selectedAppId,
  pathname,
}: {
  selectedPanel: AppSidebarPanel | null;
  selectedAppId: number | null;
  pathname: string;
}) {
  if (selectedPanel !== "Apps" || selectedAppId === null) {
    return false;
  }
  return pathname.startsWith("/app-details") || pathname === "/chat";
}

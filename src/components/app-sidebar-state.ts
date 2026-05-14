export type AppSidebarHoverState =
  | "start-hover:app"
  | "start-hover:settings"
  | "start-hover:library"
  | "clear-hover"
  | "no-hover";

export type AppSidebarPanel = "Apps" | "Settings" | "Library";

export type AppSidebarItemTitle = AppSidebarPanel | "Hub";

export function getRouteSidebarPanel(pathname: string): AppSidebarPanel | null {
  if (
    pathname === "/" ||
    pathname.startsWith("/apps") ||
    pathname.startsWith("/app-details") ||
    pathname === "/chat"
  ) {
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

export function getHoverSidebarPanel(
  hoverState: AppSidebarHoverState,
): AppSidebarPanel | null {
  if (hoverState === "start-hover:app") {
    return "Apps";
  }
  if (hoverState === "start-hover:settings") {
    return "Settings";
  }
  if (hoverState === "start-hover:library") {
    return "Library";
  }
  return null;
}

export function getSelectedSidebarPanel({
  hoverState,
  sidebarState,
  pathname,
}: {
  hoverState: AppSidebarHoverState;
  sidebarState: "expanded" | "collapsed";
  pathname: string;
}): AppSidebarPanel | null {
  const hoverPanel = getHoverSidebarPanel(hoverState);
  if (hoverPanel) {
    return hoverPanel;
  }

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
  if (title === "Apps") {
    return getRouteSidebarPanel(pathname) === "Apps";
  }
  if (title === "Settings") {
    return pathname.startsWith("/settings");
  }
  if (title === "Library") {
    return pathname.startsWith("/library");
  }
  return pathname.startsWith("/hub");
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

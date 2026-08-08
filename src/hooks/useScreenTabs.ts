import { useEffect } from "react";
import { useAtom } from "jotai";
import { useRouterState } from "@tanstack/react-router";

import { screenTabsAtom } from "@/atoms/chatAgentAtoms";
import {
  closeScreenTab,
  isChatOwnedPath,
  openScreenTab,
  screenForPath,
  type ScreenTab,
  type WorkspaceScreen,
} from "@/lib/workspace_screens";

/**
 * Keeps a tab open for every screen the user visits.
 *
 * Navigating somewhere adds its tab if it is not already there, so screens
 * accumulate the way browser tabs do instead of replacing one another.
 */
export function useScreenTabs(): {
  tabs: ScreenTab[];
  activeScreen: WorkspaceScreen | undefined;
  close: (path: string) => ScreenTab | null;
} {
  const [tabs, setTabs] = useAtom(screenTabsAtom);
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  const activeScreen = isChatOwnedPath(pathname)
    ? undefined
    : screenForPath(pathname);

  useEffect(() => {
    if (!activeScreen) return;
    setTabs((current) => openScreenTab(current, activeScreen));
  }, [activeScreen, setTabs]);

  const close = (path: string): ScreenTab | null => {
    const result = closeScreenTab(tabs, path);
    setTabs(result.tabs);
    // Only the caller knows whether it needs to navigate; hand back where to.
    return activeScreen?.path === path ? result.fallback : null;
  };

  return { tabs, activeScreen, close };
}

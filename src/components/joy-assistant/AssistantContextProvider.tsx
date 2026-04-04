/**
 * AssistantContextProvider
 *
 * Tracks the current route, page title, and visible data-joy-assist elements.
 * Provides AssistantPageContext to the assistant panel via React context.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouterState } from "@tanstack/react-router";
import type { AssistantPageContext } from "@/types/joy_assistant_types";

interface AssistantContextValue {
  pageContext: AssistantPageContext;
}

const AssistantCtx = createContext<AssistantContextValue>({
  pageContext: { route: "/", pageTitle: "", availableElements: [] as AssistantPageContext["availableElements"] },
});

export function useAssistantContext() {
  return useContext(AssistantCtx);
}

// Map routes to human-readable page titles
function pageTitleFromRoute(pathname: string): string {
  const map: Record<string, string> = {
    "/": "Hub",
    "/chat": "Chat",
    "/library": "Library",
    "/marketplace": "JoyMarketplace",
    "/agents": "Agents",
    "/agent-swarm": "Agent Swarm",
    "/workflows": "Workflows",
    "/documents": "Documents",
    "/local-ai": "Local AI",
    "/data-studio": "Data Studio",
    "/web-scraping": "Web Scraping",
    "/knowledge-base": "Knowledge Base",
    "/asset-studio": "Asset Studio",
    "/creator": "My Creations",
    "/creator-dashboard": "Creator Dashboard",
    "/settings": "Settings",
    "/p2p-chat": "P2P Chat",
  };
  return map[pathname] ?? pathname;
}

// Discover all elements with data-joy-assist on the page
function discoverElements(): AssistantPageContext["availableElements"] {
  const elements: AssistantPageContext["availableElements"] = [];
  document.querySelectorAll<HTMLElement>("[data-joy-assist]").forEach((el) => {
    const id = el.getAttribute("data-joy-assist");
    if (!id) return;
    const tag = el.tagName.toLowerCase();
    let type: "input" | "button" | "link" | "section" | "dialog" = "section";
    if (tag === "input" || tag === "textarea" || el.isContentEditable)
      type = "input";
    else if (tag === "button" || el.getAttribute("role") === "button")
      type = "button";
    else if (tag === "a" || el.getAttribute("role") === "link") type = "link";

    const label =
      el.getAttribute("aria-label") ??
      el.getAttribute("title") ??
      el.textContent?.trim().slice(0, 60) ??
      id;

    elements.push({ id, type, label });
  });
  return elements;
}

export function AssistantContextProvider({
  children,
}: {
  children: ReactNode;
}) {
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;
  const [elements, setElements] = useState<
    AssistantPageContext["availableElements"]
  >([]);
  const observerRef = useRef<MutationObserver | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-discover elements on route change and DOM mutations (debounced)
  useEffect(() => {
    const scan = () => {
      const found = discoverElements();
      setElements((prev) => {
        // Shallow compare to avoid infinite re-render loop
        if (
          prev.length === found.length &&
          prev.every((p, i) => p.id === found[i].id)
        ) {
          return prev;
        }
        return found;
      });
    };

    const debouncedScan = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(scan, 300);
    };

    // Initial scan after a short delay to let the page render
    timerRef.current = setTimeout(scan, 100);

    // Watch for DOM changes to pick up dynamically rendered elements
    observerRef.current = new MutationObserver(debouncedScan);
    observerRef.current.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-joy-assist"],
    });

    return () => {
      observerRef.current?.disconnect();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [pathname]);

  const pageContext = useMemo<AssistantPageContext>(
    () => ({
      route: pathname,
      pageTitle: pageTitleFromRoute(pathname),
      availableElements: elements,
    }),
    [pathname, elements],
  );

  const value = useMemo(() => ({ pageContext }), [pageContext]);

  return (
    <AssistantCtx.Provider value={value}>{children}</AssistantCtx.Provider>
  );
}

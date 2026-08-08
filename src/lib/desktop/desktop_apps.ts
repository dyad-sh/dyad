import type { ComponentType } from "react";
import {
  Briefcase,
  Blocks,
  BookOpen,
  Bot,
  Box,
  Boxes,
  Code2,
  Database,
  Github,
  HardDrive,
  Image,
  LayoutDashboard,
  Library,
  MessageSquare,
  Network,
  Orbit,
  Palette,
  Rocket,
  Settings,
  Sparkles,
  Terminal,
  Triangle,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { chatAgentRoute, plannerRoute } from "@/routes/agents";
import { agentOsRoute } from "@/routes/agent-os";
import { appDetailsRoute } from "@/routes/app-details";
import { appsRoute } from "@/routes/apps";
import {
  buildForgeRoute,
  codingAgentsRoute,
  helixAgentRoute,
  openWorkerAgentRoute,
} from "@/routes/coding-agents";
import { devOpsRoute } from "@/routes/dev-ops";
import { githubManagerRoute } from "@/routes/github-manager";
import { homeRoute } from "@/routes/home";
import { hubRoute } from "@/routes/hub";
import { jarvisRoute } from "@/routes/jarvis";
import { knowledgeBaseRoute } from "@/routes/knowledge-base";
import { knowledgeCoreRoute } from "@/routes/knowledge-core";
import { libraryRoute } from "@/routes/library";
import { mediaRoute } from "@/routes/media";
import { metaHdRoute } from "@/routes/meta-hd";
import { promptsRoute } from "@/routes/prompts";
import { settingsRoute } from "@/routes/settings";
import { storageRoute } from "@/routes/storage";
import { themesRoute } from "@/routes/themes";
import { vectorRoute } from "@/routes/vector";
import { vercelManagerRoute } from "@/routes/vercel-manager";
import { createDesktopSettingsApp } from "@/components/desktop/DesktopSettingsApp";
import { createDesktopAppsApp } from "@/components/desktop/DesktopAppsApp";

/**
 * The applications Desktop Mode can open — every one an existing feature.
 *
 * Each entry's component comes straight from its route definition, so a
 * desktop window renders exactly what the router renders and shares the same
 * atoms, stores and IPC. There is no desktop-only copy of anything.
 *
 * Routes that require URL params (app details, per-provider settings) are
 * deliberately absent: outside their route they would crash on missing params.
 */
export type DesktopAppCategory =
  | "AI & Agents"
  | "Create"
  | "Develop"
  | "Knowledge & Data"
  | "System";

/** Launcher section order. */
export const DESKTOP_APP_CATEGORIES: DesktopAppCategory[] = [
  "AI & Agents",
  "Create",
  "Develop",
  "Knowledge & Data",
  "System",
];

export type DesktopApp = {
  id: string;
  title: string;
  icon: LucideIcon;
  category: DesktopAppCategory;
  component: ComponentType;
  /** Normal-mode paths that should open or focus this desktop app. */
  routePaths: string[];
};

// Route.options.component is how TanStack Router stores what to render; it is
// part of the public options object passed at construction.
function componentOf(route: unknown): ComponentType {
  const component = (route as { options?: { component?: unknown } })?.options
    ?.component;
  if (typeof component !== "function") {
    throw new Error("Route has no component to host in a desktop window");
  }
  return component as ComponentType;
}

function app(
  id: string,
  title: string,
  icon: LucideIcon,
  category: DesktopAppCategory,
  route: unknown,
  routePaths: string[],
): DesktopApp {
  return {
    id,
    title,
    icon,
    category,
    component: componentOf(route),
    routePaths,
  };
}

export const DESKTOP_APPS: DesktopApp[] = [
  app("chat", "AI Chat", MessageSquare, "AI & Agents", chatAgentRoute, [
    "/",
    "/chat-agent",
  ]),
  app("agents", "Agents", Bot, "AI & Agents", agentOsRoute, ["/agent-os"]),
  app("jarvis", "Voice Assistant", Sparkles, "AI & Agents", jarvisRoute, [
    "/jarvis",
  ]),
  app(
    "knowledge-core",
    "Knowledge Core",
    Network,
    "Knowledge & Data",
    knowledgeCoreRoute,
    ["/knowledge-core"],
  ),
  app("media", "Media", Image, "Create", mediaRoute, ["/media"]),
  app("library", "Library", Library, "Create", libraryRoute, ["/library"]),
  app("planner", "Planner", LayoutDashboard, "Create", plannerRoute, [
    "/planner",
    "/social-media-agent",
  ]),
  app("themes", "Themes", Palette, "Create", themesRoute, ["/themes"]),
  app("prompts", "Prompts", Wrench, "Create", promptsRoute, ["/prompts"]),
  app("build-studio", "Build Studio", Code2, "Develop", homeRoute, [
    "/coder/studio",
  ]),
  app("assembler", "Assembler", Box, "Develop", buildForgeRoute, [
    "/assembler3d",
  ]),
  app("helix", "Helix Coder", Orbit, "Develop", helixAgentRoute, [
    "/coder/helix",
  ]),
  app("openworker", "OpenWorker", Briefcase, "Develop", openWorkerAgentRoute, [
    "/coder/openworker",
  ]),
  app("coder", "Coding Agents", Terminal, "Develop", codingAgentsRoute, [
    "/coder",
  ]),
  {
    id: "apps",
    title: "My Apps",
    icon: Boxes,
    category: "Develop",
    component: createDesktopAppsApp(
      componentOf(appsRoute),
      componentOf(appDetailsRoute),
    ),
    routePaths: ["/apps", "/app-details"],
  },
  app("hub", "Hub", Blocks, "Develop", hubRoute, ["/hub"]),
  app("dev-ops", "DevOps", Rocket, "Develop", devOpsRoute, ["/dev-ops"]),
  app("github", "GitHub", Github, "Develop", githubManagerRoute, [
    "/github-manager",
  ]),
  app("vercel", "Vercel", Triangle, "Develop", vercelManagerRoute, [
    "/vercel-manager",
  ]),
  app(
    "knowledge-base",
    "Knowledge Base",
    BookOpen,
    "Knowledge & Data",
    knowledgeBaseRoute,
    ["/knowledge-base"],
  ),
  app("vector", "Vector Memory", Database, "Knowledge & Data", vectorRoute, [
    "/vector",
  ]),
  app("storage", "Storage", HardDrive, "Knowledge & Data", storageRoute, [
    "/storage",
  ]),
  app("meta-hd", "Meta HD", Box, "Knowledge & Data", metaHdRoute, ["/meta-hd"]),
  {
    id: "settings",
    title: "Settings",
    icon: Settings,
    category: "System",
    // Wrapped so the provider-config child route renders inside the window.
    component: createDesktopSettingsApp(componentOf(settingsRoute)),
    routePaths: ["/settings"],
  },
];

/** Apps grouped in launcher section order, for the browsing (no-search) view. */
export function desktopAppsByCategory(): {
  category: DesktopAppCategory;
  apps: DesktopApp[];
}[] {
  return DESKTOP_APP_CATEGORIES.map((category) => ({
    category,
    apps: DESKTOP_APPS.filter((appEntry) => appEntry.category === category),
  })).filter((group) => group.apps.length > 0);
}

export const DEFAULT_DOCK_PINS = [
  "chat",
  "agents",
  "jarvis",
  "knowledge-base",
  "helix",
  "settings",
];

export function desktopAppById(id: string): DesktopApp | undefined {
  return DESKTOP_APPS.find((appEntry) => appEntry.id === id);
}

/**
 * Resolves a normal-mode route to its Desktop Mode app. More-specific paths
 * win, so `/coder/studio` opens Build Studio rather than Coding Agents.
 */
export function desktopAppIdForPath(pathname: string): string | undefined {
  const bindings = DESKTOP_APPS.flatMap((appEntry) =>
    appEntry.routePaths.map((path) => ({ appId: appEntry.id, path })),
  ).sort((a, b) => b.path.length - a.path.length);

  return bindings.find(({ path }) =>
    path === "/"
      ? pathname === "/"
      : pathname === path || pathname.startsWith(`${path}/`),
  )?.appId;
}

export function searchDesktopApps(query: string): DesktopApp[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return DESKTOP_APPS;
  return DESKTOP_APPS.filter((appEntry) =>
    appEntry.title.toLowerCase().includes(needle),
  );
}

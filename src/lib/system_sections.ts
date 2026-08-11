import {
  Activity,
  Blocks,
  Boxes,
  Cpu,
  Database,
  HardDrive,
  Plug,
  Puzzle,
  Settings as SettingsIcon,
  Shield,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import type { SettingsTabId } from "./settingsTabs";

/**
 * The System section, as data.
 *
 * One canonical list of destinations, used by the secondary navigation, the
 * landing overview and the tests. A second copy anywhere would drift, and the
 * first symptom of drift is a destination nobody can reach.
 *
 * Every destination either renders an existing page or an existing settings
 * tab. Nothing here is new functionality: this is where things live, not what
 * they do.
 */

export type SystemDestinationId =
  | "infrastructure"
  | "data-sources"
  | "storage"
  | "ai-providers"
  | "model-roles"
  | "mcp"
  | "plugins"
  | "integrations"
  | "skills"
  | "security"
  | "settings";

/** Visual grouping only. The canonical destinations are the ids above. */
export type SystemGroup =
  | "Machine"
  | "Intelligence"
  | "Connections"
  | "Extensions"
  | "Control";

export type SystemDestination = {
  id: SystemDestinationId;
  label: string;
  /** One line saying what this is, so the categories stay distinguishable. */
  summary: string;
  group: SystemGroup;
  icon: LucideIcon;
  /**
   * What renders here.
   *
   * `page` reuses a whole existing screen; `settings-tab` reuses an existing
   * settings tab. Either way the component is the one that already worked.
   */
  renders:
    | { kind: "page"; route: "/infrastructure" | "/data-sources" }
    | { kind: "settings-tab"; tab: SettingsTabId };
  /** The route this used to live at, kept working for existing links. */
  legacyRoute?: string;
};

export const SYSTEM_DESTINATIONS: SystemDestination[] = [
  {
    id: "infrastructure",
    label: "Infrastructure",
    summary: "What is running on this machine",
    group: "Machine",
    icon: Activity,
    renders: { kind: "page", route: "/infrastructure" },
    legacyRoute: "/infrastructure",
  },
  {
    id: "storage",
    label: "Storage",
    summary: "Where Meta Human stores files",
    group: "Machine",
    icon: HardDrive,
    renders: { kind: "settings-tab", tab: "storage" },
    legacyRoute: "/storage",
  },
  {
    id: "ai-providers",
    label: "AI Providers",
    summary: "Which AI services are connected",
    group: "Intelligence",
    icon: Sparkles,
    renders: { kind: "settings-tab", tab: "ai" },
  },
  {
    id: "model-roles",
    label: "Model Roles",
    summary: "Which models perform which jobs",
    group: "Intelligence",
    icon: Cpu,
    renders: { kind: "settings-tab", tab: "modelRoles" },
  },
  {
    id: "data-sources",
    label: "Data Sources",
    summary: "Where Meta Human reads external data",
    group: "Connections",
    icon: Database,
    renders: { kind: "page", route: "/data-sources" },
    legacyRoute: "/data-sources",
  },
  {
    id: "mcp",
    label: "MCP",
    summary: "Tool and server protocol connections",
    group: "Connections",
    icon: Plug,
    renders: { kind: "settings-tab", tab: "mcp" },
  },
  {
    id: "integrations",
    label: "Integrations",
    summary: "Connected third-party services",
    group: "Connections",
    icon: Blocks,
    renders: { kind: "settings-tab", tab: "integrations" },
  },
  {
    id: "plugins",
    label: "Plugins",
    summary: "Installed application extensions",
    group: "Extensions",
    icon: Puzzle,
    renders: { kind: "settings-tab", tab: "plugins" },
  },
  {
    id: "skills",
    label: "Skills",
    summary: "Capabilities available to agents",
    group: "Extensions",
    icon: Boxes,
    renders: { kind: "settings-tab", tab: "skills" },
  },
  {
    id: "security",
    label: "Security",
    summary: "Permissions, secrets and protection",
    group: "Control",
    icon: Shield,
    renders: { kind: "settings-tab", tab: "agent" },
  },
  {
    id: "settings",
    label: "Settings",
    summary: "General configuration",
    group: "Control",
    icon: SettingsIcon,
    renders: { kind: "settings-tab", tab: "general" },
  },
];

/** Order the groups appear in, independent of the destination order. */
export const SYSTEM_GROUPS: SystemGroup[] = [
  "Machine",
  "Intelligence",
  "Connections",
  "Extensions",
  "Control",
];

export function destinationsInGroup(group: SystemGroup): SystemDestination[] {
  return SYSTEM_DESTINATIONS.filter(
    (destination) => destination.group === group,
  );
}

export function findDestination(
  id: string | null | undefined,
): SystemDestination | undefined {
  return SYSTEM_DESTINATIONS.find((destination) => destination.id === id);
}

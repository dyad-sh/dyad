import {
  Activity,
  AudioLines,
  FlaskConical,
  Cpu,
  Database,
  HardDrive,
  NotebookPen,
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
  | "notes-vault"
  | "ai-providers"
  | "model-roles"
  | "voice-assistant"
  | "mcp"
  | "plugins"
  | "security"
  | "advanced"
  | "appearance";

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
    | {
        kind: "page";
        route: "/infrastructure" | "/data-sources" | "notes-vault";
      }
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
    id: "notes-vault",
    label: "Notes Vault",
    summary: "A fast local notepad for ideas and snippets",
    group: "Machine",
    icon: NotebookPen,
    renders: { kind: "page", route: "notes-vault" },
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
    id: "voice-assistant",
    label: "Voice Assistant",
    summary: "ElevenLabs voices, chat read-aloud and listening",
    group: "Intelligence",
    icon: AudioLines,
    renders: { kind: "settings-tab", tab: "jarvis" },
    legacyRoute: "/jarvis/settings",
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
    id: "plugins",
    label: "Plugins",
    summary: "AI capabilities, skills and your connected services",
    group: "Extensions",
    icon: Puzzle,
    renders: { kind: "settings-tab", tab: "plugins" },
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
    id: "advanced",
    label: "Advanced",
    summary: "Experimental features",
    group: "Control",
    icon: FlaskConical,
    renders: { kind: "settings-tab", tab: "advanced" },
  },
  {
    id: "appearance",
    label: "Appearance",
    summary: "Theme, language and general preferences",
    group: "Control",
    icon: SettingsIcon,
    renders: { kind: "settings-tab", tab: "general" },
    legacyRoute: "/settings",
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

/**
 * The destination that owns a settings tab.
 *
 * Used to turn an existing settings deep link into the System destination that
 * now renders it, so links written before this section existed still land in
 * the right place.
 */
export function destinationForTab(
  tab: string | null | undefined,
): SystemDestination | undefined {
  if (!tab) return undefined;
  return SYSTEM_DESTINATIONS.find(
    (destination) =>
      destination.renders.kind === "settings-tab" &&
      destination.renders.tab === tab,
  );
}

export function findDestination(
  id: string | null | undefined,
): SystemDestination | undefined {
  return SYSTEM_DESTINATIONS.find((destination) => destination.id === id);
}

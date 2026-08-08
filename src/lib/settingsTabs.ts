import type { LucideIcon } from "lucide-react";
import {
  AudioLines,
  Blocks,
  Brain,
  FlaskConical,
  GalleryVerticalEnd,
  HardDrive,
  Plug,
  Settings2,
  ShieldCheck,
  Wand2,
  Wrench,
} from "lucide-react";

import { SECTION_IDS } from "./settingsSearchIndex";

export const SETTINGS_TAB_IDS = [
  "general",
  "ai",
  "modelRoles",
  "jarvis",
  "skills",
  "plugins",
  "mcp",
  "integrations",
  "storage",
  "agent",
  "advanced",
] as const;

export type SettingsTabId = (typeof SETTINGS_TAB_IDS)[number];

export type SettingsTabDefinition = {
  id: SettingsTabId;
  label: string;
  description: string;
  icon: LucideIcon;
  sectionIds: readonly string[];
};

export const SETTINGS_TABS: SettingsTabDefinition[] = [
  {
    id: "ai",
    label: "Providers",
    description: "Provider connections and models",
    icon: Brain,
    sectionIds: [SECTION_IDS.aiCoder, SECTION_IDS.ai, SECTION_IDS.providers],
  },
  {
    id: "modelRoles",
    label: "Model Roles",
    description: "Models for chat, code, media and OCR",
    icon: GalleryVerticalEnd,
    sectionIds: [
      SECTION_IDS.modelRoles,
      SECTION_IDS.chatAgent,
      SECTION_IDS.imageAgent,
      SECTION_IDS.videoAgent,
      SECTION_IDS.helix,
    ],
  },
  {
    id: "jarvis",
    label: "Voice Assistant",
    description: "JARVIS voice, listening and permissions",
    icon: AudioLines,
    sectionIds: [SECTION_IDS.jarvis],
  },
  {
    id: "skills",
    label: "Skills",
    description: "Computer, terminal and browser use",
    icon: Wand2,
    sectionIds: [SECTION_IDS.systemAccess],
  },
  {
    id: "plugins",
    label: "Plugins",
    description: "Developer, search and market services",
    icon: Plug,
    sectionIds: [SECTION_IDS.plugins],
  },
  {
    id: "mcp",
    label: "MCP",
    description: "Tool servers and workflows",
    icon: Wrench,
    sectionIds: [SECTION_IDS.toolsMcp],
  },
  {
    id: "integrations",
    label: "Integrations",
    description: "Databases and social accounts",
    icon: Blocks,
    sectionIds: [SECTION_IDS.integrations, SECTION_IDS.connections],
  },
  {
    id: "storage",
    label: "Storage",
    description: "Local vault or Vercel Blob",
    icon: HardDrive,
    sectionIds: [SECTION_IDS.storage],
  },
  {
    id: "agent",
    label: "Tools",
    description: "Built-in tool permissions (Pro)",
    icon: ShieldCheck,
    sectionIds: [SECTION_IDS.agentPermissions],
  },
  {
    id: "advanced",
    label: "Advanced",
    description: "Experimental features",
    icon: FlaskConical,
    sectionIds: [SECTION_IDS.experiments],
  },
  {
    id: "general",
    label: "System",
    description: "Appearance, language and app info",
    icon: Settings2,
    sectionIds: [
      SECTION_IDS.general,
      SECTION_IDS.workflow,
      SECTION_IDS.telemetry,
      SECTION_IDS.dangerZone,
    ],
  },
];

const sectionToTab = new Map<string, SettingsTabId>(
  SETTINGS_TABS.flatMap((tab) =>
    tab.sectionIds.map((sectionId) => [sectionId, tab.id] as const),
  ),
);

export function getTabIdForSection(sectionId: string): SettingsTabId {
  return sectionToTab.get(sectionId) ?? "general";
}

export function isSettingsTabId(value: string): value is SettingsTabId {
  return (SETTINGS_TAB_IDS as readonly string[]).includes(value);
}

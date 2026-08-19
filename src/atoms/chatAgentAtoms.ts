import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { FileAttachment } from "@/ipc/types";
import type { ScreenTab } from "@/lib/workspace_screens";
import type {
  ChatAgentConversation,
  ChatAgentOpenTab,
} from "@/components/chat-agent/types";

export const chatAgentAttachmentsAtom = atom<FileAttachment[]>([]);

/** Legacy/default selection used when opening conversations saved before
 * database scope became part of each Chat Agent tab. New conversations copy
 * this value, but every open conversation then owns its own selection. */
export const chatAgentDataSourceIdsAtom = atomWithStorage<string[]>(
  "chat-agent-data-source-ids",
  [],
);

/** Maximum number of Chat Agent conversations kept in history. */
export const MAX_CHAT_AGENT_HISTORY = 50;

/**
 * Persisted Chat Agent conversation history (most recent first is enforced when
 * upserting). Stored in localStorage so it survives reloads.
 */
export const chatAgentHistoryAtom = atomWithStorage<ChatAgentConversation[]>(
  "chat-agent-history",
  [],
);

/** Chat Agent conversations that stay open until the user closes their tab. */
export const chatAgentOpenTabsAtom = atomWithStorage<ChatAgentOpenTab[]>(
  "chat-agent-open-tabs",
  [],
  undefined,
  { getOnInit: true },
);

/** Last active Chat Agent tab, restored when returning to Chat Agent. */
export const activeChatAgentTabAtom = atomWithStorage<string | null>(
  "active-chat-agent-tab",
  null,
  undefined,
  { getOnInit: true },
);

/**
 * Conversations still producing an answer, by session id.
 *
 * Work continues in the tab that started it, so the tab bar needs to say which
 * tabs are busy — otherwise a background answer finishes unseen. Deliberately
 * not persisted: nothing is streaming after a restart.
 */
export const busyChatSessionsAtom = atom<readonly string[]>([]);

/** Conversation history grouped by persisted Hermes agent ID. */
export const hermesAgentHistoryAtom = atomWithStorage<
  Record<string, ChatAgentConversation[]>
>("hermes-agent-history", {});

/** User-selected avatar for the built-in Lovable Web Dev agent. */
export const lovableWebDevAvatarAtom = atomWithStorage<string>(
  "lovable-web-dev-avatar",
  "🌐",
);

export type AgentWorkspaceTab = {
  id: string;
  name: string;
  icon: string;
};

/** Agent chats kept open in the global workspace tab strip until closed. */
export const agentWorkspaceTabsAtom = atomWithStorage<AgentWorkspaceTab[]>(
  "agent-workspace-tabs",
  [],
);

/**
 * Whether the Hermes Dashboard tab is open.
 *
 * It behaves like the tabs beside it: closable, and persisted so it stays
 * closed across a restart. Opening Agent OS again brings it back, because that
 * is the screen it is the tab for.
 */
export const hermesDashboardTabOpenAtom = atomWithStorage<boolean>(
  "hermes-dashboard-tab-open",
  true,
);

/** Last selected Agent workspace tab, restored when returning to Agent OS. */
export const activeAgentWorkspaceTabAtom = atomWithStorage<string>(
  "active-agent-workspace-tab",
  "dashboard",
);

/**
 * Non-chat screens the user has open — Helix, Settings, Knowledge Base and so
 * on. Persisted so a restart reopens the same workspace.
 */
export const screenTabsAtom = atomWithStorage<ScreenTab[]>(
  "workspace-screen-tabs",
  [],
);

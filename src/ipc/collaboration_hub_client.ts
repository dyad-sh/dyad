/**
 * Collaboration Hub IPC Client (renderer-side)
 *
 * Typed wrappers over the `collab:*` channels exposed by
 * `collaboration_hub_handlers.ts`. All wrappers are safe to call when running
 * outside Electron (storybook, vitest, SSR) — they short-circuit to inert
 * stubs (empty arrays, no-op promises) when `window.electron` is undefined.
 */

import type {
  CollabActivityItem,
  CollabChannel,
  CollabChannelVisibility,
  CollabMessage,
  CollabMessageKind,
  CollabSubscription,
  CollabTask,
  CollabTaskPriority,
  CollabTaskStatus,
} from "./handlers/collaboration_hub_handlers";

export type {
  CollabActivityItem,
  CollabChannel,
  CollabChannelVisibility,
  CollabMessage,
  CollabMessageKind,
  CollabSubscription,
  CollabTask,
  CollabTaskPriority,
  CollabTaskStatus,
};

// =============================================================================
// IPC guard — returns null when not running in Electron
// =============================================================================

type Invoker = (channel: string, ...args: unknown[]) => Promise<unknown>;

function getInvoker(): Invoker | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const electron = (window as any).electron;
  if (!electron?.ipcRenderer?.invoke) return null;
  return (channel, ...args) => electron.ipcRenderer.invoke(channel, ...args);
}

async function call<T>(channel: string, payload?: unknown, fallback?: T): Promise<T> {
  const invoke = getInvoker();
  if (!invoke) {
    return (fallback as T) ?? (undefined as unknown as T);
  }
  try {
    const result = await invoke(channel, payload);
    return result as T;
  } catch (err) {
    // Surface errors to the caller; TanStack Query will catch and display.
    throw err;
  }
}

// =============================================================================
// Channels
// =============================================================================

export const CollaborationHubClient = {
  // -- channels --------------------------------------------------------------

  async listChannels(params?: { includeArchived?: boolean }): Promise<CollabChannel[]> {
    return call<CollabChannel[]>("collab:channel:list", params ?? {}, []);
  },

  async getChannel(id: number): Promise<CollabChannel | null> {
    return call<CollabChannel | null>("collab:channel:get", { id }, null);
  },

  async createChannel(params: {
    name: string;
    description?: string | null;
    topic?: string | null;
    visibility?: CollabChannelVisibility;
    createdByAgentId?: number | null;
  }): Promise<CollabChannel | null> {
    return call<CollabChannel | null>("collab:channel:create", params, null);
  },

  async updateChannel(params: {
    id: number;
    name?: string;
    description?: string | null;
    topic?: string | null;
    visibility?: CollabChannelVisibility;
  }): Promise<CollabChannel | null> {
    return call<CollabChannel | null>("collab:channel:update", params, null);
  },

  async archiveChannel(params: { id: number; archived?: boolean }): Promise<CollabChannel | null> {
    return call<CollabChannel | null>("collab:channel:archive", params, null);
  },

  // -- subscriptions ---------------------------------------------------------

  async joinChannel(params: { agentId: number; channelId: number }): Promise<CollabSubscription | null> {
    return call<CollabSubscription | null>("collab:subscription:join", params, null);
  },

  async leaveChannel(params: { agentId: number; channelId: number }): Promise<{ removed: number }> {
    return call<{ removed: number }>("collab:subscription:leave", params, { removed: 0 });
  },

  async listSubscriptionsForAgent(agentId: number): Promise<CollabSubscription[]> {
    return call<CollabSubscription[]>("collab:subscription:list-for-agent", { agentId }, []);
  },

  async listSubscriptionsForChannel(channelId: number): Promise<CollabSubscription[]> {
    return call<CollabSubscription[]>("collab:subscription:list-for-channel", { channelId }, []);
  },

  // -- messages --------------------------------------------------------------

  async postMessage(params: {
    channelId?: number | null;
    fromAgentId?: number | null;
    toAgentId?: number | null;
    kind?: CollabMessageKind;
    content: string;
    metadata?: Record<string, unknown> | null;
    replyToId?: number | null;
    taskId?: number | null;
  }): Promise<CollabMessage | null> {
    return call<CollabMessage | null>("collab:message:post", params, null);
  },

  async listMessages(params: {
    channelId?: number;
    agentId?: number;
    peerAgentId?: number;
    limit?: number;
    before?: number;
  }): Promise<CollabMessage[]> {
    return call<CollabMessage[]>("collab:message:list", params, []);
  },

  // -- tasks (handoffs) ------------------------------------------------------

  async createTask(params: {
    fromAgentId: number;
    toAgentId: number;
    title: string;
    description?: string | null;
    priority?: CollabTaskPriority;
    channelId?: number | null;
    input?: Record<string, unknown> | null;
    dueAt?: number | null;
  }): Promise<CollabTask | null> {
    return call<CollabTask | null>("collab:task:create", params, null);
  },

  async updateTaskStatus(params: {
    id: number;
    status: CollabTaskStatus;
    output?: Record<string, unknown> | null;
  }): Promise<CollabTask | null> {
    return call<CollabTask | null>("collab:task:update-status", params, null);
  },

  async listTasks(params?: {
    agentId?: number;
    status?: CollabTaskStatus;
    role?: "mine_assigned" | "mine_created";
    channelId?: number;
    limit?: number;
  }): Promise<CollabTask[]> {
    return call<CollabTask[]>("collab:task:list", params ?? {}, []);
  },

  // -- activity --------------------------------------------------------------

  async recentActivity(params?: { limit?: number }): Promise<CollabActivityItem[]> {
    return call<CollabActivityItem[]>("collab:activity:recent", params ?? {}, []);
  },
};

export default CollaborationHubClient;

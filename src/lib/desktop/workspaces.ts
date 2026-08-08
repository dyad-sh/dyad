/**
 * Virtual workspaces: named groups of windows the user switches between.
 *
 * Kept as pure functions over an array so the rules — never delete the last
 * one, never strand windows — are provable rather than incidental.
 */

export type Workspace = {
  id: string;
  name: string;
};

export const DEFAULT_WORKSPACES: Workspace[] = [
  { id: "home", name: "Home" },
  { id: "ai", name: "AI" },
  { id: "dev", name: "Development" },
  { id: "media", name: "Media" },
];

export function addWorkspace(
  workspaces: Workspace[],
  createId: () => string = () => crypto.randomUUID(),
): Workspace[] {
  // Number by position so a new workspace never collides with a renamed one.
  return [
    ...workspaces,
    { id: createId(), name: `Workspace ${workspaces.length + 1}` },
  ];
}

export function renameWorkspace(
  workspaces: Workspace[],
  id: string,
  name: string,
): Workspace[] {
  const trimmed = name.trim();
  if (!trimmed) return workspaces;
  return workspaces.map((workspace) =>
    workspace.id === id ? { ...workspace, name: trimmed } : workspace,
  );
}

export type RemoveWorkspaceResult = {
  workspaces: Workspace[];
  /** Where windows from the removed workspace should go. */
  reassignTo: string | null;
  /** Workspace to switch to if the removed one was active. */
  activeId: string;
};

/**
 * Removes a workspace, moving its windows to a neighbour rather than leaving
 * them unreachable. Refuses to remove the last one — a desktop always needs
 * somewhere for windows to live.
 */
export function removeWorkspace(
  workspaces: Workspace[],
  id: string,
  activeId: string,
): RemoveWorkspaceResult {
  if (workspaces.length <= 1) {
    return { workspaces, reassignTo: null, activeId };
  }
  const index = workspaces.findIndex((workspace) => workspace.id === id);
  if (index < 0) return { workspaces, reassignTo: null, activeId };

  const remaining = workspaces.filter((workspace) => workspace.id !== id);
  const neighbour = remaining[index] ?? remaining[index - 1];
  return {
    workspaces: remaining,
    reassignTo: neighbour.id,
    activeId: activeId === id ? neighbour.id : activeId,
  };
}

export function reorderWorkspaces(
  workspaces: Workspace[],
  from: number,
  to: number,
): Workspace[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= workspaces.length ||
    to >= workspaces.length
  ) {
    return workspaces;
  }
  const next = [...workspaces];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** The workspace one step away, wrapping around at the ends. */
export function adjacentWorkspaceId(
  workspaces: Workspace[],
  activeId: string,
  direction: 1 | -1,
): string {
  if (workspaces.length === 0) return activeId;
  const index = workspaces.findIndex((workspace) => workspace.id === activeId);
  if (index < 0) return workspaces[0].id;
  const next = (index + direction + workspaces.length) % workspaces.length;
  return workspaces[next].id;
}

/** Guards against a persisted active id whose workspace no longer exists. */
export function resolveActiveWorkspace(
  workspaces: Workspace[],
  activeId: string,
): string {
  return workspaces.some((workspace) => workspace.id === activeId)
    ? activeId
    : (workspaces[0]?.id ?? DEFAULT_WORKSPACES[0].id);
}

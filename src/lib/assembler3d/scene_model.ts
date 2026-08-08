/**
 * The scene, as data.
 *
 * Everything the viewport shows is derived from this: objects, their
 * transforms, what is selected, and how assemblies nest. Keeping it as plain
 * data rather than inside Three.js objects is what makes the behaviour
 * testable without a canvas, and what lets undo work by swapping state instead
 * of trying to reverse each operation.
 *
 * Two decisions worth stating. Transforms are stored relative to a parent, so
 * moving an assembly moves its children for free. And detaching preserves an
 * object's world position, because a part that jumps across the workspace when
 * you ungroup it has lost the placement you spent time on.
 */

export type Vector3 = { x: number; y: number; z: number };

export const ORIGIN: Vector3 = { x: 0, y: 0, z: 0 };
export const UNIT_SCALE: Vector3 = { x: 1, y: 1, z: 1 };

export type SceneObject = {
  id: string;
  name: string;
  /** Primitive kind, or the format an imported model came from. */
  kind: "box" | "sphere" | "cylinder" | "cone" | "torus" | "imported" | "group";
  position: Vector3;
  rotation: Vector3;
  scale: Vector3;
  parentId: string | null;
  visible: boolean;
  locked: boolean;
};

export type Scene = {
  objects: Record<string, SceneObject>;
  /** Draw and hierarchy order; ids only, so reordering is cheap. */
  order: string[];
  selection: string[];
};

export const emptyScene = (): Scene => ({
  objects: {},
  order: [],
  selection: [],
});

// ── Vector helpers ─────────────────────────────────────────────────────────

export const addVectors = (a: Vector3, b: Vector3): Vector3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
});

export const subtractVectors = (a: Vector3, b: Vector3): Vector3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});

/**
 * Rounds to a grid step.
 *
 * A step of zero means snapping is off, which is treated as identity rather
 * than a division by zero.
 */
export function snapToGrid(value: Vector3, step: number): Vector3 {
  if (!step || step <= 0) return value;
  const snap = (n: number) => Math.round(n / step) * step;
  return { x: snap(value.x), y: snap(value.y), z: snap(value.z) };
}

// ── Reading the scene ──────────────────────────────────────────────────────

export function getObject(scene: Scene, id: string): SceneObject | null {
  return scene.objects[id] ?? null;
}

export function childrenOf(
  scene: Scene,
  parentId: string | null,
): SceneObject[] {
  return scene.order
    .map((id) => scene.objects[id]!)
    .filter((object) => object.parentId === parentId);
}

/** Absolute position, walking up through every ancestor. */
export function worldPosition(scene: Scene, id: string): Vector3 {
  let object: SceneObject | undefined = scene.objects[id];
  let position = ORIGIN;
  const guard = new Set<string>();

  while (object) {
    // A cycle would otherwise hang the render loop.
    if (guard.has(object.id)) break;
    guard.add(object.id);
    position = addVectors(position, object.position);
    object = object.parentId ? scene.objects[object.parentId] : undefined;
  }
  return position;
}

/** Every descendant of an object, deepest last. */
export function descendantsOf(scene: Scene, id: string): string[] {
  const found: string[] = [];
  const walk = (parentId: string) => {
    for (const child of childrenOf(scene, parentId)) {
      found.push(child.id);
      walk(child.id);
    }
  };
  walk(id);
  return found;
}

/** Objects that can be acted on: not locked, and no locked ancestor. */
export function isEditable(scene: Scene, id: string): boolean {
  let object: SceneObject | undefined = scene.objects[id];
  const guard = new Set<string>();
  while (object) {
    if (guard.has(object.id)) return false;
    guard.add(object.id);
    if (object.locked) return false;
    object = object.parentId ? scene.objects[object.parentId] : undefined;
  }
  return true;
}

// ── Changing the scene ─────────────────────────────────────────────────────

export function addObject(scene: Scene, object: SceneObject): Scene {
  return {
    ...scene,
    objects: { ...scene.objects, [object.id]: object },
    order: [...scene.order, object.id],
  };
}

/** Removes objects and everything beneath them. */
export function removeObjects(scene: Scene, ids: string[]): Scene {
  const doomed = new Set<string>();
  for (const id of ids) {
    if (!scene.objects[id]) continue;
    doomed.add(id);
    for (const child of descendantsOf(scene, id)) doomed.add(child);
  }
  if (doomed.size === 0) return scene;

  const objects = { ...scene.objects };
  for (const id of doomed) delete objects[id];

  return {
    objects,
    order: scene.order.filter((id) => !doomed.has(id)),
    selection: scene.selection.filter((id) => !doomed.has(id)),
  };
}

export function updateObject(
  scene: Scene,
  id: string,
  changes: Partial<Omit<SceneObject, "id">>,
): Scene {
  const existing = scene.objects[id];
  if (!existing) return scene;
  return {
    ...scene,
    objects: { ...scene.objects, [id]: { ...existing, ...changes } },
  };
}

/** Moves objects by a delta, skipping anything locked. */
export function translateObjects(
  scene: Scene,
  ids: string[],
  delta: Vector3,
  gridStep = 0,
): Scene {
  let next = scene;
  for (const id of ids) {
    const object = next.objects[id];
    if (!object || !isEditable(next, id)) continue;
    next = updateObject(next, id, {
      position: snapToGrid(addVectors(object.position, delta), gridStep),
    });
  }
  return next;
}

// ── Selection ──────────────────────────────────────────────────────────────

export function select(scene: Scene, ids: string[]): Scene {
  const valid = ids.filter((id) => scene.objects[id]);
  return { ...scene, selection: [...new Set(valid)] };
}

export function toggleSelection(scene: Scene, id: string): Scene {
  if (!scene.objects[id]) return scene;
  return scene.selection.includes(id)
    ? { ...scene, selection: scene.selection.filter((each) => each !== id) }
    : { ...scene, selection: [...scene.selection, id] };
}

export const clearSelection = (scene: Scene): Scene => ({
  ...scene,
  selection: [],
});

// ── Assemblies ─────────────────────────────────────────────────────────────

/**
 * Groups objects under a new assembly placed at their shared centre.
 *
 * Children are re-based against that centre so nothing moves on screen: the
 * grouping is a change of structure, not of placement.
 */
export function groupObjects(
  scene: Scene,
  ids: string[],
  groupId: string,
  name = "Assembly",
): Scene {
  const members = ids
    .map((id) => scene.objects[id])
    .filter((object): object is SceneObject => Boolean(object));
  if (members.length < 2) return scene;

  const centre = members.reduce(
    (total, member) => addVectors(total, worldPosition(scene, member.id)),
    ORIGIN,
  );
  const origin: Vector3 = {
    x: centre.x / members.length,
    y: centre.y / members.length,
    z: centre.z / members.length,
  };

  let next = addObject(scene, {
    id: groupId,
    name,
    kind: "group",
    position: origin,
    rotation: ORIGIN,
    scale: UNIT_SCALE,
    parentId: null,
    visible: true,
    locked: false,
  });

  for (const member of members) {
    const world = worldPosition(scene, member.id);
    next = updateObject(next, member.id, {
      parentId: groupId,
      position: subtractVectors(world, origin),
    });
  }

  return select(next, [groupId]);
}

/**
 * Releases children from their assembly, keeping them where they are.
 *
 * The empty group is removed afterwards: an assembly with nothing in it is
 * clutter in the hierarchy.
 */
export function ungroupObjects(scene: Scene, groupId: string): Scene {
  const group = scene.objects[groupId];
  if (!group || group.kind !== "group") return scene;

  const members = childrenOf(scene, groupId);
  let next = scene;
  for (const member of members) {
    next = updateObject(next, member.id, {
      parentId: group.parentId,
      // Preserved in world space, so nothing jumps when it is released.
      position: addVectors(member.position, group.position),
    });
  }

  next = removeObjects(next, [groupId]);
  return select(
    next,
    members.map((member) => member.id),
  );
}

// ── History ────────────────────────────────────────────────────────────────

export type History = {
  past: Scene[];
  present: Scene;
  future: Scene[];
};

/** Deep enough history to be useful, shallow enough not to hold every mesh. */
const HISTORY_LIMIT = 50;

export const createHistory = (scene: Scene = emptyScene()): History => ({
  past: [],
  present: scene,
  future: [],
});

/**
 * Records a new state.
 *
 * Redo is discarded, because branching away from a redone future and then
 * offering it back is more confusing than losing it.
 */
export function commit(history: History, scene: Scene): History {
  if (scene === history.present) return history;
  const past = [...history.past, history.present].slice(-HISTORY_LIMIT);
  return { past, present: scene, future: [] };
}

export function undo(history: History): History {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo(history: History): History {
  const [next, ...rest] = history.future;
  if (!next) return history;
  return {
    past: [...history.past, history.present],
    present: next,
    future: rest,
  };
}

// ── Transform validation ───────────────────────────────────────────────────

/**
 * Bounds for a safe scale.
 *
 * A zero or near-zero scale collapses an object to nothing: it stops being
 * clickable, framing it does nothing useful, and the only way back is undo.
 * An enormous scale swallows the whole scene. Both are recoverable in theory
 * and miserable in practice, so they are refused at the edit.
 */
export const MIN_SCALE = 0.001;
export const MAX_SCALE = 10_000;

/** A number that is safe to store, or null when it is not usable. */
export function safeNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Keeps a scale component inside the range an object can come back from. */
export function safeScaleComponent(value: unknown, fallback = 1): number {
  const parsed = safeNumber(value);
  if (parsed === null || parsed === 0) return fallback;
  const magnitude = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.abs(parsed)));
  // Negative scale is preserved where the user asked for it: mirroring is a
  // legitimate operation, and only the magnitude needs clamping.
  return parsed < 0 ? -magnitude : magnitude;
}

export function safeScale(value: Partial<Vector3>, fallback: Vector3): Vector3 {
  return {
    x: safeScaleComponent(value.x, fallback.x),
    y: safeScaleComponent(value.y, fallback.y),
    z: safeScaleComponent(value.z, fallback.z),
  };
}

/** Position and rotation only need to be finite; any value is reachable. */
export function safeVector(
  value: Partial<Vector3>,
  fallback: Vector3,
): Vector3 {
  return {
    x: safeNumber(value.x) ?? fallback.x,
    y: safeNumber(value.y) ?? fallback.y,
    z: safeNumber(value.z) ?? fallback.z,
  };
}

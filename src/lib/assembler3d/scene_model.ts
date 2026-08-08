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

export type Axis = "x" | "y" | "z";
export const AXES: readonly Axis[] = ["x", "y", "z"] as const;

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

/** True when `id` sits anywhere beneath `ancestorId`. */
export function isDescendantOf(
  scene: Scene,
  id: string,
  ancestorId: string,
): boolean {
  let object = scene.objects[id];
  const guard = new Set<string>();
  while (object?.parentId) {
    if (guard.has(object.id)) return false;
    guard.add(object.id);
    if (object.parentId === ancestorId) return true;
    object = scene.objects[object.parentId];
  }
  return false;
}

/**
 * The outermost ids in a selection.
 *
 * Selecting an assembly and one of its parts means the part is already covered
 * by its ancestor. Operations that copy or delete whole subtrees must act on
 * the ancestor only, or the part is processed twice.
 */
export function topLevelIds(scene: Scene, ids: string[]): string[] {
  const present = ids.filter((id) => scene.objects[id]);
  return present.filter(
    (id) =>
      !present.some(
        (other) => other !== id && isDescendantOf(scene, id, other),
      ),
  );
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

// ── Size ───────────────────────────────────────────────────────────────────

/**
 * Size of each primitive at scale 1, in scene units.
 *
 * Scale is a multiplier and says nothing about how big a part actually is. A
 * CAD user thinks in millimetres, not in "1.4x", so everything size-facing
 * converts through these base sizes. They must match the geometry arguments
 * the viewport builds: change one without the other and the inspector lies
 * about the part.
 */
export const BASE_SIZE: Record<SceneObject["kind"], Vector3> = {
  box: { x: 1, y: 1, z: 1 },
  sphere: { x: 1, y: 1, z: 1 },
  cylinder: { x: 1, y: 1, z: 1 },
  cone: { x: 1, y: 1, z: 1 },
  // A torus lies in XY: outer diameter across x and y, tube across z.
  torus: { x: 1.1, y: 1.1, z: 0.3 },
  // An assembly has no geometry, so its "size" is only what it multiplies its
  // children by. Treating it as a unit cube keeps the maths uniform.
  group: { x: 1, y: 1, z: 1 },
  imported: { x: 1, y: 1, z: 1 },
};

/**
 * Current size in scene units.
 *
 * Absolute, because a mirrored part is still the same size: a negative scale
 * flips it, it does not give it a negative width.
 */
export function dimensionsOf(object: SceneObject): Vector3 {
  const base = BASE_SIZE[object.kind];
  return {
    x: Math.abs(base.x * object.scale.x),
    y: Math.abs(base.y * object.scale.y),
    z: Math.abs(base.z * object.scale.z),
  };
}

/**
 * The scale that produces a requested size.
 *
 * Mirroring survives a resize: if an axis was flipped, typing a new width
 * keeps it flipped rather than silently un-mirroring the part.
 */
export function scaleForDimensions(
  kind: SceneObject["kind"],
  dimensions: Partial<Vector3>,
  currentScale: Vector3,
): Vector3 {
  const base = BASE_SIZE[kind];
  const next: Vector3 = { ...currentScale };
  for (const axis of AXES) {
    const wanted = safeNumber(dimensions[axis]);
    if (wanted === null) continue;
    const sign = currentScale[axis] < 0 ? -1 : 1;
    next[axis] = safeScaleComponent(
      (sign * wanted) / base[axis],
      currentScale[axis],
    );
  }
  return next;
}

/**
 * Resizes an object to a size rather than to a multiplier.
 *
 * `uniform` takes the ratio from whichever axis was given and applies it to
 * the rest, which is what a corner handle does and what "keep proportions"
 * means everywhere else.
 */
export function resizeObject(
  scene: Scene,
  id: string,
  dimensions: Partial<Vector3>,
  uniform = false,
): Scene {
  const object = scene.objects[id];
  if (!object || !isEditable(scene, id)) return scene;

  const current = dimensionsOf(object);
  let wanted = dimensions;

  if (uniform) {
    const axis = AXES.find((each) => safeNumber(dimensions[each]) !== null);
    if (!axis) return scene;
    const target = safeNumber(dimensions[axis])!;
    // A collapsed axis carries no ratio to scale the others by, so there is
    // nothing sensible to infer.
    if (!current[axis]) return scene;
    const ratio = target / current[axis];
    wanted = {
      x: current.x * ratio,
      y: current.y * ratio,
      z: current.z * ratio,
    };
  }

  const scale = scaleForDimensions(object.kind, wanted, object.scale);
  if (
    scale.x === object.scale.x &&
    scale.y === object.scale.y &&
    scale.z === object.scale.z
  ) {
    return scene;
  }
  return updateObject(scene, id, { scale });
}

// ── Copying ────────────────────────────────────────────────────────────────

/**
 * Copies objects together with everything beneath them.
 *
 * Copying only the named objects would turn a duplicated assembly into an
 * empty one, which looks like the copy silently failed. Ids are remapped as
 * the subtree is walked so the copy is self-contained rather than pointing at
 * the original's children.
 */
export function duplicateObjects(
  scene: Scene,
  ids: string[],
  makeId: () => string,
  offset: Vector3 = { x: 1, y: 0, z: 0 },
): { scene: Scene; created: string[] } {
  const roots = topLevelIds(scene, ids);
  if (roots.length === 0) return { scene, created: [] };

  let next = scene;
  const created: string[] = [];

  for (const rootId of roots) {
    const subtree = [rootId, ...descendantsOf(scene, rootId)];
    const remap = new Map<string, string>();
    for (const oldId of subtree) remap.set(oldId, makeId());

    for (const oldId of subtree) {
      const source = scene.objects[oldId]!;
      const isRoot = oldId === rootId;
      next = addObject(next, {
        ...source,
        id: remap.get(oldId)!,
        name: isRoot ? `${source.name} copy` : source.name,
        // Only the root is re-parented and offset. Children keep their
        // positions relative to it, so the copy holds its shape.
        parentId: isRoot
          ? source.parentId
          : (remap.get(source.parentId!) ?? source.parentId),
        position: isRoot
          ? addVectors(source.position, offset)
          : source.position,
      });
    }
    created.push(remap.get(rootId)!);
  }

  return { scene: next, created };
}

/** A detached copy of a subtree, safe to hold while the scene changes. */
export type ClipboardEntry = { root: SceneObject; descendants: SceneObject[] };

export function copyObjects(scene: Scene, ids: string[]): ClipboardEntry[] {
  return topLevelIds(scene, ids).map((id) => ({
    root: { ...scene.objects[id]! },
    descendants: descendantsOf(scene, id).map((childId) => ({
      ...scene.objects[childId]!,
    })),
  }));
}

/**
 * Pastes clipboard entries as new objects.
 *
 * Pasted roots land at the top level rather than back inside whatever assembly
 * they were cut from: that assembly may no longer exist, and a paste that
 * silently vanishes into a collapsed group reads as a paste that did nothing.
 */
export function pasteObjects(
  scene: Scene,
  entries: ClipboardEntry[],
  makeId: () => string,
  offset: Vector3 = { x: 1, y: 0, z: 0 },
): { scene: Scene; created: string[] } {
  let next = scene;
  const created: string[] = [];

  for (const entry of entries) {
    const remap = new Map<string, string>();
    remap.set(entry.root.id, makeId());
    for (const child of entry.descendants) remap.set(child.id, makeId());

    next = addObject(next, {
      ...entry.root,
      id: remap.get(entry.root.id)!,
      parentId: null,
      position: addVectors(entry.root.position, offset),
    });
    for (const child of entry.descendants) {
      next = addObject(next, {
        ...child,
        id: remap.get(child.id)!,
        parentId: remap.get(child.parentId!) ?? null,
      });
    }
    created.push(remap.get(entry.root.id)!);
  }

  return { scene: next, created };
}

// ── Rotation maths ─────────────────────────────────────────────────────────

/**
 * Rotation matrix for an XYZ Euler, matching Three.js's default order.
 *
 * Written out rather than pulled from Three so the scene model stays free of
 * the renderer: these functions have to run in tests with no canvas. The
 * element order is copied from `Matrix4.makeRotationFromEuler`, so a part
 * behaves in the maths exactly as it looks on screen.
 */
export function rotationMatrix(rotation: Vector3): number[][] {
  const a = Math.cos(rotation.x);
  const b = Math.sin(rotation.x);
  const c = Math.cos(rotation.y);
  const d = Math.sin(rotation.y);
  const e = Math.cos(rotation.z);
  const f = Math.sin(rotation.z);
  const ae = a * e;
  const af = a * f;
  const be = b * e;
  const bf = b * f;

  return [
    [c * e, -c * f, d],
    [af + be * d, ae - bf * d, -b * c],
    [bf - ae * d, be + af * d, a * c],
  ];
}

/** Rotates a vector by an XYZ Euler. */
export function rotateVector(value: Vector3, rotation: Vector3): Vector3 {
  const m = rotationMatrix(rotation);
  return {
    x: m[0]![0]! * value.x + m[0]![1]! * value.y + m[0]![2]! * value.z,
    y: m[1]![0]! * value.x + m[1]![1]! * value.y + m[1]![2]! * value.z,
    z: m[2]![0]! * value.x + m[2]![1]! * value.y + m[2]![2]! * value.z,
  };
}

/**
 * Half the space an object occupies along a world axis, once rotated.
 *
 * This is the axis-aligned bound of the oriented box: the sum of each local
 * half-extent projected onto the world axis. A part turned 45 degrees really
 * is wider than its own width, and aligning its face means aligning the face
 * of the box it actually occupies.
 */
export function projectedHalfExtent(object: SceneObject, axis: Axis): number {
  const size = dimensionsOf(object);
  const half = { x: size.x / 2, y: size.y / 2, z: size.z / 2 };
  const m = rotationMatrix(object.rotation);
  const row = m[AXES.indexOf(axis)]!;
  return (
    Math.abs(row[0]!) * half.x +
    Math.abs(row[1]!) * half.y +
    Math.abs(row[2]!) * half.z
  );
}

// ── Alignment ──────────────────────────────────────────────────────────────

/**
 * World-space extent of an object along one axis.
 *
 * Rotation is accounted for: the extent is that of the axis-aligned box around
 * the rotated part, so a face-align lines up the faces you can actually see
 * rather than the faces the part would have had if you had never turned it.
 */
function extentAlong(
  scene: Scene,
  id: string,
  axis: Axis,
): { min: number; centre: number; max: number } {
  const object = scene.objects[id]!;
  const centre = worldPosition(scene, id)[axis];
  const half = projectedHalfExtent(object, axis);
  return { min: centre - half, centre, max: centre + half };
}

export type AlignMode = "min" | "center" | "max";

/**
 * Lines objects up on an axis by face or by centre.
 *
 * The target is taken from the selection itself (leftmost face, mean centre,
 * rightmost face) rather than from the world origin, which is what makes it
 * useful for tidying a built assembly instead of throwing it to the middle.
 */
export function alignObjects(
  scene: Scene,
  ids: string[],
  axis: Axis,
  mode: AlignMode,
): Scene {
  const targets = ids.filter(
    (id) => scene.objects[id] && isEditable(scene, id),
  );
  if (targets.length < 2) return scene;

  const extents = targets.map((id) => extentAlong(scene, id, axis));
  const target =
    mode === "min"
      ? Math.min(...extents.map((each) => each.min))
      : mode === "max"
        ? Math.max(...extents.map((each) => each.max))
        : extents.reduce((total, each) => total + each.centre, 0) /
          extents.length;

  let next = scene;
  targets.forEach((id, index) => {
    const extent = extents[index]!;
    const from =
      mode === "min" ? extent.min : mode === "max" ? extent.max : extent.centre;
    const delta = target - from;
    if (delta === 0) return;
    const object = next.objects[id]!;
    next = updateObject(next, id, {
      position: { ...object.position, [axis]: object.position[axis] + delta },
    });
  });
  return next;
}

/**
 * Spaces objects evenly between the two outermost ones.
 *
 * The extremes stay put: they define the span the user already chose, and
 * moving them would make repeated distributes drift the whole row.
 */
export function distributeObjects(
  scene: Scene,
  ids: string[],
  axis: Axis,
): Scene {
  const targets = ids.filter(
    (id) => scene.objects[id] && isEditable(scene, id),
  );
  // Two objects are already evenly spaced by definition.
  if (targets.length < 3) return scene;

  const ordered = targets
    .map((id) => ({ id, centre: extentAlong(scene, id, axis).centre }))
    .sort((a, b) => a.centre - b.centre);

  const first = ordered[0]!;
  const last = ordered.at(-1)!;
  const step = (last.centre - first.centre) / (ordered.length - 1);

  let next = scene;
  ordered.forEach((entry, index) => {
    if (index === 0 || index === ordered.length - 1) return;
    const delta = first.centre + step * index - entry.centre;
    if (delta === 0) return;
    const object = next.objects[entry.id]!;
    next = updateObject(next, entry.id, {
      position: { ...object.position, [axis]: object.position[axis] + delta },
    });
  });
  return next;
}

/**
 * Mirrors objects across the selection's centre.
 *
 * Both the geometry and the placement flip: a bracket on the left becomes a
 * mirrored bracket on the right. Mirroring a single object therefore flips it
 * in place, since it is its own centre.
 */
export function mirrorObjects(scene: Scene, ids: string[], axis: Axis): Scene {
  const targets = ids.filter(
    (id) => scene.objects[id] && isEditable(scene, id),
  );
  if (targets.length === 0) return scene;

  const centre =
    targets.reduce((total, id) => total + worldPosition(scene, id)[axis], 0) /
    targets.length;

  let next = scene;
  for (const id of targets) {
    const world = worldPosition(scene, id)[axis];
    const object = next.objects[id]!;
    // Reflecting w about c lands at 2c - w, so the move is twice the gap.
    const delta = 2 * (centre - world);
    next = updateObject(next, id, {
      position: { ...object.position, [axis]: object.position[axis] + delta },
      scale: { ...object.scale, [axis]: -object.scale[axis] },
    });
  }
  return next;
}

// ── Arrays ─────────────────────────────────────────────────────────────────

/**
 * Repeats a selection along a direction.
 *
 * `count` is the total number of instances including the original, which is
 * how every CAD array command reads: "eight bolts" means eight, not one plus
 * seven. Each copy is made from the original rather than from the previous
 * copy, so a long run cannot accumulate drift.
 */
export function arrayLinear(
  scene: Scene,
  ids: string[],
  makeId: () => string,
  count: number,
  offset: Vector3,
): { scene: Scene; created: string[] } {
  if (count < 2) return { scene, created: [] };

  let next = scene;
  const created: string[] = [];

  for (let index = 1; index < count; index++) {
    const step: Vector3 = {
      x: offset.x * index,
      y: offset.y * index,
      z: offset.z * index,
    };
    // Copies always come from the original ids, which still exist in `next`,
    // so nothing ever copies a copy.
    const result = duplicateObjects(next, ids, makeId, step);
    next = result.scene;
    for (const id of result.created) {
      const object = next.objects[id]!;
      next = updateObject(next, id, {
        // "Box 1 copy" eight times over is a scene nobody can navigate.
        name: `${object.name.replace(/ copy$/, "")} ${index + 1}`,
      });
      created.push(id);
    }
  }

  return { scene: next, created };
}

/**
 * Repeats a selection around an axis.
 *
 * A full turn divides by `count`, so eight items land every 45 degrees and the
 * last does not sit on top of the first. A partial sweep divides by the gaps
 * instead, so both ends of the arc carry an instance.
 */
export function arrayPolar(
  scene: Scene,
  ids: string[],
  makeId: () => string,
  count: number,
  axis: Axis,
  centre: Vector3,
  totalDegrees = 360,
): { scene: Scene; created: string[] } {
  if (count < 2) return { scene, created: [] };

  const full = Math.abs(totalDegrees) >= 360;
  const stepDegrees = full ? totalDegrees / count : totalDegrees / (count - 1);

  let next = scene;
  const created: string[] = [];

  for (let index = 1; index < count; index++) {
    const radians = (stepDegrees * index * Math.PI) / 180;
    const turn: Vector3 = {
      x: axis === "x" ? radians : 0,
      y: axis === "y" ? radians : 0,
      z: axis === "z" ? radians : 0,
    };

    for (const sourceId of topLevelIds(next, ids)) {
      const world = worldPosition(next, sourceId);
      const swung = addVectors(
        centre,
        rotateVector(subtractVectors(world, centre), turn),
      );
      const result = duplicateObjects(
        next,
        [sourceId],
        makeId,
        subtractVectors(swung, world),
      );
      next = result.scene;

      for (const id of result.created) {
        const object = next.objects[id]!;
        next = updateObject(next, id, {
          name: `${object.name.replace(/ copy$/, "")} ${index + 1}`,
          // The instance turns to face around the circle, not just orbit it.
          rotation: {
            x: wrapAngle(object.rotation.x + turn.x),
            y: wrapAngle(object.rotation.y + turn.y),
            z: wrapAngle(object.rotation.z + turn.z),
          },
        });
        created.push(id);
      }
    }
  }

  return { scene: next, created };
}

// ── Placement helpers ──────────────────────────────────────────────────────

/**
 * Drops objects so they rest on the ground plane.
 *
 * Parts arrive centred on the origin, half of them below the floor. Sitting
 * things on y=0 is the first thing anyone does after adding them, and doing it
 * by eye with a gizmo never quite lands.
 */
export function dropToGround(scene: Scene, ids: string[]): Scene {
  const targets = ids.filter(
    (id) => scene.objects[id] && isEditable(scene, id),
  );
  if (targets.length === 0) return scene;

  let next = scene;
  for (const id of targets) {
    const object = next.objects[id]!;
    const bottom = worldPosition(next, id).y - projectedHalfExtent(object, "y");
    if (bottom === 0) continue;
    next = updateObject(next, id, {
      position: { ...object.position, y: object.position.y - bottom },
    });
  }
  return next;
}

/** Distance and per-axis gap between two objects, for a measurement readout. */
export type Measurement = {
  /** World centre-to-centre offset. */
  delta: Vector3;
  /** Straight-line distance between centres. */
  distance: number;
  /**
   * Clearance between the two bounding boxes per axis.
   *
   * Negative where the boxes overlap on that axis, which is the number you
   * actually want when checking whether two parts foul each other.
   */
  gap: Vector3;
};

export function measureBetween(
  scene: Scene,
  fromId: string,
  toId: string,
): Measurement | null {
  const from = scene.objects[fromId];
  const to = scene.objects[toId];
  if (!from || !to) return null;

  const a = worldPosition(scene, fromId);
  const b = worldPosition(scene, toId);
  const delta = subtractVectors(b, a);

  const gap = { x: 0, y: 0, z: 0 } as Vector3;
  for (const axis of AXES) {
    const reach =
      projectedHalfExtent(from, axis) + projectedHalfExtent(to, axis);
    gap[axis] = Math.abs(delta[axis]) - reach;
  }

  return {
    delta,
    distance: Math.hypot(delta.x, delta.y, delta.z),
    gap,
  };
}

// ── Multi-object transform ─────────────────────────────────────────────────

/** A move, turn and resize applied to a whole selection at once. */
export type GroupTransform = {
  /** World-space translation. */
  translation: Vector3;
  /** Euler delta in radians, added to each object and applied about the pivot. */
  rotation: Vector3;
  /** Per-axis multiplier, applied to each object and to its offset. */
  scale: Vector3;
};

export const IDENTITY_TRANSFORM: GroupTransform = {
  translation: ORIGIN,
  rotation: ORIGIN,
  scale: UNIT_SCALE,
};

/** The mean world position of a set of objects: the pivot a gizmo sits on. */
export function selectionPivot(scene: Scene, ids: string[]): Vector3 {
  const present = ids.filter((id) => scene.objects[id]);
  if (present.length === 0) return ORIGIN;
  const total = present.reduce(
    (sum, id) => addVectors(sum, worldPosition(scene, id)),
    ORIGIN,
  );
  return {
    x: total.x / present.length,
    y: total.y / present.length,
    z: total.z / present.length,
  };
}

/**
 * Transforms several objects as one, about a shared pivot.
 *
 * This is what makes a gizmo work on a multi-selection. Each part is moved by
 * where the pivot carried it *and* turned or resized in place, which is the
 * difference between rotating an assembly and rotating each part on the spot.
 *
 * It is always applied to the scene as it was when the drag began, never to
 * the running result, so a drag cannot compound its own output into a
 * runaway. Callers pass the drag-start scene for exactly that reason.
 */
export function transformAboutPivot(
  scene: Scene,
  ids: string[],
  pivot: Vector3,
  transform: GroupTransform,
): Scene {
  const targets = ids.filter(
    (id) => scene.objects[id] && isEditable(scene, id),
  );
  if (targets.length === 0) return scene;

  let next = scene;
  for (const id of targets) {
    const object = scene.objects[id]!;
    const world = worldPosition(scene, id);
    const offset = subtractVectors(world, pivot);

    const resized: Vector3 = {
      x: offset.x * transform.scale.x,
      y: offset.y * transform.scale.y,
      z: offset.z * transform.scale.z,
    };
    const turned = rotateVector(resized, transform.rotation);
    const target = addVectors(addVectors(pivot, turned), transform.translation);
    const delta = subtractVectors(target, world);

    next = updateObject(next, id, {
      position: addVectors(object.position, delta),
      rotation: addVectors(object.rotation, transform.rotation),
      scale: safeScale(
        {
          x: object.scale.x * transform.scale.x,
          y: object.scale.y * transform.scale.y,
          z: object.scale.z * transform.scale.z,
        },
        object.scale,
      ),
    });
  }
  return next;
}

/**
 * Turns an object about one of its own axes.
 *
 * Kept as a whole-number-of-degrees operation because that is how people
 * describe the turns they actually want: a quarter turn, a flip, ninety more.
 * Angles are wrapped to (-180, 180] so repeated quarter turns read as -90
 * rather than climbing to 450 and beyond in the inspector.
 */
export function rotateObjectBy(
  scene: Scene,
  id: string,
  axis: Axis,
  degrees: number,
): Scene {
  const object = scene.objects[id];
  if (!object || !isEditable(scene, id)) return scene;
  const radians = (degrees * Math.PI) / 180;
  return updateObject(scene, id, {
    rotation: {
      ...object.rotation,
      [axis]: wrapAngle(object.rotation[axis] + radians),
    },
  });
}

/** Brings an angle into (-180°, 180°], the range people read comfortably. */
export function wrapAngle(radians: number): number {
  const turn = Math.PI * 2;
  const wrapped = ((radians % turn) + turn) % turn;
  return wrapped > Math.PI ? wrapped - turn : wrapped;
}

/**
 * Flips an object along one of its axes, in place.
 *
 * Distinct from mirroring a selection: this never moves the part, it only
 * reverses it. Flipping a bracket you have already positioned should not also
 * relocate it.
 */
export function flipObject(scene: Scene, id: string, axis: Axis): Scene {
  const object = scene.objects[id];
  if (!object || !isEditable(scene, id)) return scene;
  return updateObject(scene, id, {
    scale: { ...object.scale, [axis]: -object.scale[axis] },
  });
}

/** Rounds an angle to a step in radians; a step of zero means no snapping. */
export function snapAngle(value: number, stepRadians: number): number {
  if (!stepRadians || stepRadians <= 0) return value;
  return Math.round(value / stepRadians) * stepRadians;
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

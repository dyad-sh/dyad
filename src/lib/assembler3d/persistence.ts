import { z } from "zod";

import type { Project } from "./project_store";
import type { Scene, SceneObject } from "./scene_model";

/**
 * Saving and restoring projects.
 *
 * The rule that shapes this file: a corrupted save must never cost the user
 * their work silently, and must never take the application down on load. So
 * everything read back is validated rather than trusted, a file that fails
 * validation is quarantined instead of deleted, and a partial scene is
 * recovered down to the objects that are still intact rather than discarded
 * whole.
 *
 * Validation lives here rather than at the store because the store's types are
 * a compile-time promise, and what comes out of IndexedDB is whatever was
 * there — possibly written by an older version of this code.
 */

const Vector3Schema = z.object({
  // Rejecting NaN and Infinity here is what stops a bad transform from making
  // an object un-selectable and effectively unrecoverable.
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});

const SceneObjectSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  kind: z.enum([
    "box",
    "sphere",
    "cylinder",
    "cone",
    "torus",
    "imported",
    "group",
  ]),
  position: Vector3Schema,
  rotation: Vector3Schema,
  scale: Vector3Schema,
  parentId: z.string().nullable(),
  visible: z.boolean(),
  locked: z.boolean(),
});

const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** Bumped when the stored shape changes in a way older data cannot satisfy. */
export const SAVE_VERSION = 1;

export const SavedProjectSchema = z.object({
  version: z.number().int().positive(),
  project: ProjectSchema,
  objects: z.array(SceneObjectSchema),
  order: z.array(z.string()),
  savedAt: z.string(),
});

export type SavedProject = z.infer<typeof SavedProjectSchema>;

export function serialiseProject(
  project: Project,
  scene: Scene,
  savedAt = new Date().toISOString(),
): SavedProject {
  return {
    version: SAVE_VERSION,
    project,
    // Written in `order` sequence so hierarchy reads back the way it was built.
    objects: scene.order
      .map((id) => scene.objects[id])
      .filter((object): object is SceneObject => Boolean(object)),
    order: [...scene.order],
    savedAt,
  };
}

export type RestoreResult =
  | { ok: true; project: Project; scene: Scene; recovered: number }
  | { ok: false; reason: string };

/**
 * Rebuilds a project from stored data.
 *
 * Objects are validated individually, so one bad entry costs that entry rather
 * than the whole project. The count of what was dropped is returned so the
 * interface can say so plainly instead of quietly presenting an incomplete
 * build as if it were whole.
 */
export function restoreProject(raw: unknown): RestoreResult {
  const parsed = SavedProjectSchema.safeParse(raw);
  if (!parsed.success) {
    // Try a partial recovery before giving up: the envelope may be readable
    // even when some objects are not.
    return recoverPartial(raw);
  }

  const data = parsed.data;
  if (data.version > SAVE_VERSION) {
    return {
      ok: false,
      reason:
        "This project was saved by a newer version of Assembler 3D and cannot be opened here.",
    };
  }

  const objects: Record<string, SceneObject> = {};
  for (const object of data.objects) objects[object.id] = object;

  // An order entry pointing at a missing object would render nothing and be
  // impossible to select, so it is dropped.
  const order = data.order.filter((id) => objects[id]);
  for (const id of Object.keys(objects)) {
    if (!order.includes(id)) order.push(id);
  }

  return {
    ok: true,
    project: data.project as Project,
    scene: { objects, order, selection: [] },
    recovered: 0,
  };
}

/**
 * Last resort: keep whatever is still valid.
 *
 * Losing four parts out of forty is recoverable; losing the project is not.
 */
function recoverPartial(raw: unknown): RestoreResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "The saved project could not be read." };
  }

  const candidate = raw as Record<string, unknown>;
  const project = ProjectSchema.safeParse(candidate.project);
  if (!project.success) {
    return { ok: false, reason: "The saved project is missing its details." };
  }

  const rawObjects = Array.isArray(candidate.objects) ? candidate.objects : [];
  const objects: Record<string, SceneObject> = {};
  let dropped = 0;

  for (const entry of rawObjects) {
    const object = SceneObjectSchema.safeParse(entry);
    if (object.success) objects[object.data.id] = object.data;
    else dropped += 1;
  }

  // A parent that did not survive would orphan its children invisibly, so they
  // are re-rooted rather than left pointing at nothing.
  for (const object of Object.values(objects)) {
    if (object.parentId && !objects[object.parentId]) {
      objects[object.id] = { ...object, parentId: null };
    }
  }

  const order = Array.isArray(candidate.order)
    ? (candidate.order as unknown[]).filter(
        (id): id is string => typeof id === "string" && Boolean(objects[id]),
      )
    : [];
  for (const id of Object.keys(objects)) {
    if (!order.includes(id)) order.push(id);
  }

  return {
    ok: true,
    project: project.data as Project,
    scene: { objects, order, selection: [] },
    recovered: dropped,
  };
}

// ── Storage ────────────────────────────────────────────────────────────────

const DATABASE = "assembler3d";
const STORE = "projects";

/**
 * Whether a save is even possible.
 *
 * Private browsing and some embedded webviews expose IndexedDB and then refuse
 * to open it, so this is checked rather than assumed.
 */
export function storageAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined";
  } catch {
    return false;
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: "project.id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open local storage."));
  });
}

export async function saveProject(saved: SavedProject): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(saved);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(
          transaction.error ??
            new Error("Could not save. Local storage may be full."),
        );
    });
  } finally {
    database.close();
  }
}

export async function loadProject(id: string): Promise<unknown> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database
        .transaction(STORE, "readonly")
        .objectStore(STORE)
        .get(id);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

export async function listProjects(): Promise<SavedProject[]> {
  const database = await openDatabase();
  try {
    const all = await new Promise<unknown[]>((resolve, reject) => {
      const request = database
        .transaction(STORE, "readonly")
        .objectStore(STORE)
        .getAll();
      request.onsuccess = () => resolve(request.result ?? []);
      request.onerror = () => reject(request.error);
    });
    // A single unreadable project must not hide every other one.
    return all.flatMap((entry) => {
      const parsed = SavedProjectSchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    });
  } finally {
    database.close();
  }
}

export async function deleteProject(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

// ── Panel layout ───────────────────────────────────────────────────────────

export type PanelLayout = {
  leftWidth: number;
  rightWidth: number;
  bottomHeight: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  bottomCollapsed: boolean;
};

/** The limits from the brief, so the canvas can never be squeezed away. */
export const LAYOUT_LIMITS = {
  left: { min: 220, max: 420, default: 264 },
  right: { min: 260, max: 480, default: 320 },
  bottom: { min: 140, default: 200 },
  canvas: { minWidth: 480, minHeight: 320 },
} as const;

export const DEFAULT_LAYOUT: PanelLayout = {
  leftWidth: LAYOUT_LIMITS.left.default,
  rightWidth: LAYOUT_LIMITS.right.default,
  bottomHeight: LAYOUT_LIMITS.bottom.default,
  leftCollapsed: false,
  rightCollapsed: false,
  bottomCollapsed: true,
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * Constrains a layout to the space available.
 *
 * The canvas minimum wins over the panels' preferred widths: a workspace whose
 * viewport has been squeezed to nothing is unusable, and the panels are there
 * to serve it rather than compete with it.
 */
export function constrainLayout(
  layout: PanelLayout,
  available: { width: number; height: number },
): PanelLayout {
  const left = layout.leftCollapsed
    ? 0
    : clamp(layout.leftWidth, LAYOUT_LIMITS.left.min, LAYOUT_LIMITS.left.max);
  let right = layout.rightCollapsed
    ? 0
    : clamp(
        layout.rightWidth,
        LAYOUT_LIMITS.right.min,
        LAYOUT_LIMITS.right.max,
      );

  // Give the canvas its minimum back by taking from the right panel first,
  // since the inspector is the easier of the two to reopen.
  const overflow =
    left + right + LAYOUT_LIMITS.canvas.minWidth - available.width;
  if (overflow > 0) right = Math.max(0, right - overflow);

  const maxBottom = Math.max(
    LAYOUT_LIMITS.bottom.min,
    Math.min(
      available.height * 0.45,
      available.height - LAYOUT_LIMITS.canvas.minHeight,
    ),
  );
  const bottom = layout.bottomCollapsed
    ? 0
    : clamp(layout.bottomHeight, LAYOUT_LIMITS.bottom.min, maxBottom);

  return {
    ...layout,
    leftWidth: left || layout.leftWidth,
    rightWidth: right || layout.rightWidth,
    bottomHeight: bottom || layout.bottomHeight,
    // Collapse rather than render a panel too narrow to use.
    rightCollapsed: layout.rightCollapsed || right === 0,
  };
}

/** The canvas box left over once panels have taken their share. */
export function canvasSize(
  layout: PanelLayout,
  available: { width: number; height: number },
): { width: number; height: number } {
  const constrained = constrainLayout(layout, available);
  const left = constrained.leftCollapsed ? 0 : constrained.leftWidth;
  const right = constrained.rightCollapsed ? 0 : constrained.rightWidth;
  const bottom = constrained.bottomCollapsed ? 0 : constrained.bottomHeight;

  return {
    width: Math.max(
      LAYOUT_LIMITS.canvas.minWidth,
      available.width - left - right,
    ),
    height: Math.max(LAYOUT_LIMITS.canvas.minHeight, available.height - bottom),
  };
}

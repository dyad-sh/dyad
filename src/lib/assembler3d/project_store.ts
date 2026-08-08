import { create } from "zustand";

import {
  addObject,
  clearSelection,
  commit,
  createHistory,
  emptyScene,
  groupObjects,
  ORIGIN,
  redo,
  removeObjects,
  select,
  toggleSelection,
  translateObjects,
  undo,
  ungroupObjects,
  safeScale,
  safeVector,
  UNIT_SCALE,
  type History,
  type Scene,
  type SceneObject,
} from "./scene_model";

/**
 * Project and scene state for Assembler3D.
 *
 * Every mutation goes through the history wrapper rather than editing the
 * scene directly, so undo works by restoring a previous state instead of
 * trying to reverse each operation individually. That is the difference
 * between undo that always works and undo that mostly works.
 */

export type ProjectCategory =
  | "air-drone"
  | "fpv-drone"
  | "fixed-wing"
  | "helicopter"
  | "sea-drone"
  | "surface-vessel"
  | "underwater"
  | "ground-robot"
  | "humanoid"
  | "electronics"
  | "custom";

export type Project = {
  id: string;
  name: string;
  category: ProjectCategory;
  createdAt: string;
  updatedAt: string;
};

export type PrimitiveKind = Exclude<SceneObject["kind"], "group" | "imported">;

type Assembler3DState = {
  project: Project | null;
  history: History;
  gridStep: number;
  showGrid: boolean;

  createProject: (name: string, category: ProjectCategory) => Project;
  closeProject: () => void;

  addPrimitive: (kind: PrimitiveKind) => string;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  moveSelection: (delta: { x: number; y: number; z: number }) => void;
  groupSelection: () => void;
  ungroupSelection: () => void;

  selectObject: (id: string, additive: boolean) => void;
  clearSelection: () => void;
  renameObject: (id: string, name: string) => void;
  setVisibility: (id: string, visible: boolean) => void;
  setLocked: (id: string, locked: boolean) => void;
  /** Numeric transform editing from the inspector, validated before storing. */
  setTransform: (
    id: string,
    field: "position" | "rotation" | "scale",
    axis: "x" | "y" | "z",
    value: number,
  ) => void;
  resetScale: (id: string) => void;

  transformMode: "translate" | "rotate" | "scale";
  transformSpace: "world" | "local";
  setTransformMode: (mode: "translate" | "rotate" | "scale") => void;
  toggleTransformSpace: () => void;
  /** Snapshot before a gizmo drag, so the whole drag is one undo step. */
  beginTransform: () => void;
  endTransform: () => void;
  applyTransform: (id: string, changes: Partial<SceneObject>) => void;

  openProject: (project: Project, scene: Scene) => void;
  undo: () => void;
  redo: () => void;
  setGridStep: (step: number) => void;
  toggleGrid: () => void;
};

/** Readable default names: "Box 3" rather than a uuid fragment. */
function nextName(scene: Scene, kind: string): string {
  const label = kind.charAt(0).toUpperCase() + kind.slice(1);
  const taken = Object.values(scene.objects).filter((object) =>
    object.name.startsWith(label),
  ).length;
  return `${label} ${taken + 1}`;
}

const newId = () => crypto.randomUUID();

/**
 * Scene as it was when a gizmo drag began.
 *
 * Held outside the store because it changes many times a second during a drag
 * and nothing should re-render for it.
 */
let dragStart: Scene | null = null;

export const useAssembler3D = create<Assembler3DState>((set, get) => ({
  project: null,
  history: createHistory(emptyScene()),
  gridStep: 0.5,
  showGrid: true,
  transformMode: "translate",
  transformSpace: "world",

  createProject(name, category) {
    const project: Project = {
      id: newId(),
      name: name.trim() || "Untitled project",
      category,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    // A new project starts genuinely empty. Seeding it with sample parts would
    // leave the user unable to tell our guesses from their work.
    set({ project, history: createHistory(emptyScene()) });
    return project;
  },

  closeProject() {
    set({ project: null, history: createHistory(emptyScene()) });
  },

  addPrimitive(kind) {
    const { history } = get();
    const id = newId();
    const object: SceneObject = {
      id,
      name: nextName(history.present, kind),
      kind,
      position: ORIGIN,
      rotation: ORIGIN,
      scale: UNIT_SCALE,
      parentId: null,
      visible: true,
      locked: false,
    };
    const scene = select(addObject(history.present, object), [id]);
    set({ history: commit(history, scene) });
    return id;
  },

  deleteSelection() {
    const { history } = get();
    const { selection } = history.present;
    if (selection.length === 0) return;
    set({
      history: commit(history, removeObjects(history.present, selection)),
    });
  },

  duplicateSelection() {
    const { history } = get();
    const scene = history.present;
    if (scene.selection.length === 0) return;

    let next = scene;
    const copies: string[] = [];
    for (const id of scene.selection) {
      const source = scene.objects[id];
      if (!source) continue;
      const copyId = newId();
      copies.push(copyId);
      next = addObject(next, {
        ...source,
        id: copyId,
        name: `${source.name} copy`,
        // Offset so the duplicate is visible rather than hidden inside its
        // original.
        position: {
          x: source.position.x + 1,
          y: source.position.y,
          z: source.position.z,
        },
      });
    }
    set({ history: commit(history, select(next, copies)) });
  },

  moveSelection(delta) {
    const { history, gridStep } = get();
    const scene = history.present;
    if (scene.selection.length === 0) return;
    set({
      history: commit(
        history,
        translateObjects(scene, scene.selection, delta, gridStep),
      ),
    });
  },

  groupSelection() {
    const { history } = get();
    const scene = history.present;
    if (scene.selection.length < 2) return;
    set({
      history: commit(history, groupObjects(scene, scene.selection, newId())),
    });
  },

  ungroupSelection() {
    const { history } = get();
    const scene = history.present;
    const target = scene.selection.find(
      (id) => scene.objects[id]?.kind === "group",
    );
    if (!target) return;
    set({ history: commit(history, ungroupObjects(scene, target)) });
  },

  selectObject(id, additive) {
    const { history } = get();
    const scene = additive
      ? toggleSelection(history.present, id)
      : select(history.present, [id]);
    // Selection is not an edit, so it does not enter the undo history.
    set({ history: { ...history, present: scene } });
  },

  clearSelection() {
    const { history } = get();
    set({ history: { ...history, present: clearSelection(history.present) } });
  },

  renameObject(id, name) {
    const { history } = get();
    const object = history.present.objects[id];
    if (!object) return;
    const scene = {
      ...history.present,
      objects: {
        ...history.present.objects,
        [id]: { ...object, name: name.trim() || object.name },
      },
    };
    set({ history: commit(history, scene) });
  },

  setVisibility(id, visible) {
    const { history } = get();
    const object = history.present.objects[id];
    if (!object) return;
    set({
      history: commit(history, {
        ...history.present,
        objects: {
          ...history.present.objects,
          [id]: { ...object, visible },
        },
      }),
    });
  },

  setLocked(id, locked) {
    const { history } = get();
    const object = history.present.objects[id];
    if (!object) return;
    set({
      history: commit(history, {
        ...history.present,
        objects: { ...history.present.objects, [id]: { ...object, locked } },
      }),
    });
  },

  setTransformMode(mode) {
    set({ transformMode: mode });
  },

  toggleTransformSpace() {
    set({
      transformSpace: get().transformSpace === "world" ? "local" : "world",
    });
  },

  beginTransform() {
    // Remember where the drag started. Every pointer move updates the scene
    // in place, and only the finished drag becomes a history entry.
    dragStart = get().history.present;
  },

  applyTransform(id, changes) {
    const { history } = get();
    const object = history.present.objects[id];
    if (!object) return;
    set({
      history: {
        ...history,
        present: {
          ...history.present,
          objects: {
            ...history.present.objects,
            [id]: { ...object, ...changes },
          },
        },
      },
    });
  },

  endTransform() {
    const { history } = get();
    if (!dragStart || dragStart === history.present) {
      dragStart = null;
      return;
    }
    // One entry for the whole drag: the state before it, then the state after.
    const settled = history.present;
    set({ history: commit({ ...history, present: dragStart }, settled) });
    dragStart = null;
  },

  setTransform(id, field, axis, value) {
    const { history } = get();
    const object = history.present.objects[id];
    if (!object || object.locked) return;

    const current = object[field];
    const proposed = { ...current, [axis]: value };
    // Scale is clamped rather than accepted blindly: a zero scale makes an
    // object unclickable and effectively unrecoverable without undo.
    const next =
      field === "scale"
        ? safeScale(proposed, current)
        : safeVector(proposed, current);

    if (next.x === current.x && next.y === current.y && next.z === current.z) {
      return;
    }

    set({
      history: commit(history, {
        ...history.present,
        objects: {
          ...history.present.objects,
          [id]: { ...object, [field]: next },
        },
      }),
    });
  },

  resetScale(id) {
    const { history } = get();
    const object = history.present.objects[id];
    if (!object) return;
    set({
      history: commit(history, {
        ...history.present,
        objects: {
          ...history.present.objects,
          [id]: { ...object, scale: UNIT_SCALE },
        },
      }),
    });
  },

  openProject(project, scene) {
    // A reopened project starts a fresh history: undoing past the point where
    // the file was saved would be undoing work the user never did this session.
    set({ project, history: createHistory(scene) });
  },

  undo() {
    set({ history: undo(get().history) });
  },

  redo() {
    set({ history: redo(get().history) });
  },

  setGridStep(step) {
    set({ gridStep: Math.max(0, step) });
  },

  toggleGrid() {
    set({ showGrid: !get().showGrid });
  },
}));

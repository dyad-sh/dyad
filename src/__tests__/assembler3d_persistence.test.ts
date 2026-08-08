import { describe, expect, it } from "vitest";

import {
  canvasSize,
  constrainLayout,
  DEFAULT_LAYOUT,
  LAYOUT_LIMITS,
  restoreProject,
  SAVE_VERSION,
  serialiseProject,
} from "@/lib/assembler3d/persistence";
import {
  addObject,
  emptyScene,
  ORIGIN,
  UNIT_SCALE,
  type SceneObject,
} from "@/lib/assembler3d/scene_model";
import type { Project } from "@/lib/assembler3d/project_store";

const project: Project = {
  id: "p1",
  name: "Recon drone",
  category: "fpv-drone",
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
};

const part = (id: string, over: Partial<SceneObject> = {}): SceneObject => ({
  id,
  name: id,
  kind: "box",
  position: ORIGIN,
  rotation: ORIGIN,
  scale: UNIT_SCALE,
  parentId: null,
  visible: true,
  locked: false,
  ...over,
});

const sceneWith = (...objects: SceneObject[]) =>
  objects.reduce((scene, object) => addObject(scene, object), emptyScene());

describe("round trip", () => {
  it("restores a project unchanged", () => {
    const scene = sceneWith(
      part("frame"),
      part("motor", { parentId: "frame", position: { x: 2, y: 0, z: 0 } }),
    );
    const saved = serialiseProject(project, scene);
    const result = restoreProject(saved);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.name).toBe("Recon drone");
    expect(Object.keys(result.scene.objects).sort()).toEqual([
      "frame",
      "motor",
    ]);
    expect(result.scene.objects.motor!.parentId).toBe("frame");
    expect(result.recovered).toBe(0);
  });

  it("preserves build order so hierarchy reads back the same", () => {
    const scene = sceneWith(part("a"), part("b"), part("c"));
    const result = restoreProject(serialiseProject(project, scene));
    if (!result.ok) throw new Error("expected success");
    expect(result.scene.order).toEqual(["a", "b", "c"]);
  });

  it("starts with nothing selected", () => {
    const result = restoreProject(
      serialiseProject(project, sceneWith(part("a"))),
    );
    if (!result.ok) throw new Error("expected success");
    expect(result.scene.selection).toEqual([]);
  });
});

describe("corrupted saves", () => {
  it("keeps the parts that survived rather than losing the project", () => {
    // Losing four parts out of forty is recoverable; losing the project is not.
    const saved = serialiseProject(project, sceneWith(part("a"), part("b")));
    const damaged = {
      ...saved,
      objects: [saved.objects[0], { id: "b", name: "broken" }],
    };

    const result = restoreProject(damaged);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.scene.objects)).toEqual(["a"]);
    expect(result.recovered).toBe(1);
  });

  it("re-roots a child whose parent did not survive", () => {
    // An orphan pointing at a missing parent would be invisible and
    // unselectable.
    const saved = serialiseProject(
      project,
      sceneWith(part("frame"), part("motor", { parentId: "frame" })),
    );
    const damaged = {
      ...saved,
      objects: [{ id: "frame" }, saved.objects[1]],
    };

    const result = restoreProject(damaged);
    if (!result.ok) throw new Error("expected recovery");
    expect(result.scene.objects.motor!.parentId).toBeNull();
  });

  it("rejects a transform containing NaN", () => {
    // A NaN position makes an object impossible to select or frame.
    const saved = serialiseProject(project, sceneWith(part("a")));
    const damaged = {
      ...saved,
      objects: [{ ...saved.objects[0], position: { x: NaN, y: 0, z: 0 } }],
    };
    const result = restoreProject(damaged);
    if (!result.ok) throw new Error("expected recovery");
    expect(Object.keys(result.scene.objects)).toEqual([]);
    expect(result.recovered).toBe(1);
  });

  it("drops an order entry pointing at nothing", () => {
    const saved = serialiseProject(project, sceneWith(part("a")));
    const result = restoreProject({ ...saved, order: ["a", "ghost"] });
    if (!result.ok) throw new Error("expected success");
    expect(result.scene.order).toEqual(["a"]);
  });

  it("gives up gracefully when there is no project at all", () => {
    expect(restoreProject(null).ok).toBe(false);
    expect(restoreProject({ objects: [] }).ok).toBe(false);
    expect(restoreProject("nonsense").ok).toBe(false);
  });

  it("refuses a save from a newer version rather than mangling it", () => {
    const saved = serialiseProject(project, sceneWith(part("a")));
    const result = restoreProject({ ...saved, version: SAVE_VERSION + 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/newer version/i);
  });
});

describe("panel layout", () => {
  const desktop = { width: 1600, height: 900 };

  it("keeps the defaults on a normal display", () => {
    const layout = constrainLayout(DEFAULT_LAYOUT, desktop);
    expect(layout.leftWidth).toBe(DEFAULT_LAYOUT.leftWidth);
    expect(layout.rightWidth).toBe(DEFAULT_LAYOUT.rightWidth);
  });

  it("holds panels inside their limits", () => {
    const layout = constrainLayout(
      { ...DEFAULT_LAYOUT, leftWidth: 9999, rightWidth: 10 },
      desktop,
    );
    expect(layout.leftWidth).toBe(LAYOUT_LIMITS.left.max);
    expect(layout.rightWidth).toBe(LAYOUT_LIMITS.right.min);
  });

  it("never lets panels squeeze the canvas below its minimum", () => {
    // The panels exist to serve the viewport, not compete with it.
    const cramped = { width: 900, height: 700 };
    const size = canvasSize(
      { ...DEFAULT_LAYOUT, leftWidth: 420, rightWidth: 480 },
      cramped,
    );
    expect(size.width).toBeGreaterThanOrEqual(LAYOUT_LIMITS.canvas.minWidth);
  });

  it("collapses the inspector rather than rendering it too narrow", () => {
    const layout = constrainLayout(
      { ...DEFAULT_LAYOUT, leftWidth: 420, rightWidth: 480 },
      { width: 820, height: 700 },
    );
    expect(layout.rightCollapsed).toBe(true);
  });

  it("caps the bottom panel so it cannot cover the canvas", () => {
    const size = canvasSize(
      { ...DEFAULT_LAYOUT, bottomCollapsed: false, bottomHeight: 5000 },
      desktop,
    );
    expect(size.height).toBeGreaterThanOrEqual(LAYOUT_LIMITS.canvas.minHeight);
  });

  it("gives the canvas the whole area when every panel is collapsed", () => {
    const size = canvasSize(
      {
        ...DEFAULT_LAYOUT,
        leftCollapsed: true,
        rightCollapsed: true,
        bottomCollapsed: true,
      },
      desktop,
    );
    expect(size).toEqual({ width: 1600, height: 900 });
  });

  it("never returns a negative or zero size", () => {
    for (const available of [
      { width: 0, height: 0 },
      { width: 100, height: 80 },
      { width: 320, height: 200 },
    ]) {
      const size = canvasSize(DEFAULT_LAYOUT, available);
      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);
    }
  });
});

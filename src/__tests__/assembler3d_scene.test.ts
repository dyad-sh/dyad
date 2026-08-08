import { describe, expect, it } from "vitest";

import {
  addObject,
  childrenOf,
  clearSelection,
  commit,
  createHistory,
  descendantsOf,
  emptyScene,
  groupObjects,
  isEditable,
  ORIGIN,
  redo,
  removeObjects,
  select,
  snapToGrid,
  toggleSelection,
  translateObjects,
  undo,
  ungroupObjects,
  UNIT_SCALE,
  updateObject,
  worldPosition,
  type SceneObject,
} from "@/lib/assembler3d/scene_model";

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

describe("snapToGrid", () => {
  it("rounds to the nearest step", () => {
    expect(snapToGrid({ x: 1.2, y: 2.7, z: -0.4 }, 1)).toEqual({
      x: 1,
      y: 3,
      z: -0,
    });
  });

  it("leaves the value alone when snapping is off", () => {
    const free = { x: 1.234, y: 5.678, z: 9 };
    expect(snapToGrid(free, 0)).toEqual(free);
  });
});

describe("hierarchy", () => {
  it("adds a child's position to its parent's", () => {
    const scene = sceneWith(
      part("frame", { position: { x: 10, y: 0, z: 0 } }),
      part("motor", { parentId: "frame", position: { x: 2, y: 0, z: 0 } }),
    );
    expect(worldPosition(scene, "motor")).toEqual({ x: 12, y: 0, z: 0 });
  });

  it("lists direct children only", () => {
    const scene = sceneWith(
      part("frame"),
      part("arm", { parentId: "frame" }),
      part("motor", { parentId: "arm" }),
    );
    expect(childrenOf(scene, "frame").map((o) => o.id)).toEqual(["arm"]);
    expect(descendantsOf(scene, "frame")).toEqual(["arm", "motor"]);
  });

  it("does not hang on a cycle", () => {
    // Malformed data must not lock the render loop.
    const scene = sceneWith(
      part("a", { parentId: "b" }),
      part("b", { parentId: "a" }),
    );
    expect(() => worldPosition(scene, "a")).not.toThrow();
  });
});

describe("locking", () => {
  it("treats a locked object as uneditable", () => {
    const scene = sceneWith(part("bolt", { locked: true }));
    expect(isEditable(scene, "bolt")).toBe(false);
  });

  it("locks children through their parent", () => {
    // Locking an assembly has to mean the parts inside it are locked too.
    const scene = sceneWith(
      part("frame", { locked: true }),
      part("motor", { parentId: "frame" }),
    );
    expect(isEditable(scene, "motor")).toBe(false);
  });

  it("refuses to move a locked object", () => {
    const scene = sceneWith(part("bolt", { locked: true }));
    const moved = translateObjects(scene, ["bolt"], { x: 5, y: 0, z: 0 });
    expect(moved.objects.bolt!.position).toEqual(ORIGIN);
  });
});

describe("removeObjects", () => {
  it("takes descendants with it", () => {
    const scene = sceneWith(
      part("frame"),
      part("arm", { parentId: "frame" }),
      part("motor", { parentId: "arm" }),
      part("battery"),
    );
    const next = removeObjects(scene, ["frame"]);
    expect(Object.keys(next.objects)).toEqual(["battery"]);
    expect(next.order).toEqual(["battery"]);
  });

  it("drops removed objects from the selection", () => {
    const scene = select(sceneWith(part("a"), part("b")), ["a", "b"]);
    expect(removeObjects(scene, ["a"]).selection).toEqual(["b"]);
  });
});

describe("selection", () => {
  it("ignores ids that are not in the scene", () => {
    expect(select(sceneWith(part("a")), ["a", "ghost"]).selection).toEqual([
      "a",
    ]);
  });

  it("toggles an id in and out", () => {
    let scene = sceneWith(part("a"));
    scene = toggleSelection(scene, "a");
    expect(scene.selection).toEqual(["a"]);
    scene = toggleSelection(scene, "a");
    expect(scene.selection).toEqual([]);
  });

  it("clears everything", () => {
    const scene = select(sceneWith(part("a"), part("b")), ["a", "b"]);
    expect(clearSelection(scene).selection).toEqual([]);
  });
});

describe("grouping", () => {
  it("places the assembly at the centre of its members", () => {
    const scene = sceneWith(
      part("a", { position: { x: 0, y: 0, z: 0 } }),
      part("b", { position: { x: 10, y: 0, z: 0 } }),
    );
    const grouped = groupObjects(scene, ["a", "b"], "asm");
    expect(grouped.objects.asm!.position).toEqual({ x: 5, y: 0, z: 0 });
  });

  it("leaves members exactly where they were on screen", () => {
    // Grouping changes structure, not placement.
    const scene = sceneWith(
      part("a", { position: { x: 0, y: 0, z: 0 } }),
      part("b", { position: { x: 10, y: 0, z: 0 } }),
    );
    const grouped = groupObjects(scene, ["a", "b"], "asm");
    expect(worldPosition(grouped, "a")).toEqual({ x: 0, y: 0, z: 0 });
    expect(worldPosition(grouped, "b")).toEqual({ x: 10, y: 0, z: 0 });
  });

  it("selects the new assembly", () => {
    const scene = sceneWith(
      part("a"),
      part("b", { position: { x: 4, y: 0, z: 0 } }),
    );
    expect(groupObjects(scene, ["a", "b"], "asm").selection).toEqual(["asm"]);
  });

  it("refuses to group a single object", () => {
    const scene = sceneWith(part("a"));
    expect(groupObjects(scene, ["a"], "asm")).toBe(scene);
  });

  it("moves members together when the assembly moves", () => {
    const scene = groupObjects(
      sceneWith(part("a"), part("b", { position: { x: 10, y: 0, z: 0 } })),
      ["a", "b"],
      "asm",
    );
    const moved = translateObjects(scene, ["asm"], { x: 0, y: 5, z: 0 });
    expect(worldPosition(moved, "a")).toEqual({ x: 0, y: 5, z: 0 });
    expect(worldPosition(moved, "b")).toEqual({ x: 10, y: 5, z: 0 });
  });
});

describe("ungrouping", () => {
  it("keeps parts where they are", () => {
    // A part that jumps across the workspace on detach has lost the placement
    // the user spent time on.
    const scene = groupObjects(
      sceneWith(
        part("a", { position: { x: 0, y: 0, z: 0 } }),
        part("b", { position: { x: 10, y: 0, z: 0 } }),
      ),
      ["a", "b"],
      "asm",
    );
    const released = ungroupObjects(scene, "asm");
    expect(worldPosition(released, "a")).toEqual({ x: 0, y: 0, z: 0 });
    expect(worldPosition(released, "b")).toEqual({ x: 10, y: 0, z: 0 });
  });

  it("removes the empty assembly and selects the parts", () => {
    const scene = groupObjects(
      sceneWith(part("a"), part("b", { position: { x: 4, y: 0, z: 0 } })),
      ["a", "b"],
      "asm",
    );
    const released = ungroupObjects(scene, "asm");
    expect(released.objects.asm).toBeUndefined();
    expect(released.selection.sort()).toEqual(["a", "b"]);
  });

  it("ignores an object that is not an assembly", () => {
    const scene = sceneWith(part("a"));
    expect(ungroupObjects(scene, "a")).toBe(scene);
  });
});

describe("history", () => {
  it("steps back and forward through edits", () => {
    let history = createHistory(sceneWith(part("a")));
    const moved = translateObjects(history.present, ["a"], {
      x: 5,
      y: 0,
      z: 0,
    });
    history = commit(history, moved);

    expect(history.present.objects.a!.position.x).toBe(5);
    history = undo(history);
    expect(history.present.objects.a!.position.x).toBe(0);
    history = redo(history);
    expect(history.present.objects.a!.position.x).toBe(5);
  });

  it("does nothing at the ends", () => {
    const history = createHistory(sceneWith(part("a")));
    expect(undo(history)).toBe(history);
    expect(redo(history)).toBe(history);
  });

  it("drops the redo branch after a new edit", () => {
    // Offering back a future the user has branched away from is confusing.
    let history = createHistory(sceneWith(part("a")));
    history = commit(
      history,
      updateObject(history.present, "a", { name: "one" }),
    );
    history = undo(history);
    history = commit(
      history,
      updateObject(history.present, "a", { name: "two" }),
    );

    expect(history.future).toEqual([]);
    expect(history.present.objects.a!.name).toBe("two");
  });

  it("keeps history bounded", () => {
    let history = createHistory(sceneWith(part("a")));
    for (let index = 0; index < 80; index += 1) {
      history = commit(
        history,
        updateObject(history.present, "a", { name: `step-${index}` }),
      );
    }
    expect(history.past.length).toBeLessThanOrEqual(50);
  });

  it("ignores a commit of unchanged state", () => {
    const history = createHistory(sceneWith(part("a")));
    expect(commit(history, history.present)).toBe(history);
  });
});

import { describe, expect, it } from "vitest";

import {
  addObject,
  alignObjects,
  copyObjects,
  dimensionsOf,
  distributeObjects,
  duplicateObjects,
  emptyScene,
  groupObjects,
  isDescendantOf,
  mirrorObjects,
  ORIGIN,
  pasteObjects,
  resizeObject,
  scaleForDimensions,
  snapAngle,
  topLevelIds,
  UNIT_SCALE,
  updateObject,
  worldPosition,
  type Scene,
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

const sceneWith = (...objects: SceneObject[]): Scene =>
  objects.reduce((scene, object) => addObject(scene, object), emptyScene());

let counter = 0;
const makeId = () => `copy-${++counter}`;

describe("dimensions", () => {
  it("reports size as base geometry times scale", () => {
    const object = part("a", { scale: { x: 2, y: 3, z: 4 } });
    expect(dimensionsOf(object)).toEqual({ x: 2, y: 3, z: 4 });
  });

  it("reports a mirrored part at its real size, not a negative one", () => {
    const object = part("a", { scale: { x: -2, y: 1, z: 1 } });
    expect(dimensionsOf(object).x).toBe(2);
  });

  it("uses the torus's own extents rather than a unit cube", () => {
    const object = part("a", { kind: "torus" });
    expect(dimensionsOf(object)).toEqual({ x: 1.1, y: 1.1, z: 0.3 });
  });

  it("keeps mirroring when a size is typed in", () => {
    const scale = scaleForDimensions("box", { x: 4 }, { x: -1, y: 1, z: 1 });
    expect(scale.x).toBe(-4);
  });
});

describe("resizeObject", () => {
  it("sets an exact size on one axis", () => {
    const scene = sceneWith(part("a"));
    const next = resizeObject(scene, "a", { y: 2.5 });
    expect(dimensionsOf(next.objects.a!)).toEqual({ x: 1, y: 2.5, z: 1 });
  });

  it("carries the other axes when proportions are locked", () => {
    const scene = sceneWith(part("a", { scale: { x: 1, y: 2, z: 4 } }));
    const next = resizeObject(scene, "a", { x: 2 }, true);
    // The x ratio is 2, so every axis doubles and the shape is preserved.
    expect(dimensionsOf(next.objects.a!)).toEqual({ x: 2, y: 4, z: 8 });
  });

  it("refuses to resize a locked object", () => {
    const scene = sceneWith(part("a", { locked: true }));
    expect(resizeObject(scene, "a", { x: 5 })).toBe(scene);
  });

  it("clamps a zero size instead of collapsing the object", () => {
    const scene = sceneWith(part("a"));
    const next = resizeObject(scene, "a", { x: 0 });
    // Zero is refused by safeScaleComponent, so the object keeps its width.
    expect(dimensionsOf(next.objects.a!).x).toBe(1);
  });
});

describe("duplicateObjects", () => {
  it("copies an assembly's children rather than producing an empty group", () => {
    let scene = sceneWith(
      part("a", { position: { x: 0, y: 0, z: 0 } }),
      part("b", { position: { x: 2, y: 0, z: 0 } }),
    );
    scene = groupObjects(scene, ["a", "b"], "g");

    const { scene: next, created } = duplicateObjects(scene, ["g"], makeId);
    const copyId = created[0]!;
    const copiedChildren = Object.values(next.objects).filter(
      (object) => object.parentId === copyId,
    );

    expect(created).toHaveLength(1);
    expect(copiedChildren).toHaveLength(2);
    // The originals are untouched.
    expect(
      Object.values(next.objects).filter((o) => o.parentId === "g"),
    ).toHaveLength(2);
  });

  it("does not copy a child twice when its parent is also selected", () => {
    let scene = sceneWith(
      part("a"),
      part("b", { position: { x: 2, y: 0, z: 0 } }),
    );
    scene = groupObjects(scene, ["a", "b"], "g");

    const before = Object.keys(scene.objects).length;
    const { scene: next } = duplicateObjects(scene, ["g", "a"], makeId);

    // One group plus two children, not a stray extra copy of "a".
    expect(Object.keys(next.objects).length - before).toBe(3);
  });

  it("offsets the copy so it is not hidden inside the original", () => {
    const scene = sceneWith(part("a"));
    const { scene: next, created } = duplicateObjects(scene, ["a"], makeId);
    expect(next.objects[created[0]!]!.position.x).toBe(1);
  });
});

describe("clipboard", () => {
  it("survives deletion of the original", () => {
    let scene = sceneWith(part("a", { name: "Bracket" }));
    const clipboard = copyObjects(scene, ["a"]);
    scene = { ...scene, objects: {}, order: [], selection: [] };

    const { scene: next, created } = pasteObjects(scene, clipboard, makeId);
    expect(next.objects[created[0]!]!.name).toBe("Bracket");
  });

  it("pastes an assembly with its parts re-linked to the copy", () => {
    let scene = sceneWith(
      part("a"),
      part("b", { position: { x: 2, y: 0, z: 0 } }),
    );
    scene = groupObjects(scene, ["a", "b"], "g");
    const clipboard = copyObjects(scene, ["g"]);

    const { scene: next, created } = pasteObjects(scene, clipboard, makeId);
    const children = Object.values(next.objects).filter(
      (object) => object.parentId === created[0]!,
    );
    expect(children).toHaveLength(2);
  });

  it("copies only the outermost selection", () => {
    let scene = sceneWith(
      part("a"),
      part("b", { position: { x: 2, y: 0, z: 0 } }),
    );
    scene = groupObjects(scene, ["a", "b"], "g");
    expect(copyObjects(scene, ["g", "a"])).toHaveLength(1);
  });
});

describe("alignObjects", () => {
  it("aligns centres on an axis", () => {
    const scene = sceneWith(
      part("a", { position: { x: 0, y: 0, z: 0 } }),
      part("b", { position: { x: 4, y: 0, z: 0 } }),
    );
    const next = alignObjects(scene, ["a", "b"], "x", "center");
    expect(next.objects.a!.position.x).toBe(2);
    expect(next.objects.b!.position.x).toBe(2);
  });

  it("aligns faces, accounting for differing sizes", () => {
    const scene = sceneWith(
      part("a", { position: { x: 0, y: 0, z: 0 } }),
      part("b", {
        position: { x: 4, y: 0, z: 0 },
        scale: { x: 4, y: 1, z: 1 },
      }),
    );
    // "a" spans -0.5..0.5, "b" spans 2..6. The leftmost face is -0.5, so "b"
    // moves until its own left face sits there: centre 1.5.
    const next = alignObjects(scene, ["a", "b"], "x", "min");
    expect(next.objects.a!.position.x).toBe(0);
    expect(next.objects.b!.position.x).toBe(1.5);
  });

  it("leaves a locked object where it is", () => {
    const scene = sceneWith(
      part("a"),
      part("b", { position: { x: 4, y: 0, z: 0 }, locked: true }),
    );
    const next = alignObjects(scene, ["a", "b"], "x", "center");
    expect(next.objects.b!.position.x).toBe(4);
  });

  it("does nothing with a single object", () => {
    const scene = sceneWith(part("a"));
    expect(alignObjects(scene, ["a"], "x", "center")).toBe(scene);
  });
});

describe("distributeObjects", () => {
  it("spaces the middle objects evenly and leaves the ends alone", () => {
    const scene = sceneWith(
      part("a", { position: { x: 0, y: 0, z: 0 } }),
      part("b", { position: { x: 1, y: 0, z: 0 } }),
      part("c", { position: { x: 9, y: 0, z: 0 } }),
    );
    const next = distributeObjects(scene, ["a", "b", "c"], "x");
    expect(next.objects.a!.position.x).toBe(0);
    expect(next.objects.b!.position.x).toBe(4.5);
    expect(next.objects.c!.position.x).toBe(9);
  });

  it("needs three objects to mean anything", () => {
    const scene = sceneWith(part("a"), part("b"));
    expect(distributeObjects(scene, ["a", "b"], "x")).toBe(scene);
  });
});

describe("mirrorObjects", () => {
  it("flips a single object in place", () => {
    const scene = sceneWith(part("a", { position: { x: 3, y: 0, z: 0 } }));
    const next = mirrorObjects(scene, ["a"], "x");
    expect(next.objects.a!.position.x).toBe(3);
    expect(next.objects.a!.scale.x).toBe(-1);
  });

  it("swaps a pair across their shared centre", () => {
    const scene = sceneWith(
      part("a", { position: { x: 0, y: 0, z: 0 } }),
      part("b", { position: { x: 4, y: 0, z: 0 } }),
    );
    const next = mirrorObjects(scene, ["a", "b"], "x");
    expect(next.objects.a!.position.x).toBe(4);
    expect(next.objects.b!.position.x).toBe(0);
  });

  it("mirrors twice back to the original placement", () => {
    const scene = sceneWith(
      part("a", { position: { x: 0, y: 0, z: 0 } }),
      part("b", { position: { x: 4, y: 0, z: 0 } }),
    );
    const next = mirrorObjects(
      mirrorObjects(scene, ["a", "b"], "x"),
      ["a", "b"],
      "x",
    );
    expect(next.objects.a!.position.x).toBe(0);
    expect(next.objects.b!.position.x).toBe(4);
    expect(next.objects.a!.scale.x).toBe(1);
  });
});

describe("hierarchy helpers", () => {
  it("recognises a nested descendant", () => {
    let scene = sceneWith(
      part("a"),
      part("b", { position: { x: 2, y: 0, z: 0 } }),
    );
    scene = groupObjects(scene, ["a", "b"], "g");
    expect(isDescendantOf(scene, "a", "g")).toBe(true);
    expect(isDescendantOf(scene, "g", "a")).toBe(false);
  });

  it("reduces a selection to its outermost members", () => {
    let scene = sceneWith(
      part("a"),
      part("b", { position: { x: 2, y: 0, z: 0 } }),
    );
    scene = groupObjects(scene, ["a", "b"], "g");
    expect(topLevelIds(scene, ["g", "a", "b"])).toEqual(["g"]);
  });

  it("keeps world position stable through a group", () => {
    let scene = sceneWith(
      part("a", { position: { x: 0, y: 0, z: 0 } }),
      part("b", { position: { x: 4, y: 0, z: 0 } }),
    );
    scene = groupObjects(scene, ["a", "b"], "g");
    expect(worldPosition(scene, "b").x).toBe(4);
  });
});

describe("snapAngle", () => {
  it("rounds to the nearest step", () => {
    const step = Math.PI / 4;
    expect(snapAngle(0.9, step)).toBeCloseTo(step);
  });

  it("treats a zero step as no snapping", () => {
    expect(snapAngle(0.37, 0)).toBe(0.37);
  });
});

describe("updateObject", () => {
  it("ignores an unknown id rather than inventing an object", () => {
    const scene = sceneWith(part("a"));
    expect(updateObject(scene, "missing", { name: "x" })).toBe(scene);
  });
});

import { beforeEach, describe, expect, it } from "vitest";

import { useAssembler3D } from "@/lib/assembler3d/project_store";

const store = () => useAssembler3D.getState();
const scene = () => store().history.present;

beforeEach(() => {
  useAssembler3D.getState().closeProject();
});

describe("createProject", () => {
  it("creates a project, which is what the button now does", () => {
    // The button used to be inert; this is the behaviour it needed.
    expect(store().project).toBeNull();
    const project = store().createProject("Recon drone", "fpv-drone");

    expect(store().project).not.toBeNull();
    expect(project.name).toBe("Recon drone");
    expect(project.category).toBe("fpv-drone");
  });

  it("falls back to a readable name when none is typed", () => {
    expect(store().createProject("   ", "custom").name).toBe(
      "Untitled project",
    );
  });

  it("starts genuinely empty", () => {
    // Seeding sample parts would leave the user unable to tell our guesses
    // from their own work.
    store().createProject("Empty", "custom");
    expect(Object.keys(scene().objects)).toEqual([]);
    expect(scene().selection).toEqual([]);
  });

  it("discards the previous project's scene", () => {
    store().createProject("First", "custom");
    store().addPrimitive("box");
    store().createProject("Second", "custom");
    expect(Object.keys(scene().objects)).toEqual([]);
  });
});

describe("building a scene", () => {
  beforeEach(() => {
    store().createProject("Test", "custom");
  });

  it("adds a primitive and selects it", () => {
    const id = store().addPrimitive("box");
    expect(scene().objects[id]!.kind).toBe("box");
    expect(scene().selection).toEqual([id]);
  });

  it("names objects readably rather than by id", () => {
    store().addPrimitive("box");
    store().addPrimitive("box");
    const names = Object.values(scene().objects).map((o) => o.name);
    expect(names).toEqual(["Box 1", "Box 2"]);
  });

  it("deletes the selection", () => {
    const id = store().addPrimitive("sphere");
    store().deleteSelection();
    expect(scene().objects[id]).toBeUndefined();
  });

  it("offsets a duplicate so it is not hidden inside the original", () => {
    const id = store().addPrimitive("box");
    store().duplicateSelection();
    const copy = Object.values(scene().objects).find((o) => o.id !== id);
    expect(copy!.position.x).toBe(1);
    expect(scene().selection).toEqual([copy!.id]);
  });

  it("groups a multiple selection into one assembly", () => {
    const a = store().addPrimitive("box");
    store().addPrimitive("sphere");
    store().selectObject(a, true);
    store().groupSelection();

    const group = Object.values(scene().objects).find(
      (o) => o.kind === "group",
    );
    expect(group).toBeDefined();
    expect(scene().selection).toEqual([group!.id]);
  });

  it("refuses to group a single object", () => {
    store().addPrimitive("box");
    store().groupSelection();
    expect(Object.values(scene().objects).some((o) => o.kind === "group")).toBe(
      false,
    );
  });
});

describe("selection", () => {
  beforeEach(() => {
    store().createProject("Test", "custom");
  });

  it("replaces the selection by default and adds when additive", () => {
    const a = store().addPrimitive("box");
    const b = store().addPrimitive("sphere");

    store().selectObject(a, false);
    expect(scene().selection).toEqual([a]);

    store().selectObject(b, true);
    expect(scene().selection.sort()).toEqual([a, b].sort());
  });

  it("does not put selection changes into the undo history", () => {
    // Undoing a click would be maddening; only edits should be undoable.
    const id = store().addPrimitive("box");
    const before = store().history.past.length;
    store().selectObject(id, false);
    store().clearSelection();
    expect(store().history.past.length).toBe(before);
  });
});

describe("undo and redo", () => {
  beforeEach(() => {
    store().createProject("Test", "custom");
  });

  it("steps an edit back and forward", () => {
    store().addPrimitive("box");
    expect(Object.keys(scene().objects)).toHaveLength(1);

    store().undo();
    expect(Object.keys(scene().objects)).toHaveLength(0);

    store().redo();
    expect(Object.keys(scene().objects)).toHaveLength(1);
  });

  it("restores a deleted object", () => {
    const id = store().addPrimitive("cone");
    store().deleteSelection();
    store().undo();
    expect(scene().objects[id]).toBeDefined();
  });
});

describe("locking", () => {
  beforeEach(() => {
    store().createProject("Test", "custom");
  });

  it("stops a locked object being moved", () => {
    const id = store().addPrimitive("box");
    store().setLocked(id, true);
    store().moveSelection({ x: 5, y: 0, z: 0 });
    expect(scene().objects[id]!.position.x).toBe(0);
  });
});

describe("transform gizmo drag", () => {
  beforeEach(() => {
    store().createProject("Test", "custom");
  });

  it("records a whole drag as one undo step", () => {
    // Without this, a drag would create hundreds of history entries and undo
    // would step back a pixel at a time.
    const id = store().addPrimitive("box");
    const before = store().history.past.length;

    store().beginTransform();
    for (let step = 1; step <= 20; step += 1) {
      store().applyTransform(id, { position: { x: step, y: 0, z: 0 } });
    }
    store().endTransform();

    expect(store().history.past.length).toBe(before + 1);
    expect(scene().objects[id]!.position.x).toBe(20);
  });

  it("undoes to exactly where the drag started", () => {
    const id = store().addPrimitive("box");
    store().beginTransform();
    store().applyTransform(id, { position: { x: 9, y: 0, z: 0 } });
    store().endTransform();

    store().undo();
    expect(scene().objects[id]!.position.x).toBe(0);
    store().redo();
    expect(scene().objects[id]!.position.x).toBe(9);
  });

  it("adds no history when a drag moves nothing", () => {
    store().addPrimitive("box");
    const before = store().history.past.length;
    store().beginTransform();
    store().endTransform();
    expect(store().history.past.length).toBe(before);
  });
});

describe("transform mode", () => {
  beforeEach(() => {
    store().createProject("Test", "custom");
  });

  it("switches between the three gizmos", () => {
    for (const mode of ["translate", "rotate", "scale"] as const) {
      store().setTransformMode(mode);
      expect(store().transformMode).toBe(mode);
    }
  });

  it("toggles world and local space", () => {
    expect(store().transformSpace).toBe("world");
    store().toggleTransformSpace();
    expect(store().transformSpace).toBe("local");
    store().toggleTransformSpace();
    expect(store().transformSpace).toBe("world");
  });
});

describe("numeric editing", () => {
  beforeEach(() => {
    store().createProject("Test", "custom");
  });

  it("edits a position axis", () => {
    const id = store().addPrimitive("box");
    store().setTransform(id, "position", "x", 12.5);
    expect(scene().objects[id]!.position.x).toBe(12.5);
  });

  it("refuses a zero scale", () => {
    // A zero scale collapses the object: unclickable, unframeable, only undo
    // gets it back.
    const id = store().addPrimitive("box");
    store().setTransform(id, "scale", "x", 0);
    expect(scene().objects[id]!.scale.x).toBe(1);
  });

  it("refuses NaN", () => {
    const id = store().addPrimitive("box");
    store().setTransform(id, "position", "y", Number.NaN);
    expect(scene().objects[id]!.position.y).toBe(0);
  });

  it("clamps an enormous scale rather than swallowing the scene", () => {
    const id = store().addPrimitive("box");
    store().setTransform(id, "scale", "x", 1e9);
    expect(scene().objects[id]!.scale.x).toBe(10_000);
  });

  it("clamps a vanishingly small scale", () => {
    const id = store().addPrimitive("box");
    store().setTransform(id, "scale", "y", 1e-12);
    expect(scene().objects[id]!.scale.y).toBe(0.001);
  });

  it("keeps a negative scale, which is a legitimate mirror", () => {
    const id = store().addPrimitive("box");
    store().setTransform(id, "scale", "z", -2);
    expect(scene().objects[id]!.scale.z).toBe(-2);
  });

  it("will not edit a locked object", () => {
    const id = store().addPrimitive("box");
    store().setLocked(id, true);
    store().setTransform(id, "position", "x", 99);
    expect(scene().objects[id]!.position.x).toBe(0);
  });

  it("makes each edit one undo step", () => {
    const id = store().addPrimitive("box");
    store().setTransform(id, "position", "x", 5);
    store().undo();
    expect(scene().objects[id]!.position.x).toBe(0);
  });

  it("adds no history when the value is unchanged", () => {
    const id = store().addPrimitive("box");
    const before = store().history.past.length;
    store().setTransform(id, "position", "x", 0);
    expect(store().history.past.length).toBe(before);
  });

  it("resets scale back to unit", () => {
    const id = store().addPrimitive("box");
    store().setTransform(id, "scale", "x", 7);
    store().resetScale(id);
    expect(scene().objects[id]!.scale).toEqual({ x: 1, y: 1, z: 1 });
  });
});

describe("applyTransform validation", () => {
  it("refuses a zero scale from a gizmo drag", () => {
    store().createProject("p", "custom");
    const id = store().addPrimitive("box");

    // Dragging a scale handle all the way down used to write 0, which makes
    // the object unclickable and takes the gizmo away with it.
    store().applyTransform(id, { scale: { x: 0, y: 1, z: 1 } });

    expect(scene().objects[id]!.scale.x).toBe(1);
  });

  it("clamps an enormous scale from a gizmo drag", () => {
    store().createProject("p", "custom");
    const id = store().addPrimitive("box");

    store().applyTransform(id, { scale: { x: 1e9, y: 1, z: 1 } });

    expect(scene().objects[id]!.scale.x).toBe(10_000);
  });

  it("keeps a mirrored axis mirrored", () => {
    store().createProject("p", "custom");
    const id = store().addPrimitive("box");

    store().applyTransform(id, { scale: { x: -2, y: 1, z: 1 } });

    expect(scene().objects[id]!.scale.x).toBe(-2);
  });

  it("ignores a non-finite position rather than corrupting the scene", () => {
    store().createProject("p", "custom");
    const id = store().addPrimitive("box");

    store().applyTransform(id, { position: { x: Number.NaN, y: 3, z: 0 } });

    const object = scene().objects[id]!;
    expect(object.position.x).toBe(0);
    // The usable part of the change still lands.
    expect(object.position.y).toBe(3);
  });
});

describe("rotation snap setting", () => {
  it("defaults to a 15 degree detent", () => {
    expect(store().rotationSnapDegrees).toBe(15);
  });

  it("refuses a negative snap", () => {
    store().setRotationSnap(-5);
    expect(store().rotationSnapDegrees).toBe(0);
  });
});

describe("multi-object gizmo", () => {
  it("moves every selected object as one body", () => {
    store().createProject("p", "custom");
    const a = store().addPrimitive("box");
    const b = store().addPrimitive("box");
    store().setTransform(b, "position", "x", 4);
    store().selectObject(a, false);
    store().selectObject(b, true);

    store().beginTransform();
    store().applyGroupTransform(
      { x: 2, y: 0, z: 0 },
      {
        translation: { x: 1, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    );
    store().endTransform();

    expect(scene().objects[a]!.position.x).toBe(1);
    expect(scene().objects[b]!.position.x).toBe(5);
  });

  it("does not compound when a drag reports many times", () => {
    store().createProject("p", "custom");
    const a = store().addPrimitive("box");
    store().selectObject(a, false);

    store().beginTransform();
    // A real drag fires on every pointer move. Each report is the delta from
    // where the drag began, so repeating one must not keep adding.
    for (let i = 0; i < 5; i++) {
      store().applyGroupTransform(
        { x: 0, y: 0, z: 0 },
        {
          translation: { x: 3, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      );
    }
    store().endTransform();

    expect(scene().objects[a]!.position.x).toBe(3);
  });

  it("records the whole drag as one undo step", () => {
    store().createProject("p", "custom");
    const a = store().addPrimitive("box");
    store().selectObject(a, false);
    const before = store().history.past.length;

    store().beginTransform();
    store().applyGroupTransform(
      { x: 0, y: 0, z: 0 },
      {
        translation: { x: 2, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    );
    store().endTransform();

    expect(store().history.past.length).toBe(before + 1);
    store().undo();
    expect(scene().objects[a]!.position.x).toBe(0);
  });
});

describe("snapRotationToDetent", () => {
  it("rounds a hand-turned part onto the detent", () => {
    store().createProject("p", "custom");
    // Set explicitly: the detent is store state that outlives closeProject,
    // so an earlier test can otherwise decide this one's outcome.
    store().setRotationSnap(15);
    const id = store().addPrimitive("box");
    // 20 degrees, with a 15 degree detent, rounds to 15.
    store().setTransform(id, "rotation", "z", (20 * Math.PI) / 180);

    store().snapRotationToDetent(id);

    expect(scene().objects[id]!.rotation.z).toBeCloseTo((15 * Math.PI) / 180);
  });

  it("does nothing when the detent is off", () => {
    store().createProject("p", "custom");
    const id = store().addPrimitive("box");
    store().setTransform(id, "rotation", "z", 0.37);
    store().setRotationSnap(0);

    store().snapRotationToDetent(id);

    expect(scene().objects[id]!.rotation.z).toBe(0.37);
  });
});

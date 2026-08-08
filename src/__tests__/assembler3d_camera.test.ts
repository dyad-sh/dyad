import { describe, expect, it } from "vitest";

import {
  boundsCentre,
  boundsSize,
  cameraLimits,
  DEFAULT_CAMERA,
  focusSelection,
  frameAll,
  isCameraLost,
  isValidCameraState,
  orbitTarget,
  restoreCamera,
  sceneBounds,
  clampCamera,
  clampPolarAngle,
  clippingPlanes,
  MIN_ELEVATION,
  POLAR_LIMITS,
  viewScene,
} from "@/lib/assembler3d/camera";
import {
  addObject,
  emptyScene,
  ORIGIN,
  select,
  UNIT_SCALE,
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

describe("sceneBounds", () => {
  it("wraps every visible object", () => {
    const scene = sceneWith(
      part("a", { position: { x: -5, y: 0, z: 0 } }),
      part("b", { position: { x: 5, y: 0, z: 0 } }),
    );
    const bounds = sceneBounds(scene);
    expect(bounds.min.x).toBeCloseTo(-5.5);
    expect(bounds.max.x).toBeCloseTo(5.5);
  });

  it("ignores hidden objects", () => {
    // Framing to include something invisible shrinks the build for no reason
    // the user can see.
    const scene = sceneWith(
      part("a"),
      part("far", { position: { x: 100, y: 0, z: 0 }, visible: false }),
    );
    expect(sceneBounds(scene).max.x).toBeCloseTo(0.5);
  });

  it("accounts for scale", () => {
    const scene = sceneWith(part("a", { scale: { x: 10, y: 1, z: 1 } }));
    expect(sceneBounds(scene).max.x).toBeCloseTo(5);
  });

  it("gives an empty scene a usable default box", () => {
    expect(boundsSize(sceneBounds(emptyScene()))).toBeGreaterThan(0);
  });

  it("never returns a zero size for a flat object", () => {
    // A zero size would put the camera exactly inside the geometry.
    const scene = sceneWith(part("plane", { scale: { x: 5, y: 0, z: 5 } }));
    expect(boundsSize(sceneBounds(scene))).toBeGreaterThan(0);
  });
});

describe("cameraLimits", () => {
  it("scales with the build rather than being fixed", () => {
    const small = cameraLimits(sceneBounds(sceneWith(part("a"))));
    const large = cameraLimits(
      sceneBounds(sceneWith(part("a", { scale: { x: 100, y: 100, z: 100 } }))),
    );
    expect(large.maxDistance).toBeGreaterThan(small.maxDistance);
    expect(large.minDistance).toBeGreaterThan(small.minDistance);
  });

  it("keeps a minimum distance so the camera cannot pass through the model", () => {
    const limits = cameraLimits(sceneBounds(sceneWith(part("a"))));
    expect(limits.minDistance).toBeGreaterThan(0);
    expect(limits.minDistance).toBeLessThan(limits.maxDistance);
  });

  it("keeps a maximum so the project cannot shrink to a dot", () => {
    const limits = cameraLimits(sceneBounds(sceneWith(part("a"))));
    expect(Number.isFinite(limits.maxDistance)).toBe(true);
  });
});

describe("frameAll", () => {
  it("targets the centre of the build", () => {
    const scene = sceneWith(
      part("a", { position: { x: -10, y: 0, z: 0 } }),
      part("b", { position: { x: 10, y: 0, z: 0 } }),
    );
    expect(frameAll(scene).target.x).toBeCloseTo(0);
  });

  it("stands far enough back to see the whole thing", () => {
    const small = frameAll(sceneWith(part("a")));
    const large = frameAll(
      sceneWith(part("a", { scale: { x: 50, y: 50, z: 50 } })),
    );
    const reach = (camera: typeof small) =>
      Math.hypot(
        camera.position.x - camera.target.x,
        camera.position.y - camera.target.y,
        camera.position.z - camera.target.z,
      );
    expect(reach(large)).toBeGreaterThan(reach(small));
  });

  it("uses a three-quarter view rather than a flat elevation", () => {
    const camera = frameAll(sceneWith(part("a")));
    expect(camera.position.y).toBeGreaterThan(camera.target.y);
    expect(camera.position.x).not.toBeCloseTo(camera.target.x);
  });

  it("produces something usable for an empty scene", () => {
    const camera = frameAll(emptyScene());
    expect(Number.isFinite(camera.position.x)).toBe(true);
    expect(isValidCameraState(camera)).toBe(true);
  });
});

describe("focusSelection", () => {
  it("frames only what is selected", () => {
    const scene = select(
      sceneWith(
        part("near"),
        part("far", { position: { x: 100, y: 0, z: 0 } }),
      ),
      ["far"],
    );
    expect(focusSelection(scene).target.x).toBeCloseTo(100);
  });

  it("falls back to the whole build when nothing is selected", () => {
    const scene = sceneWith(
      part("a", { position: { x: -10, y: 0, z: 0 } }),
      part("b", { position: { x: 10, y: 0, z: 0 } }),
    );
    expect(focusSelection(scene).target.x).toBeCloseTo(0);
  });
});

describe("orbitTarget", () => {
  it("pivots around the selection when there is one", () => {
    const scene = select(
      sceneWith(part("a"), part("b", { position: { x: 20, y: 0, z: 0 } })),
      ["b"],
    );
    expect(orbitTarget(scene).x).toBeCloseTo(20);
  });

  it("pivots around the build when nothing is selected", () => {
    const scene = sceneWith(
      part("a", { position: { x: -6, y: 0, z: 0 } }),
      part("b", { position: { x: 6, y: 0, z: 0 } }),
    );
    expect(orbitTarget(scene).x).toBeCloseTo(0);
  });
});

describe("lost camera", () => {
  const scene = sceneWith(part("a"));
  const bounds = sceneBounds(scene);

  it("does not complain about a normal view", () => {
    expect(isCameraLost(frameAll(scene), bounds)).toBe(false);
  });

  it("notices when the camera has zoomed far past the build", () => {
    expect(
      isCameraLost(
        { position: { x: 0, y: 0, z: 100_000 }, target: ORIGIN },
        bounds,
      ),
    ).toBe(true);
  });

  it("notices when panning has carried the target away", () => {
    // The other way to lose a build: the camera is close to a target that is
    // nowhere near the project.
    expect(
      isCameraLost(
        {
          position: { x: 5000, y: 5000, z: 5000 },
          target: { x: 5000, y: 5000, z: 4990 },
        },
        bounds,
      ),
    ).toBe(true);
  });

  it("judges against the build's own size", () => {
    // A view that is lost for a bolt is perfectly normal for a boat.
    const boat = sceneBounds(
      sceneWith(part("hull", { scale: { x: 400, y: 60, z: 80 } })),
    );
    const camera = { position: { x: 0, y: 0, z: 900 }, target: ORIGIN };
    expect(isCameraLost(camera, boat)).toBe(false);
    expect(isCameraLost(camera, bounds)).toBe(true);
  });
});

describe("restoreCamera", () => {
  const scene = sceneWith(part("a"));

  it("keeps a saved camera that still makes sense", () => {
    const saved = frameAll(scene);
    expect(restoreCamera(saved, scene)).toEqual(saved);
  });

  it("frames the build when there is nothing saved", () => {
    expect(restoreCamera(undefined, scene)).toEqual(frameAll(scene));
  });

  it("rejects a corrupted camera rather than restoring nowhere", () => {
    const broken = {
      position: { x: NaN, y: 0, z: 0 },
      target: ORIGIN,
    };
    expect(restoreCamera(broken, scene)).toEqual(frameAll(scene));
  });

  it("rejects a camera sitting exactly on its target", () => {
    // No viewing direction; the user would see nothing.
    expect(isValidCameraState({ position: ORIGIN, target: ORIGIN })).toBe(
      false,
    );
  });

  it("re-frames a saved camera that was already lost", () => {
    const lost = { position: { x: 0, y: 0, z: 500_000 }, target: ORIGIN };
    expect(restoreCamera(lost, scene)).toEqual(frameAll(scene));
  });
});

describe("defaults", () => {
  it("ships a valid reset view", () => {
    expect(isValidCameraState(DEFAULT_CAMERA)).toBe(true);
  });

  it("centres the bounds helper correctly", () => {
    expect(
      boundsCentre({ min: { x: -2, y: 0, z: -4 }, max: { x: 4, y: 6, z: 0 } }),
    ).toEqual({ x: 1, y: 3, z: -2 });
  });
});

describe("ground-plane safety", () => {
  const scene = sceneWith(part("a"));
  const bounds = sceneBounds(scene);

  it("stops the camera orbiting under the floor", () => {
    // The root cause of the vanishing grid: crossing the floor puts the grid
    // edge-on, where it is infinitely thin and disappears.
    expect(POLAR_LIMITS.max).toBeLessThan(Math.PI / 2);
    expect(clampPolarAngle(Math.PI)).toBe(POLAR_LIMITS.max);
    expect(clampPolarAngle(-1)).toBe(POLAR_LIMITS.min);
  });

  it("keeps a usable low angle rather than forcing a top-down view", () => {
    expect(POLAR_LIMITS.max).toBeGreaterThan(Math.PI / 2 - 0.2);
  });

  it("treats a non-finite angle as the lowest safe angle", () => {
    expect(clampPolarAngle(NaN)).toBe(POLAR_LIMITS.max);
  });

  it("lifts a camera that has dropped below the ground", () => {
    const clamped = clampCamera(
      { position: { x: 3, y: -50, z: 3 }, target: ORIGIN },
      bounds,
    );
    expect(clamped.position.y).toBeGreaterThanOrEqual(MIN_ELEVATION);
  });

  it("keeps the target from sinking below the floor", () => {
    const clamped = clampCamera(
      { position: { x: 3, y: 3, z: 3 }, target: { x: 0, y: -80, z: 0 } },
      bounds,
    );
    expect(clamped.target.y).toBeGreaterThanOrEqual(0);
  });

  it("pulls a runaway pan back toward the build", () => {
    const clamped = clampCamera(
      {
        position: { x: 9000, y: 5, z: 9000 },
        target: { x: 9000, y: 0, z: 9000 },
      },
      bounds,
    );
    expect(Math.abs(clamped.target.x)).toBeLessThan(9000);
  });

  it("holds distance inside the zoom limits", () => {
    const limits = cameraLimits(bounds);
    const tooFar = clampCamera(
      { position: { x: 0, y: 100_000, z: 0 }, target: ORIGIN },
      bounds,
    );
    const reach = Math.hypot(
      tooFar.position.x - tooFar.target.x,
      tooFar.position.y - tooFar.target.y,
      tooFar.position.z - tooFar.target.z,
    );
    expect(reach).toBeLessThanOrEqual(limits.maxDistance + 0.001);
  });

  it("recovers to a known-good camera when values are not finite", () => {
    // A NaN position renders nothing and cannot be nudged back.
    const fallback = frameAll(scene);
    expect(
      clampCamera(
        { position: { x: NaN, y: 1, z: 1 }, target: ORIGIN },
        bounds,
        fallback,
      ),
    ).toEqual(fallback);
  });

  it("recovers a camera sitting exactly on its target", () => {
    // Lifting it off the floor and pushing it out to the minimum distance is
    // a valid recovery; what matters is that the result is usable.
    const recovered = clampCamera(
      { position: ORIGIN, target: ORIGIN },
      bounds,
      frameAll(scene),
    );
    expect(isValidCameraState(recovered)).toBe(true);
    expect(recovered.position.y).toBeGreaterThanOrEqual(MIN_ELEVATION);
  });

  it("leaves a healthy camera alone", () => {
    const healthy = frameAll(scene);
    const clamped = clampCamera(healthy, bounds);
    expect(clamped.target.x).toBeCloseTo(healthy.target.x);
    expect(clamped.position.y).toBeCloseTo(healthy.position.y);
  });
});

describe("clippingPlanes", () => {
  it("derives planes from the build rather than fixed extremes", () => {
    const small = clippingPlanes(sceneBounds(sceneWith(part("a"))));
    const large = clippingPlanes(
      sceneBounds(sceneWith(part("a", { scale: { x: 200, y: 200, z: 200 } }))),
    );
    expect(large.far).toBeGreaterThan(small.far);
    expect(small.near).toBeLessThan(small.far);
  });

  it("keeps the near plane small enough not to clip nearby geometry", () => {
    const planes = clippingPlanes(sceneBounds(sceneWith(part("a"))));
    expect(planes.near).toBeLessThanOrEqual(0.05);
  });
});

describe("standard views", () => {
  const scene = (() => {
    let s = emptyScene();
    s = addObject(s, {
      id: "a",
      name: "a",
      kind: "box",
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      parentId: null,
      visible: true,
      locked: false,
    });
    return s;
  })();

  it("puts the camera overhead for a top view", () => {
    const view = viewScene(scene, "top");
    expect(view.position.y).toBeGreaterThan(0);
    expect(Math.abs(view.position.x)).toBeLessThan(0.001);
  });

  it("keeps a top view off exact vertical so orbit has an up", () => {
    // Exactly overhead leaves the camera with no unambiguous roll, and the
    // polar clamp would fight it on the first drag.
    expect(Math.abs(viewScene(scene, "top").position.z)).toBeGreaterThan(0);
  });

  it("looks down an axis for a front view", () => {
    const view = viewScene(scene, "front");
    expect(view.position.z).toBeGreaterThan(0);
    expect(Math.abs(view.position.y)).toBeLessThan(0.001);
  });

  it("puts right and left on opposite sides", () => {
    expect(viewScene(scene, "right").position.x).toBeGreaterThan(0);
    expect(viewScene(scene, "left").position.x).toBeLessThan(0);
  });

  it("always aims at the build", () => {
    for (const view of ["top", "front", "right", "iso"] as const) {
      expect(viewScene(scene, view).target).toEqual({ x: 0, y: 0, z: 0 });
    }
  });
});

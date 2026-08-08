import {
  addVectors,
  worldPosition,
  type Scene,
  type Vector3,
} from "./scene_model";

/**
 * Camera framing and limits.
 *
 * The failure this exists to prevent is losing the project. Unbounded zoom
 * lets a user shrink a build to an invisible dot or push the near plane
 * through it, and in both cases the scene is still there but no longer
 * findable. Limits are derived from what is actually in the scene rather than
 * fixed, because a 40mm FPV frame and a 4m vessel need very different bounds.
 */

export type Bounds = { min: Vector3; max: Vector3 };

/** Half-extent assumed for a primitive, matching the unit geometry used. */
const PRIMITIVE_RADIUS = 0.5;

export const EMPTY_BOUNDS: Bounds = {
  min: { x: -1, y: -1, z: -1 },
  max: { x: 1, y: 1, z: 1 },
};

/**
 * The box containing every visible object.
 *
 * Hidden objects are excluded: framing to include something the user cannot
 * see makes the visible build smaller for no reason they can perceive.
 */
export function sceneBounds(scene: Scene, ids?: string[]): Bounds {
  const considered = (ids ?? scene.order).filter((id) => {
    const object = scene.objects[id];
    return object && object.visible && object.kind !== "group";
  });
  if (considered.length === 0) return EMPTY_BOUNDS;

  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };

  for (const id of considered) {
    const object = scene.objects[id]!;
    const centre = worldPosition(scene, id);
    // Scale widens the box; a stretched part occupies more room than its
    // unit geometry suggests.
    const extent = {
      x: PRIMITIVE_RADIUS * Math.abs(object.scale.x),
      y: PRIMITIVE_RADIUS * Math.abs(object.scale.y),
      z: PRIMITIVE_RADIUS * Math.abs(object.scale.z),
    };
    min.x = Math.min(min.x, centre.x - extent.x);
    min.y = Math.min(min.y, centre.y - extent.y);
    min.z = Math.min(min.z, centre.z - extent.z);
    max.x = Math.max(max.x, centre.x + extent.x);
    max.y = Math.max(max.y, centre.y + extent.y);
    max.z = Math.max(max.z, centre.z + extent.z);
  }

  return { min, max };
}

export function boundsCentre(bounds: Bounds): Vector3 {
  return {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: (bounds.min.y + bounds.max.y) / 2,
    z: (bounds.min.z + bounds.max.z) / 2,
  };
}

/** Longest edge of the box; the number framing and limits key off. */
export function boundsSize(bounds: Bounds): number {
  return Math.max(
    bounds.max.x - bounds.min.x,
    bounds.max.y - bounds.min.y,
    bounds.max.z - bounds.min.z,
    // Never zero: a single flat plane would otherwise produce a distance of 0
    // and put the camera inside it.
    0.001,
  );
}

export type CameraLimits = { minDistance: number; maxDistance: number };

/**
 * Zoom bounds for the current scene.
 *
 * Close enough to inspect a fastener, far enough to see a whole airframe, and
 * no further. The multipliers are deliberately generous so legitimate work is
 * never blocked, while still stopping the two failures that lose the project.
 */
export function cameraLimits(bounds: Bounds): CameraLimits {
  const size = boundsSize(bounds);
  return {
    // Stops the near plane being driven through the geometry.
    minDistance: Math.max(0.05, size * 0.15),
    // Stops the build shrinking to an unfindable dot.
    maxDistance: Math.max(5, size * 25),
  };
}

/** Distance that fits the box in view for a given field of view. */
export function framingDistance(bounds: Bounds, fovDegrees = 45): number {
  const size = boundsSize(bounds);
  const fov = (fovDegrees * Math.PI) / 180;
  // A little padding so the build does not sit flush against the edges.
  return (size / 2 / Math.tan(fov / 2)) * 1.6;
}

export type CameraState = {
  position: Vector3;
  target: Vector3;
};

/** Consistent three-quarter view, so framing never lands on a flat elevation. */
const VIEW_DIRECTION = { x: 0.7, y: 0.55, z: 1 };

export function frameBounds(bounds: Bounds, fovDegrees = 45): CameraState {
  const target = boundsCentre(bounds);
  const distance = framingDistance(bounds, fovDegrees);
  const length = Math.hypot(
    VIEW_DIRECTION.x,
    VIEW_DIRECTION.y,
    VIEW_DIRECTION.z,
  );

  return {
    target,
    position: addVectors(target, {
      x: (VIEW_DIRECTION.x / length) * distance,
      y: (VIEW_DIRECTION.y / length) * distance,
      z: (VIEW_DIRECTION.z / length) * distance,
    }),
  };
}

/** Frames the whole project, or a sensible default when it is empty. */
export function frameAll(scene: Scene, fovDegrees = 45): CameraState {
  return frameBounds(sceneBounds(scene), fovDegrees);
}

/** Frames the current selection, falling back to the whole scene. */
export function focusSelection(scene: Scene, fovDegrees = 45): CameraState {
  if (scene.selection.length === 0) return frameAll(scene, fovDegrees);
  return frameBounds(sceneBounds(scene, scene.selection), fovDegrees);
}

/**
 * Where orbit should pivot.
 *
 * Around the selection when there is one, because that is what the user is
 * working on; around the whole build otherwise.
 */
export function orbitTarget(scene: Scene): Vector3 {
  const bounds =
    scene.selection.length > 0
      ? sceneBounds(scene, scene.selection)
      : sceneBounds(scene);
  return boundsCentre(bounds);
}

export const DEFAULT_CAMERA: CameraState = {
  position: { x: 6, y: 5, z: 8 },
  target: { x: 0, y: 0, z: 0 },
};

function distance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Whether the camera has wandered far enough to warrant offering a way back.
 *
 * Judged against the scene's own size rather than an absolute number, so it
 * reads the same for a circuit board and a boat.
 */
export function isCameraLost(camera: CameraState, bounds: Bounds): boolean {
  const size = boundsSize(bounds);
  const centre = boundsCentre(bounds);
  const limits = cameraLimits(bounds);

  if (distance(camera.position, camera.target) > limits.maxDistance) {
    return true;
  }
  // The target itself drifting away is the other way to lose the build, and
  // panning is how it happens.
  return distance(camera.target, centre) > size * 12;
}

/** Rejects a restored camera that would put the user nowhere useful. */
export function isValidCameraState(value: unknown): value is CameraState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as CameraState;
  const finite = (vector: Vector3 | undefined) =>
    Boolean(vector) &&
    Number.isFinite(vector!.x) &&
    Number.isFinite(vector!.y) &&
    Number.isFinite(vector!.z);

  if (!finite(candidate.position) || !finite(candidate.target)) return false;
  // A camera sitting exactly on its target has no viewing direction.
  return distance(candidate.position, candidate.target) > 0.0001;
}

/**
 * The camera to use when a project opens: the saved one when it still makes
 * sense, otherwise the whole build framed.
 */
export function restoreCamera(
  saved: unknown,
  scene: Scene,
  fovDegrees = 45,
): CameraState {
  if (!isValidCameraState(saved)) return frameAll(scene, fovDegrees);
  if (isCameraLost(saved, sceneBounds(scene)))
    return frameAll(scene, fovDegrees);
  return saved;
}

// ── Safety clamping ────────────────────────────────────────────────────────

/**
 * Vertical orbit limits for the default editor camera.
 *
 * The upper bound stops the camera crossing below the ground plane. That
 * matters more than it sounds: at the crossing point the grid is edge-on and
 * infinitely thin, so it disappears entirely and the user loses every cue
 * about where anything sits. Stopping just short of horizontal keeps the floor
 * readable at the lowest useful angle.
 */
export const POLAR_LIMITS = {
  min: 0.05,
  max: Math.PI / 2 - 0.05,
} as const;

/** Camera and target are held just above the floor, never on or under it. */
export const MIN_ELEVATION = 0.05;

export function clampPolarAngle(angle: number): number {
  if (!Number.isFinite(angle)) return POLAR_LIMITS.max;
  return Math.min(POLAR_LIMITS.max, Math.max(POLAR_LIMITS.min, angle));
}

/**
 * Brings a camera back inside safe bounds.
 *
 * Applied after orbit, pan, zoom and restore. Anything non-finite is treated
 * as unrecoverable and replaced with the last good state, because a NaN
 * position renders nothing and cannot be corrected by nudging it.
 */
export function clampCamera(
  camera: CameraState,
  bounds: Bounds,
  fallback: CameraState = DEFAULT_CAMERA,
): CameraState {
  const finite = (vector: Vector3) =>
    Number.isFinite(vector.x) &&
    Number.isFinite(vector.y) &&
    Number.isFinite(vector.z);

  if (!finite(camera.position) || !finite(camera.target)) return fallback;

  const size = boundsSize(bounds);
  const centre = boundsCentre(bounds);
  const limits = cameraLimits(bounds);

  // Keep the target near the build. Panning is how a user ends up looking at
  // empty space with the project behind them.
  const maxTargetDrift = size * 6;
  const target: Vector3 = {
    x: clampAround(camera.target.x, centre.x, maxTargetDrift),
    y: Math.max(0, clampAround(camera.target.y, centre.y, maxTargetDrift)),
    z: clampAround(camera.target.z, centre.z, maxTargetDrift),
  };

  // Never below the floor, and never so close the near plane cuts through.
  const position: Vector3 = {
    x: camera.position.x,
    y: Math.max(MIN_ELEVATION, camera.position.y),
    z: camera.position.z,
  };

  const reach = Math.hypot(
    position.x - target.x,
    position.y - target.y,
    position.z - target.z,
  );
  if (reach < 0.0001) return fallback;

  const clampedReach = Math.min(
    limits.maxDistance,
    Math.max(limits.minDistance, reach),
  );
  const scale = clampedReach / reach;

  return {
    target,
    position: {
      x: target.x + (position.x - target.x) * scale,
      y: Math.max(MIN_ELEVATION, target.y + (position.y - target.y) * scale),
      z: target.z + (position.z - target.z) * scale,
    },
  };
}

function clampAround(value: number, centre: number, spread: number): number {
  return Math.min(centre + spread, Math.max(centre - spread, value));
}

/**
 * Near and far planes sized to the build.
 *
 * Fixed extremes are what cause a grid to be clipped away or z-fight into
 * flickering; deriving them keeps precision where the geometry actually is.
 */
export function clippingPlanes(bounds: Bounds): { near: number; far: number } {
  const size = boundsSize(bounds);
  return {
    near: Math.max(0.01, size * 0.002),
    far: Math.max(200, size * 200),
  };
}

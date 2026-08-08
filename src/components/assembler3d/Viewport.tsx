import { Canvas, useThree } from "@react-three/fiber";
import { Grid, OrbitControls, TransformControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Object3D } from "three";

import {
  childrenOf,
  type Scene,
  type SceneObject,
} from "@/lib/assembler3d/scene_model";
import {
  cameraLimits,
  clippingPlanes,
  orbitTarget,
  POLAR_LIMITS,
  sceneBounds,
  type CameraState,
} from "@/lib/assembler3d/camera";

/**
 * The 3D workspace.
 *
 * The canvas renders the scene model and nothing else: it holds no state of
 * its own, so what you see is always what the data says. Selection, transforms
 * and hierarchy are decided outside and flow in as props, which keeps the
 * undo history authoritative and stops the viewport and the panels drifting
 * apart.
 */

/** Geometry per primitive kind. Imported meshes are handled separately. */
function Primitive({ kind }: { kind: SceneObject["kind"] }) {
  switch (kind) {
    case "sphere":
      return <sphereGeometry args={[0.5, 32, 16]} />;
    case "cylinder":
      return <cylinderGeometry args={[0.5, 0.5, 1, 32]} />;
    case "cone":
      return <coneGeometry args={[0.5, 1, 32]} />;
    case "torus":
      return <torusGeometry args={[0.4, 0.15, 16, 48]} />;
    case "box":
    default:
      return <boxGeometry args={[1, 1, 1]} />;
  }
}

/**
 * One object and its children.
 *
 * Nesting the JSX mirrors the parent-child data, so Three.js applies the
 * parent transform to children for us — the same reason transforms are stored
 * relative to the parent in the model.
 */
function SceneNode({
  scene,
  object,
  onSelect,
  onContextTarget,
  registerRef,
}: {
  scene: Scene;
  object: SceneObject;
  onSelect: (id: string, additive: boolean) => void;
  onContextTarget?: (id: string) => void;
  registerRef: (id: string, node: Object3D | null) => void;
}) {
  const selected = scene.selection.includes(object.id);
  const children = childrenOf(scene, object.id);

  return (
    <group
      ref={(node) => registerRef(object.id, node)}
      position={[object.position.x, object.position.y, object.position.z]}
      rotation={[object.rotation.x, object.rotation.y, object.rotation.z]}
      scale={[object.scale.x, object.scale.y, object.scale.z]}
      visible={object.visible}
    >
      {/* A group is structure, not geometry: it positions its children and
          draws nothing itself. */}
      {object.kind !== "group" && (
        <mesh
          castShadow
          receiveShadow
          onClick={(event) => {
            // Without this the click passes through to everything behind it.
            event.stopPropagation();
            // A locked part must not be selectable by clicking, or the gizmo
            // would appear on something that cannot be moved.
            if (object.locked) return;
            onSelect(object.id, event.nativeEvent.shiftKey);
          }}
          onContextMenu={(event) => {
            event.stopPropagation();
            // A locked part still gets its menu: unlocking is one of the few
            // things you can do to it, and the menu is where that lives.
            onContextTarget?.(object.id);
            // Right-clicking outside the current selection acts on what is
            // under the cursor, as every editor does. Right-clicking inside it
            // keeps the selection, so a menu cannot silently shrink a
            // multi-object operation to one part.
            if (!scene.selection.includes(object.id) && !object.locked) {
              onSelect(object.id, false);
            }
          }}
        >
          <Primitive kind={object.kind} />
          <meshStandardMaterial
            color={selected ? "#38e1ff" : "#8fa3b8"}
            emissive={selected ? "#0a4d63" : "#000000"}
            metalness={0.35}
            roughness={0.45}
            transparent={object.locked}
            opacity={object.locked ? 0.55 : 1}
          />
        </mesh>
      )}

      {children.map((child) => (
        <SceneNode
          key={child.id}
          scene={scene}
          object={child}
          onSelect={onSelect}
          onContextTarget={onContextTarget}
          registerRef={registerRef}
        />
      ))}
    </group>
  );
}

/**
 * Applies a camera request once, then reports back.
 *
 * Framing is an action rather than a state. Re-running it on every render
 * would drag the camera back whenever anything else in the scene changed.
 */
function CameraCommand({
  request,
  onApplied,
}: {
  request: CameraState | null;
  onApplied?: () => void;
}) {
  const { camera } = useThree();

  useEffect(() => {
    if (!request) return;
    camera.position.set(
      request.position.x,
      request.position.y,
      request.position.z,
    );
    camera.lookAt(request.target.x, request.target.y, request.target.z);
    camera.updateProjectionMatrix();
    onApplied?.();
  }, [request, camera, onApplied]);

  return null;
}

export function Viewport({
  scene,
  onSelect,
  onClearSelection,
  onContextTarget,
  showGrid = true,
  transformMode = "translate",
  transformSpace = "world",
  translationSnap = null,
  rotationSnap = null,
  scaleSnap = null,
  onTransformStart,
  onTransformEnd,
  onTransformChange,
  cameraRequest = null,
  onCameraApplied,
}: {
  scene: Scene;
  onSelect: (id: string, additive: boolean) => void;
  onClearSelection: () => void;
  /** Reports the object under a right-click, so the menu knows its subject. */
  onContextTarget?: (id: string) => void;
  showGrid?: boolean;
  transformMode?: "translate" | "rotate" | "scale";
  transformSpace?: "world" | "local";
  /**
   * Gizmo detents, or null for free dragging.
   *
   * Snapping belongs on the gizmo rather than on the value it produces: the
   * handle itself steps, so the part visibly lands on the grid instead of
   * jumping there after the fact.
   */
  translationSnap?: number | null;
  rotationSnap?: number | null;
  scaleSnap?: number | null;
  onTransformStart?: () => void;
  onTransformEnd?: () => void;
  onTransformChange?: (id: string, node: Object3D) => void;
  cameraRequest?: CameraState | null;
  onCameraApplied?: () => void;
}) {
  const nodes = useRef(new Map<string, Object3D>());
  const [dragging, setDragging] = useState(false);

  // A gizmo attaches to a single selection only; multi-object transform is a
  // later phase.
  const gizmoId = scene.selection.length === 1 ? scene.selection[0]! : null;
  const gizmoTarget = gizmoId ? nodes.current.get(gizmoId) : undefined;
  // Only roots are rendered at the top level; children come through nesting.
  const roots = useMemo(() => childrenOf(scene, null), [scene]);
  // Limits and clipping follow the build, so a bolt and a boat both stay
  // readable without fixed extremes that clip the grid away.
  const bounds = useMemo(() => sceneBounds(scene), [scene]);
  const limits = useMemo(() => cameraLimits(bounds), [bounds]);
  const planes = useMemo(() => clippingPlanes(bounds), [bounds]);
  const target = useMemo(() => orbitTarget(scene), [scene]);

  return (
    <Canvas
      shadows
      camera={{
        position: [6, 5, 8],
        fov: 45,
        near: planes.near,
        far: planes.far,
      }}
      // Clicking empty space clears the selection, as in every editor.
      // A click that ends a gizmo drag must not also clear the selection.
      onPointerMissed={() => {
        if (!dragging) onClearSelection();
      }}
      data-testid="assembler3d-viewport"
    >
      <color attach="background" args={["#05090f"]} />

      {/* Restrained lighting: enough to read form and depth, not a showreel. */}
      <ambientLight intensity={0.45} />
      <directionalLight
        position={[6, 10, 6]}
        intensity={1.1}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <directionalLight
        position={[-6, 4, -6]}
        intensity={0.3}
        color="#4fd8ff"
      />

      {showGrid && (
        <>
          {/* Lifted a hair off Y=0 so it cannot z-fight the ground plane into
              flickering. */}
          <Grid
            position={[0, 0.001, 0]}
            infiniteGrid
            cellSize={0.25}
            cellThickness={0.5}
            cellColor="#1b3442"
            sectionSize={1}
            // Major lines stay stronger, so orientation survives a shallow
            // angle where minor lines wash out.
            sectionThickness={1.2}
            sectionColor="#3d86a6"
            fadeDistance={80}
            fadeStrength={1}
            followCamera={false}
          />
          {/* Origin axes: the last orientation cue when the grid goes faint. */}
          <axesHelper args={[1.5]} renderOrder={2} />
        </>
      )}

      {roots.map((object) => (
        <SceneNode
          key={object.id}
          scene={scene}
          object={object}
          onSelect={onSelect}
          onContextTarget={onContextTarget}
          registerRef={(id, node) => {
            if (node) nodes.current.set(id, node);
            else nodes.current.delete(id);
          }}
        />
      ))}

      {gizmoTarget && gizmoId && (
        <TransformControls
          object={gizmoTarget}
          mode={transformMode}
          space={transformSpace}
          translationSnap={translationSnap}
          rotationSnap={rotationSnap}
          scaleSnap={scaleSnap}
          onMouseDown={() => {
            setDragging(true);
            onTransformStart?.();
          }}
          onMouseUp={() => {
            setDragging(false);
            onTransformEnd?.();
          }}
          onObjectChange={() => onTransformChange?.(gizmoId, gizmoTarget)}
        />
      )}

      <CameraCommand request={cameraRequest} onApplied={onCameraApplied} />

      <OrbitControls
        makeDefault
        // Disabled mid-drag, or the camera moves with the part.
        enabled={!dragging}
        enableDamping
        dampingFactor={0.08}
        minDistance={limits.minDistance}
        maxDistance={limits.maxDistance}
        // The fix for the vanishing grid: stopping just short of horizontal
        // keeps the camera above the floor, so the grid never goes edge-on and
        // the workspace never loses its orientation cues.
        minPolarAngle={POLAR_LIMITS.min}
        maxPolarAngle={POLAR_LIMITS.max}
        target={[target.x, target.y, target.z]}
      />
    </Canvas>
  );
}

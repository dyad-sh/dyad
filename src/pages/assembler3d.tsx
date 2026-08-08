import { useEffect, useState } from "react";
import {
  Box,
  Circle,
  Cone,
  Cylinder,
  Crosshair,
  Expand,
  Home,
  Layers,
  Move3d,
  Plus,
  RotateCw,
  Scaling,
  Redo2,
  Trash2,
  Undo2,
} from "lucide-react";

import { Viewport } from "@/components/assembler3d/Viewport";
import { Inspector } from "@/components/assembler3d/Inspector";
import { SceneContextMenu } from "@/components/assembler3d/SceneContextMenu";
import {
  useAssembler3D,
  type PrimitiveKind,
  type ProjectCategory,
} from "@/lib/assembler3d/project_store";
import { childrenOf } from "@/lib/assembler3d/scene_model";
import {
  DEFAULT_CAMERA,
  focusSelection,
  frameAll,
  type CameraState,
} from "@/lib/assembler3d/camera";
import {
  listProjects,
  restoreProject,
  saveProject,
  serialiseProject,
  storageAvailable,
} from "@/lib/assembler3d/persistence";

/**
 * Assembler 3D.
 *
 * Two states: the empty state that starts a project, and the workspace once
 * one exists. Nothing here is sample data — a project is empty until the user
 * puts something in it, because an engineering tool that mixes its own guesses
 * with your work has cost you more than it saved.
 */

const CATEGORIES: { id: ProjectCategory; label: string }[] = [
  { id: "air-drone", label: "Air drone" },
  { id: "fpv-drone", label: "FPV drone" },
  { id: "fixed-wing", label: "Fixed-wing" },
  { id: "helicopter", label: "Helicopter" },
  { id: "sea-drone", label: "Sea drone" },
  { id: "surface-vessel", label: "Surface vessel" },
  { id: "underwater", label: "Underwater ROV" },
  { id: "ground-robot", label: "Ground robot" },
  { id: "humanoid", label: "Humanoid robot" },
  { id: "electronics", label: "Electronics" },
  { id: "custom", label: "Custom mechanical" },
];

/** Arrow keys, mapped onto the ground plane the grid describes. */
const NUDGES: Record<string, { x: number; y: number; z: number }> = {
  ArrowLeft: { x: -1, y: 0, z: 0 },
  ArrowRight: { x: 1, y: 0, z: 0 },
  // Up and down read as "away" and "towards" on a floor plan, which is Z.
  ArrowUp: { x: 0, y: 0, z: -1 },
  ArrowDown: { x: 0, y: 0, z: 1 },
  PageUp: { x: 0, y: 1, z: 0 },
  PageDown: { x: 0, y: -1, z: 0 },
};

const PRIMITIVES: { kind: PrimitiveKind; label: string; Icon: typeof Box }[] = [
  { kind: "box", label: "Box", Icon: Box },
  { kind: "sphere", label: "Sphere", Icon: Circle },
  { kind: "cylinder", label: "Cylinder", Icon: Cylinder },
  { kind: "cone", label: "Cone", Icon: Cone },
];

function EmptyState({
  onCreate,
}: {
  onCreate: (name: string, category: ProjectCategory) => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ProjectCategory>("air-drone");

  return (
    <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-14">
      <header className="space-y-3">
        <span className="inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-medium tracking-wide text-cyan-300 uppercase">
          <Box className="size-3.5" />
          Assembler 3D
        </span>
        <h1 className="font-jarvis-display text-3xl font-semibold tracking-tight text-white">
          Design machines, not slide decks.
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-[#7aadb8]">
          A 3D workspace for drones, vessels, robots and embedded systems.
          Assemble components and let weight, cost and power follow the build.
        </p>
      </header>

      <form
        className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl"
        onSubmit={(event) => {
          event.preventDefault();
          onCreate(name, category);
        }}
      >
        <div className="space-y-1.5">
          <label
            htmlFor="assembler3d-project-name"
            className="text-xs font-medium tracking-wide text-white/50 uppercase"
          >
            Project name
          </label>
          <input
            id="assembler3d-project-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Untitled project"
            className="w-full rounded-lg border border-white/12 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/50"
          />
        </div>

        <fieldset className="space-y-2">
          <legend className="text-xs font-medium tracking-wide text-white/50 uppercase">
            Category
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setCategory(option.id)}
                aria-pressed={category === option.id}
                className={
                  category === option.id
                    ? "rounded-lg border border-cyan-400/40 bg-cyan-500/15 px-2.5 py-1.5 text-xs text-cyan-100"
                    : "rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-white/60 hover:bg-white/[0.08]"
                }
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <button
          type="submit"
          className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-500/15 px-4 py-2.5 text-sm font-medium text-cyan-100 transition hover:bg-cyan-500/25"
          data-testid="assembler3d-create-project"
        >
          <Plus className="size-4" />
          Create project
        </button>
      </form>
    </div>
  );
}

export default function Assembler3DPage() {
  const project = useAssembler3D((state) => state.project);
  const history = useAssembler3D((state) => state.history);
  const showGrid = useAssembler3D((state) => state.showGrid);
  const createProject = useAssembler3D((state) => state.createProject);
  const addPrimitive = useAssembler3D((state) => state.addPrimitive);
  const deleteSelection = useAssembler3D((state) => state.deleteSelection);
  const duplicateSelection = useAssembler3D(
    (state) => state.duplicateSelection,
  );
  const groupSelection = useAssembler3D((state) => state.groupSelection);
  const ungroupSelection = useAssembler3D((state) => state.ungroupSelection);
  const selectObject = useAssembler3D((state) => state.selectObject);
  const clearSelection = useAssembler3D((state) => state.clearSelection);
  const undo = useAssembler3D((state) => state.undo);
  const redo = useAssembler3D((state) => state.redo);
  const transformMode = useAssembler3D((state) => state.transformMode);
  const transformSpace = useAssembler3D((state) => state.transformSpace);
  const setTransformMode = useAssembler3D((state) => state.setTransformMode);
  const toggleTransformSpace = useAssembler3D(
    (state) => state.toggleTransformSpace,
  );
  const beginTransform = useAssembler3D((state) => state.beginTransform);
  const endTransform = useAssembler3D((state) => state.endTransform);
  const applyTransform = useAssembler3D((state) => state.applyTransform);
  const toggleGrid = useAssembler3D((state) => state.toggleGrid);
  const copySelection = useAssembler3D((state) => state.copySelection);
  const cutSelection = useAssembler3D((state) => state.cutSelection);
  const paste = useAssembler3D((state) => state.paste);
  const selectAll = useAssembler3D((state) => state.selectAll);
  const moveSelection = useAssembler3D((state) => state.moveSelection);
  const gridStep = useAssembler3D((state) => state.gridStep);
  const [cameraRequest, setCameraRequest] = useState<CameraState | null>(null);
  // What the right-click landed on. Cleared in the capture phase before the
  // canvas gets a chance to set it, so a miss reads as empty space.
  const [contextTarget, setContextTarget] = useState<string | null>(null);

  const openProject = useAssembler3D((state) => state.openProject);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const scene = history.present;
  const roots = childrenOf(scene, null);

  // Reopen the most recent project on load. Without this a refresh looks
  // exactly like losing the work.
  useEffect(() => {
    if (project || !storageAvailable()) return;
    let cancelled = false;
    void listProjects()
      .then((saved) => {
        if (cancelled || saved.length === 0) return;
        const latest = [...saved].sort((a, b) =>
          b.savedAt.localeCompare(a.savedAt),
        )[0]!;
        const restored = restoreProject(latest);
        if (restored.ok) {
          openProject(restored.project, restored.scene);
          setSavedAt(latest.savedAt);
          setSaveState("saved");
        }
      })
      .catch(() => {
        // A failed read must not block starting a new project.
      });
    return () => {
      cancelled = true;
    };
  }, [project, openProject]);

  // Autosave, debounced so a drag does not write on every frame.
  useEffect(() => {
    if (!project || !storageAvailable()) return;
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      const record = serialiseProject(project, scene);
      void saveProject(record)
        .then(() => {
          setSavedAt(record.savedAt);
          setSaveState("saved");
        })
        .catch(() => setSaveState("error"));
    }, 800);
    return () => window.clearTimeout(timer);
  }, [project, scene]);

  // The shortcuts from the brief. Bound only while a project is open, and
  // ignored while typing so they cannot fire from a text field.
  useEffect(() => {
    if (!project) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable]")) return;
      const meta = event.metaKey || event.ctrlKey;

      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (meta && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelection();
      } else if (meta && event.key.toLowerCase() === "g") {
        event.preventDefault();
        if (event.shiftKey) ungroupSelection();
        else groupSelection();
      } else if (meta && event.key.toLowerCase() === "c") {
        event.preventDefault();
        copySelection();
      } else if (meta && event.key.toLowerCase() === "x") {
        event.preventDefault();
        cutSelection();
      } else if (meta && event.key.toLowerCase() === "v") {
        event.preventDefault();
        paste();
      } else if (meta && event.key.toLowerCase() === "a") {
        event.preventDefault();
        selectAll();
      } else if (NUDGES[event.key]) {
        // Arrow keys nudge by one grid step, the fine adjustment a gizmo
        // cannot do. Shift takes ten steps for crossing a workspace.
        event.preventDefault();
        const step = (gridStep || 0.1) * (event.shiftKey ? 10 : 1);
        const direction = NUDGES[event.key]!;
        moveSelection({
          x: direction.x * step,
          y: direction.y * step,
          z: direction.z * step,
        });
      } else if (event.key === "Delete" || event.key === "Backspace") {
        deleteSelection();
      } else if (event.key === "Escape") {
        clearSelection();
      } else if (event.key === "w" || event.key === "W") {
        setTransformMode("translate");
      } else if (event.key === "e" || event.key === "E") {
        setTransformMode("rotate");
      } else if (event.key === "r" || event.key === "R") {
        setTransformMode("scale");
      } else if (event.key === "q" || event.key === "Q") {
        toggleTransformSpace();
      } else if (event.key === "f" || event.key === "F") {
        // Shift widens it to the whole build; plain F frames the selection.
        setCameraRequest(
          event.shiftKey ? frameAll(scene) : focusSelection(scene),
        );
      } else if (event.key === "Home") {
        setCameraRequest(DEFAULT_CAMERA);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    project,
    undo,
    redo,
    duplicateSelection,
    groupSelection,
    ungroupSelection,
    deleteSelection,
    clearSelection,
    setTransformMode,
    toggleTransformSpace,
    copySelection,
    cutSelection,
    paste,
    selectAll,
    moveSelection,
    gridStep,
    scene,
  ]);

  if (!project) {
    return (
      <div className="assembler3d-page relative flex h-full min-h-0 w-full flex-col overflow-y-auto">
        <div className="assembler3d-grid pointer-events-none absolute inset-0" />
        <EmptyState onCreate={createProject} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-[#05090f]">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 px-4 py-2.5">
        <Box className="size-4 shrink-0 text-cyan-300" />
        <span className="truncate text-sm font-semibold text-white">
          {project.name}
        </span>
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/45">
          {CATEGORIES.find((c) => c.id === project.category)?.label}
        </span>
        {/* Save state is stated rather than assumed: silence about whether
            work is safe is what makes people lose it. */}
        <span
          className={
            saveState === "error"
              ? "text-[10px] text-rose-300"
              : "text-[10px] text-white/35"
          }
          data-testid="assembler3d-save-state"
        >
          {saveState === "error"
            ? "Not saved — local storage unavailable"
            : saveState === "saving"
              ? "Saving…"
              : savedAt
                ? `Saved ${new Date(savedAt).toLocaleTimeString()}`
                : ""}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          {PRIMITIVES.map(({ kind, label, Icon }) => (
            <button
              key={kind}
              type="button"
              onClick={() => addPrimitive(kind)}
              title={`Add ${label.toLowerCase()}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-xs text-white/70 hover:bg-white/[0.09]"
              data-testid={`assembler3d-add-${kind}`}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}

          <span className="mx-1 h-5 w-px bg-white/10" />

          {/* Transform tools. The active one is obvious rather than implied. */}
          {(
            [
              ["translate", "Move (W)", Move3d],
              ["rotate", "Rotate (E)", RotateCw],
              ["scale", "Scale (R)", Scaling],
            ] as const
          ).map(([mode, title, Icon]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setTransformMode(mode)}
              title={title}
              aria-pressed={transformMode === mode}
              className={
                transformMode === mode
                  ? "grid size-7 place-items-center rounded-lg bg-cyan-500/20 text-cyan-200"
                  : "grid size-7 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white"
              }
              data-testid={`assembler3d-mode-${mode}`}
            >
              <Icon className="size-4" />
            </button>
          ))}
          <button
            type="button"
            onClick={toggleTransformSpace}
            title="Toggle world/local space (Q)"
            className="rounded-lg px-2 py-1 text-[10px] font-medium text-white/60 hover:bg-white/10 hover:text-white"
          >
            {transformSpace === "world" ? "WORLD" : "LOCAL"}
          </button>

          <span className="mx-1 h-5 w-px bg-white/10" />

          {/* Camera recovery, always reachable so the build is never lost. */}
          <button
            type="button"
            onClick={() => setCameraRequest(focusSelection(scene))}
            title="Focus selection (F)"
            className="grid size-7 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white"
            data-testid="assembler3d-focus"
          >
            <Crosshair className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setCameraRequest(frameAll(scene))}
            title="Frame all (Shift+F)"
            className="grid size-7 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white"
            data-testid="assembler3d-frame-all"
          >
            <Expand className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setCameraRequest(DEFAULT_CAMERA)}
            title="Reset camera (Home)"
            className="grid size-7 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white"
          >
            <Home className="size-4" />
          </button>
          <button
            type="button"
            onClick={toggleGrid}
            title="Toggle grid"
            aria-pressed={showGrid}
            className={
              showGrid
                ? "grid size-7 place-items-center rounded-lg bg-white/10 text-white"
                : "grid size-7 place-items-center rounded-lg text-white/50 hover:bg-white/10"
            }
          >
            #
          </button>

          <span className="mx-1 h-5 w-px bg-white/10" />

          <button
            type="button"
            onClick={groupSelection}
            title="Group selection (⌘G)"
            className="grid size-7 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white"
          >
            <Layers className="size-4" />
          </button>
          <button
            type="button"
            onClick={undo}
            disabled={history.past.length === 0}
            title="Undo (⌘Z)"
            className="grid size-7 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-30"
          >
            <Undo2 className="size-4" />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={history.future.length === 0}
            title="Redo (⌘⇧Z)"
            className="grid size-7 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-30"
          >
            <Redo2 className="size-4" />
          </button>
          <button
            type="button"
            onClick={deleteSelection}
            disabled={scene.selection.length === 0}
            title="Delete selection"
            className="grid size-7 place-items-center rounded-lg text-white/60 hover:bg-rose-500/15 hover:text-rose-300 disabled:opacity-30"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-56 shrink-0 flex-col border-r border-white/10 lg:flex">
          <p className="px-3 py-2 text-[10px] font-medium tracking-wide text-white/35 uppercase">
            Scene
          </p>
          <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {roots.length === 0 && (
              <li className="px-2 py-1.5 text-xs text-white/35">
                Nothing yet. Add a shape from the toolbar.
              </li>
            )}
            {roots.map((object) => (
              <li key={object.id}>
                <button
                  type="button"
                  onClick={(event) => selectObject(object.id, event.shiftKey)}
                  className={
                    scene.selection.includes(object.id)
                      ? "w-full truncate rounded-md bg-cyan-500/15 px-2 py-1.5 text-left text-xs text-cyan-100"
                      : "w-full truncate rounded-md px-2 py-1.5 text-left text-xs text-white/65 hover:bg-white/[0.06]"
                  }
                >
                  {object.name}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="min-h-0 min-w-0 flex-1">
          <SceneContextMenu
            targetId={contextTarget}
            onBeforeOpen={() => setContextTarget(null)}
            onFocusSelection={() => setCameraRequest(focusSelection(scene))}
            onFrameAll={() => setCameraRequest(frameAll(scene))}
          >
            <Viewport
              scene={scene}
              showGrid={showGrid}
              onSelect={selectObject}
              onClearSelection={clearSelection}
              onContextTarget={setContextTarget}
              transformMode={transformMode}
              transformSpace={transformSpace}
              onTransformStart={beginTransform}
              onTransformEnd={endTransform}
              onTransformChange={(id, node) =>
                applyTransform(id, {
                  position: {
                    x: node.position.x,
                    y: node.position.y,
                    z: node.position.z,
                  },
                  rotation: {
                    x: node.rotation.x,
                    y: node.rotation.y,
                    z: node.rotation.z,
                  },
                  scale: { x: node.scale.x, y: node.scale.y, z: node.scale.z },
                })
              }
              cameraRequest={cameraRequest}
              onCameraApplied={() => setCameraRequest(null)}
            />
          </SceneContextMenu>
        </div>

        {/* Inspector. Gizmos place things roughly; this is how a part gets to
            exactly where it belongs. */}
        <aside className="hidden w-72 shrink-0 border-l border-white/10 xl:block">
          {scene.selection.length === 1 &&
          scene.objects[scene.selection[0]!] ? (
            <Inspector object={scene.objects[scene.selection[0]!]!} />
          ) : (
            <p className="p-3 text-xs text-white/35">
              {scene.selection.length > 1
                ? `${scene.selection.length} objects selected. Select one to edit its properties.`
                : "Select an object to edit its name, transform and state."}
            </p>
          )}
        </aside>
      </div>

      <footer className="flex shrink-0 items-center gap-4 border-t border-white/10 px-4 py-1.5 text-[11px] text-white/45">
        <span>{Object.keys(scene.objects).length} objects</span>
        <span>{scene.selection.length} selected</span>
        <span className="ml-auto text-white/30">
          Weight, cost and power totals arrive with the inspector.
        </span>
      </footer>
    </div>
  );
}

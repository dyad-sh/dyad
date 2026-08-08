import type { ReactNode } from "react";
import {
  AlignCenterHorizontal,
  AlignHorizontalJustifyCenter,
  ArrowDownToLine,
  Box,
  Circle,
  Clipboard,
  Cone,
  Copy,
  Crosshair,
  Cylinder,
  Eye,
  FlipHorizontal,
  Grid3x3,
  Layers,
  Lock,
  RotateCcw,
  Scissors,
  Trash2,
  Ungroup,
  Unlock,
} from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  useAssembler3D,
  type PrimitiveKind,
} from "@/lib/assembler3d/project_store";
import { AXES, type Axis } from "@/lib/assembler3d/scene_model";

/**
 * Right-click menu for the workspace.
 *
 * Two menus in one, chosen by what was under the cursor. On a part it offers
 * what you can do *to* that part; on empty space it offers what you can add
 * and how to see the whole build. Showing the object commands greyed out over
 * empty space would be a longer menu that says less.
 *
 * Every entry here is also a keyboard shortcut, and the shortcut is printed
 * next to it: a context menu people never graduate from is a context menu that
 * failed to teach the tool.
 */

const ADDABLE: { kind: PrimitiveKind; label: string; Icon: typeof Box }[] = [
  { kind: "box", label: "Box", Icon: Box },
  { kind: "sphere", label: "Sphere", Icon: Circle },
  { kind: "cylinder", label: "Cylinder", Icon: Cylinder },
  { kind: "cone", label: "Cone", Icon: Cone },
];

const ALIGNMENTS = [
  { mode: "min", label: "Min face" },
  { mode: "center", label: "Centre" },
  { mode: "max", label: "Max face" },
] as const;

export function SceneContextMenu({
  targetId,
  onBeforeOpen,
  onFocusSelection,
  onFrameAll,
  children,
}: {
  /** Object under the cursor when the menu opened, or null for empty space. */
  targetId: string | null;
  /**
   * Runs in the capture phase, before the canvas decides what was hit.
   *
   * The viewport sets the target on its way back up, so this has to clear the
   * previous one first or a right-click on empty space would still show the
   * menu for whatever was clicked last.
   */
  onBeforeOpen: () => void;
  onFocusSelection: () => void;
  onFrameAll: () => void;
  children: ReactNode;
}) {
  const history = useAssembler3D((state) => state.history);
  const clipboard = useAssembler3D((state) => state.clipboard);
  const addPrimitive = useAssembler3D((state) => state.addPrimitive);
  const deleteSelection = useAssembler3D((state) => state.deleteSelection);
  const duplicateSelection = useAssembler3D(
    (state) => state.duplicateSelection,
  );
  const copySelection = useAssembler3D((state) => state.copySelection);
  const cutSelection = useAssembler3D((state) => state.cutSelection);
  const paste = useAssembler3D((state) => state.paste);
  const groupSelection = useAssembler3D((state) => state.groupSelection);
  const ungroupSelection = useAssembler3D((state) => state.ungroupSelection);
  const alignSelection = useAssembler3D((state) => state.alignSelection);
  const distributeSelection = useAssembler3D(
    (state) => state.distributeSelection,
  );
  const mirrorSelection = useAssembler3D((state) => state.mirrorSelection);
  const rotateBy = useAssembler3D((state) => state.rotateBy);
  const flipObject = useAssembler3D((state) => state.flipObject);
  const arrayLinear = useAssembler3D((state) => state.arraySelectionLinear);
  const arrayPolar = useAssembler3D((state) => state.arraySelectionPolar);
  const dropToGround = useAssembler3D((state) => state.dropSelectionToGround);
  const gridStep = useAssembler3D((state) => state.gridStep);
  const setVisibility = useAssembler3D((state) => state.setVisibility);
  const setLocked = useAssembler3D((state) => state.setLocked);
  const resetScale = useAssembler3D((state) => state.resetScale);
  const snapRotationToDetent = useAssembler3D(
    (state) => state.snapRotationToDetent,
  );
  const isolateSelection = useAssembler3D((state) => state.isolateSelection);
  const showAll = useAssembler3D((state) => state.showAll);
  const selectAll = useAssembler3D((state) => state.selectAll);
  const invertSelection = useAssembler3D((state) => state.invertSelection);

  const scene = history.present;
  const target = targetId ? scene.objects[targetId] : null;
  const selectionCount = scene.selection.length;
  /**
   * Whether the commands that act on the selection are about this part.
   *
   * Right-clicking normally selects what is under the cursor, so these agree.
   * A locked part is the exception: it cannot be selected, so a Delete or an
   * Align offered here would silently act on whatever was selected before,
   * which is the wrong object and no warning. Those entries are disabled
   * until the part is unlocked and can speak for itself.
   */
  const actsOnTarget = target ? scene.selection.includes(target.id) : false;
  const hasGroup = scene.selection.some(
    (id) => scene.objects[id]?.kind === "group",
  );
  const anyHidden = scene.order.some((id) => !scene.objects[id]!.visible);

  return (
    <ContextMenu>
      <ContextMenuTrigger
        className="h-full w-full"
        onContextMenuCapture={onBeforeOpen}
        data-testid="assembler3d-context-trigger"
      >
        {children}
      </ContextMenuTrigger>

      <ContextMenuContent
        className="w-60"
        data-testid="assembler3d-context-menu"
      >
        {target ? (
          <>
            <ContextMenuLabel className="truncate">
              {target.name}
              {target.locked && (
                <span className="ml-1 text-amber-300/80">· locked</span>
              )}
              {actsOnTarget && selectionCount > 1 && (
                <span className="text-white/40"> +{selectionCount - 1}</span>
              )}
            </ContextMenuLabel>
            <ContextMenuSeparator />

            <ContextMenuItem disabled={!actsOnTarget} onClick={cutSelection}>
              <Scissors />
              Cut
              <ContextMenuShortcut>⌘X</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem disabled={!actsOnTarget} onClick={copySelection}>
              <Copy />
              Copy
              <ContextMenuShortcut>⌘C</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!actsOnTarget}
              onClick={duplicateSelection}
            >
              <Copy />
              Duplicate
              <ContextMenuShortcut>⌘D</ContextMenuShortcut>
            </ContextMenuItem>

            <ContextMenuSeparator />

            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <AlignHorizontalJustifyCenter />
                Align
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-44">
                {AXES.map((axis) => (
                  <ContextMenuSub key={axis}>
                    <ContextMenuSubTrigger>
                      {axis.toUpperCase()} axis
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent className="w-36">
                      {ALIGNMENTS.map(({ mode, label }) => (
                        <ContextMenuItem
                          key={mode}
                          disabled={!actsOnTarget || selectionCount < 2}
                          onClick={() => alignSelection(axis as Axis, mode)}
                        >
                          {label}
                        </ContextMenuItem>
                      ))}
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>

            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <AlignCenterHorizontal />
                Distribute
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-36">
                {AXES.map((axis) => (
                  <ContextMenuItem
                    key={axis}
                    // Fewer than three objects are already evenly spaced.
                    disabled={!actsOnTarget || selectionCount < 3}
                    onClick={() => distributeSelection(axis as Axis)}
                  >
                    Along {axis.toUpperCase()}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>

            {/* Flip and quarter-turn are one click, not three. They are the
                two things people reach for constantly, and burying them under
                a submenu made the common case the slowest one. Mirror keeps
                its submenu: it moves parts as well as reversing them, so it is
                the deliberate choice rather than the quick one. */}
            <div className="flex gap-1 px-2 py-1">
              <span className="self-center text-[10px] text-white/35">
                Flip
              </span>
              {AXES.map((axis) => (
                <button
                  key={`flip-${axis}`}
                  type="button"
                  disabled={target.locked}
                  onClick={() => flipObject(target.id, axis as Axis)}
                  className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/70 hover:bg-white/[0.12] disabled:opacity-40"
                >
                  {axis.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="flex gap-1 px-2 pb-1">
              <span className="self-center text-[10px] text-white/35">
                Turn 90°
              </span>
              {AXES.map((axis) => (
                <button
                  key={`turn-${axis}`}
                  type="button"
                  disabled={target.locked}
                  onClick={() => rotateBy(target.id, axis as Axis, 90)}
                  className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/70 hover:bg-white/[0.12] disabled:opacity-40"
                >
                  {axis.toUpperCase()}
                </button>
              ))}
            </div>

            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <FlipHorizontal />
                Mirror selection
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-36">
                {AXES.map((axis) => (
                  <ContextMenuItem
                    key={axis}
                    disabled={!actsOnTarget}
                    onClick={() => mirrorSelection(axis as Axis)}
                  >
                    Across {axis.toUpperCase()}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>

            <ContextMenuSeparator />

            {/* Array: the command a CAD user reaches for the moment they need
                more than one of anything. Spacing follows the grid step, so
                the run lands on the same grid everything else snaps to. */}
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Grid3x3 />
                Array
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-52">
                <ContextMenuLabel>Along a line</ContextMenuLabel>
                {[2, 3, 4, 6, 8].map((count) => (
                  <ContextMenuItem
                    key={`lin-${count}`}
                    disabled={!actsOnTarget}
                    onClick={() =>
                      arrayLinear(count, {
                        x: (gridStep || 1) * 2,
                        y: 0,
                        z: 0,
                      })
                    }
                  >
                    {count}× along X
                  </ContextMenuItem>
                ))}
                <ContextMenuSeparator />
                <ContextMenuLabel>Around a circle</ContextMenuLabel>
                {[3, 4, 6, 8, 12].map((count) => (
                  <ContextMenuItem
                    key={`pol-${count}`}
                    disabled={!actsOnTarget}
                    onClick={() => arrayPolar(count, "y")}
                  >
                    {count}× about Y
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>

            <ContextMenuItem disabled={!actsOnTarget} onClick={dropToGround}>
              <ArrowDownToLine />
              Drop to ground
            </ContextMenuItem>

            <ContextMenuSeparator />

            <ContextMenuItem
              disabled={!actsOnTarget || selectionCount < 2}
              onClick={groupSelection}
            >
              <Layers />
              Group
              <ContextMenuShortcut>⌘G</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!actsOnTarget || !hasGroup}
              onClick={ungroupSelection}
            >
              <Ungroup />
              Ungroup
              <ContextMenuShortcut>⇧⌘G</ContextMenuShortcut>
            </ContextMenuItem>

            <ContextMenuSeparator />

            <ContextMenuItem
              disabled={!actsOnTarget}
              onClick={onFocusSelection}
            >
              <Crosshair />
              Focus
              <ContextMenuShortcut>F</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!actsOnTarget}
              onClick={isolateSelection}
            >
              <Eye />
              Isolate
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => setVisibility(target.id, !target.visible)}
            >
              <Eye />
              {target.visible ? "Hide" : "Show"}
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => setLocked(target.id, !target.locked)}
            >
              {target.locked ? <Unlock /> : <Lock />}
              {target.locked ? "Unlock" : "Lock"}
            </ContextMenuItem>
            <ContextMenuItem
              disabled={target.locked}
              onClick={() => resetScale(target.id)}
            >
              <RotateCcw />
              Reset scale
            </ContextMenuItem>
            <ContextMenuItem
              disabled={target.locked}
              onClick={() => snapRotationToDetent(target.id)}
            >
              <RotateCcw />
              Snap rotation to detent
            </ContextMenuItem>

            <ContextMenuSeparator />

            <ContextMenuItem
              variant="destructive"
              disabled={!actsOnTarget}
              onClick={deleteSelection}
            >
              <Trash2 />
              Delete
              <ContextMenuShortcut>⌫</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        ) : (
          <>
            <ContextMenuLabel>Add</ContextMenuLabel>
            {ADDABLE.map(({ kind, label, Icon }) => (
              <ContextMenuItem
                key={kind}
                onClick={() => addPrimitive(kind)}
                data-testid={`assembler3d-context-add-${kind}`}
              >
                <Icon />
                {label}
              </ContextMenuItem>
            ))}

            <ContextMenuSeparator />

            <ContextMenuItem disabled={clipboard.length === 0} onClick={paste}>
              <Clipboard />
              Paste
              <ContextMenuShortcut>⌘V</ContextMenuShortcut>
            </ContextMenuItem>

            <ContextMenuSeparator />

            <ContextMenuItem
              disabled={scene.order.length === 0}
              onClick={selectAll}
            >
              Select all
              <ContextMenuShortcut>⌘A</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem
              disabled={scene.order.length === 0}
              onClick={invertSelection}
            >
              Invert selection
            </ContextMenuItem>
            <ContextMenuItem disabled={!anyHidden} onClick={showAll}>
              <Eye />
              Show all
            </ContextMenuItem>

            <ContextMenuSeparator />

            <ContextMenuItem onClick={onFrameAll}>
              <Crosshair />
              Frame all
              <ContextMenuShortcut>⇧F</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

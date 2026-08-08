import type { ReactNode } from "react";
import {
  AlignCenterHorizontal,
  AlignHorizontalJustifyCenter,
  Box,
  Circle,
  Clipboard,
  Cone,
  Copy,
  Crosshair,
  Cylinder,
  Eye,
  FlipHorizontal,
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
  const setVisibility = useAssembler3D((state) => state.setVisibility);
  const setLocked = useAssembler3D((state) => state.setLocked);
  const resetScale = useAssembler3D((state) => state.resetScale);
  const isolateSelection = useAssembler3D((state) => state.isolateSelection);
  const showAll = useAssembler3D((state) => state.showAll);
  const selectAll = useAssembler3D((state) => state.selectAll);
  const invertSelection = useAssembler3D((state) => state.invertSelection);

  const scene = history.present;
  const target = targetId ? scene.objects[targetId] : null;
  const selectionCount = scene.selection.length;
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
              {selectionCount > 1 && (
                <span className="text-white/40"> +{selectionCount - 1}</span>
              )}
            </ContextMenuLabel>
            <ContextMenuSeparator />

            <ContextMenuItem onClick={cutSelection}>
              <Scissors />
              Cut
              <ContextMenuShortcut>⌘X</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={copySelection}>
              <Copy />
              Copy
              <ContextMenuShortcut>⌘C</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={duplicateSelection}>
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
                          disabled={selectionCount < 2}
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
                    disabled={selectionCount < 3}
                    onClick={() => distributeSelection(axis as Axis)}
                  >
                    Along {axis.toUpperCase()}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>

            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <FlipHorizontal />
                Mirror
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-36">
                {AXES.map((axis) => (
                  <ContextMenuItem
                    key={axis}
                    onClick={() => mirrorSelection(axis as Axis)}
                  >
                    Across {axis.toUpperCase()}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>

            <ContextMenuSeparator />

            <ContextMenuItem
              disabled={selectionCount < 2}
              onClick={groupSelection}
            >
              <Layers />
              Group
              <ContextMenuShortcut>⌘G</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem disabled={!hasGroup} onClick={ungroupSelection}>
              <Ungroup />
              Ungroup
              <ContextMenuShortcut>⇧⌘G</ContextMenuShortcut>
            </ContextMenuItem>

            <ContextMenuSeparator />

            <ContextMenuItem onClick={onFocusSelection}>
              <Crosshair />
              Focus
              <ContextMenuShortcut>F</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={isolateSelection}>
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

            <ContextMenuSeparator />

            <ContextMenuItem variant="destructive" onClick={deleteSelection}>
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

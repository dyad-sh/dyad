import { Eye, EyeOff, Lock, RotateCcw, Trash2, Unlock } from "lucide-react";

import { useAssembler3D } from "@/lib/assembler3d/project_store";
import type { SceneObject, Vector3 } from "@/lib/assembler3d/scene_model";

/**
 * Numeric editing for the selected object.
 *
 * Gizmos are good for placing something roughly; they are hopeless for
 * "exactly 12mm to the left". This panel is the other half of that, and it is
 * also the only way to rename, hide, lock or reset an object.
 *
 * Every field commits on blur or Enter rather than on each keystroke, so
 * typing "1.5" does not pass through "1" and briefly resize the object, and so
 * one edit is one undo step.
 */

const AXES = ["x", "y", "z"] as const;

function AxisRow({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: Vector3;
  disabled: boolean;
  onCommit: (axis: "x" | "y" | "z", next: number) => void;
}) {
  return (
    <div className="space-y-1">
      <span className="text-[10px] font-medium tracking-wide text-white/40 uppercase">
        {label}
      </span>
      <div className="grid grid-cols-3 gap-1.5">
        {AXES.map((axis) => (
          <label key={axis} className="relative block">
            <span className="absolute top-1/2 left-2 -translate-y-1/2 text-[10px] text-white/30 uppercase">
              {axis}
            </span>
            <input
              type="number"
              step="0.1"
              disabled={disabled}
              // Uncontrolled between commits, so a half-typed number is never
              // pushed into the scene.
              defaultValue={Number(value[axis].toFixed(4))}
              key={`${axis}-${value[axis]}`}
              onBlur={(event) => onCommit(axis, Number(event.target.value))}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              className="w-full rounded-md border border-white/10 bg-black/30 py-1.5 pr-1.5 pl-6 text-right text-xs text-white outline-none focus:border-cyan-400/50 disabled:opacity-40"
              aria-label={`${label} ${axis}`}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

export function Inspector({ object }: { object: SceneObject }) {
  const setTransform = useAssembler3D((state) => state.setTransform);
  const renameObject = useAssembler3D((state) => state.renameObject);
  const setVisibility = useAssembler3D((state) => state.setVisibility);
  const setLocked = useAssembler3D((state) => state.setLocked);
  const resetScale = useAssembler3D((state) => state.resetScale);
  const deleteSelection = useAssembler3D((state) => state.deleteSelection);

  const locked = object.locked;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      <div className="space-y-1.5">
        <span className="text-[10px] font-medium tracking-wide text-white/40 uppercase">
          Name
        </span>
        <input
          key={object.id + object.name}
          defaultValue={object.name}
          onBlur={(event) => renameObject(object.id, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white outline-none focus:border-cyan-400/50"
          aria-label="Object name"
        />
        <p className="text-[10px] text-white/30">{object.kind}</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setVisibility(object.id, !object.visible)}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 text-xs text-white/70 hover:bg-white/[0.09]"
        >
          {object.visible ? (
            <Eye className="size-3.5" />
          ) : (
            <EyeOff className="size-3.5" />
          )}
          {object.visible ? "Visible" : "Hidden"}
        </button>
        <button
          type="button"
          onClick={() => setLocked(object.id, !locked)}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 text-xs text-white/70 hover:bg-white/[0.09]"
        >
          {locked ? (
            <Lock className="size-3.5" />
          ) : (
            <Unlock className="size-3.5" />
          )}
          {locked ? "Locked" : "Unlocked"}
        </button>
        <button
          type="button"
          onClick={deleteSelection}
          className="inline-flex items-center gap-1.5 rounded-md border border-rose-400/20 bg-rose-500/10 px-2 py-1.5 text-xs text-rose-200 hover:bg-rose-500/20"
          data-testid="assembler3d-inspector-delete"
        >
          <Trash2 className="size-3.5" />
          Delete
        </button>
      </div>

      {locked && (
        <p className="rounded-md border border-amber-400/20 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200">
          This object is locked. Unlock it to edit its transform.
        </p>
      )}

      <AxisRow
        label="Position"
        value={object.position}
        disabled={locked}
        onCommit={(axis, next) =>
          setTransform(object.id, "position", axis, next)
        }
      />
      <AxisRow
        label="Rotation"
        value={object.rotation}
        disabled={locked}
        onCommit={(axis, next) =>
          setTransform(object.id, "rotation", axis, next)
        }
      />

      <div className="space-y-1.5">
        <AxisRow
          label="Scale"
          value={object.scale}
          disabled={locked}
          onCommit={(axis, next) =>
            setTransform(object.id, "scale", axis, next)
          }
        />
        <button
          type="button"
          onClick={() => resetScale(object.id)}
          disabled={locked}
          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] text-white/50 hover:bg-white/[0.06] hover:text-white disabled:opacity-40"
        >
          <RotateCcw className="size-3" />
          Reset scale
        </button>
        <p className="text-[10px] text-white/30">
          Scale is held between 0.001 and 10,000 so an object cannot disappear
          or swallow the scene.
        </p>
      </div>
    </div>
  );
}

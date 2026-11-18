import { Checkbox } from "@/components/ui/checkbox";

export interface PickableApp {
  id: number;
  name: string;
}

/**
 * A checklist of apps for choosing which apps a plugin configuration
 * serves. `noteFor` explains an app's current situation, such as using a
 * different configuration of the same plugin.
 */
export function PluginAppPicker({
  apps,
  selected,
  onChange,
  noteFor,
  disabled,
}: {
  apps: PickableApp[];
  selected: ReadonlySet<number>;
  onChange: (next: Set<number>) => void;
  noteFor?: (appId: number) => string | undefined;
  disabled?: boolean;
}) {
  if (apps.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        You don't have any apps yet.
      </div>
    );
  }
  return (
    <div
      className="max-h-56 overflow-y-auto rounded-md border p-2 space-y-1"
      data-testid="plugin-app-picker"
    >
      {apps.map((app) => {
        const note = noteFor?.(app.id);
        return (
          <label
            key={app.id}
            className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50 cursor-pointer"
          >
            <Checkbox
              aria-label={app.name}
              checked={selected.has(app.id)}
              disabled={disabled}
              onCheckedChange={(checked) => {
                const next = new Set(selected);
                if (checked) next.add(app.id);
                else next.delete(app.id);
                onChange(next);
              }}
            />
            <span className="truncate">{app.name}</span>
            {note && (
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {note}
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}

/** "App 1, App 2" for a list of app ids, in the apps' list order. */
export function formatAppNames(
  appIds: readonly number[],
  apps: readonly PickableApp[],
): string {
  const wanted = new Set(appIds);
  return apps
    .filter((app) => wanted.has(app.id))
    .map((app) => app.name)
    .join(", ");
}

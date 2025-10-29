import { useMemo } from "react";
import { useSettings } from "@/hooks/useSettings";
import {
  WorkspaceZoomLevel,
  WorkspaceZoomLevelSchema,
} from "@/lib/schemas";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const WORKSPACE_ZOOM_LEVEL_LABELS: Record<WorkspaceZoomLevel, string> = {
  "90": "90%",
  "100": "100%",
  "110": "110%",
  "125": "125%",
  "150": "150%",
};

const WORKSPACE_ZOOM_LEVEL_DESCRIPTIONS: Record<WorkspaceZoomLevel, string> = {
  "90": "Slightly zoomed out to fit more content on screen.",
  "100": "Default zoom level.",
  "110": "Zoom in a little for easier reading.",
  "125": "Large zoom for improved readability.",
  "150": "Maximum zoom for maximum accessibility.",
};

const DEFAULT_ZOOM_LEVEL: WorkspaceZoomLevel = "100";

export function WorkspaceZoomSelector() {
  const { settings, updateSettings } = useSettings();
  const currentZoomLevel: WorkspaceZoomLevel = useMemo(() => {
    const value = settings?.workspaceZoomLevel ?? DEFAULT_ZOOM_LEVEL;
    return WorkspaceZoomLevelSchema.safeParse(value).success
      ? (value as WorkspaceZoomLevel)
      : DEFAULT_ZOOM_LEVEL;
  }, [settings?.workspaceZoomLevel]);

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor="workspace-zoom-level">Workspace zoom level</Label>
        <p className="text-sm text-muted-foreground">
          Adjust how large the entire Dyad workspace appears. This mirrors the
          browser zoom controls that Electron provides.
        </p>
      </div>
      <Select
        value={currentZoomLevel}
        onValueChange={(value) =>
          updateSettings({ workspaceZoomLevel: value as WorkspaceZoomLevel })
        }
      >
        <SelectTrigger id="workspace-zoom-level" className="w-[220px]">
          <SelectValue placeholder="Select zoom level" />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(WORKSPACE_ZOOM_LEVEL_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              <div className="flex flex-col text-left">
                <span>{label}</span>
                <span className="text-xs text-muted-foreground">
                  {
                    WORKSPACE_ZOOM_LEVEL_DESCRIPTIONS[
                      value as WorkspaceZoomLevel
                    ]
                  }
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

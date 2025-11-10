import { useMemo } from "react";
import { useSettings } from "@/hooks/useSettings";
import { ZoomLevel, ZoomLevelSchema } from "@/lib/schemas";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ZOOM_LEVEL_LABELS: Record<ZoomLevel, string> = {
  "90": "90%",
  "100": "100%",
  "110": "110%",
  "125": "125%",
  "150": "150%",
};

const ZOOM_LEVEL_DESCRIPTIONS: Record<ZoomLevel, string> = {
  "90": "Slightly zoomed out to fit more content on screen.",
  "100": "Default zoom level.",
  "110": "Zoom in a little for easier reading.",
  "125": "Large zoom for improved readability.",
  "150": "Maximum zoom for maximum accessibility.",
};

const DEFAULT_ZOOM_LEVEL: ZoomLevel = "100";

export function ZoomSelector() {
  const { settings, updateSettings } = useSettings();
  const currentZoomLevel: ZoomLevel = useMemo(() => {
    const value = settings?.zoomLevel ?? DEFAULT_ZOOM_LEVEL;
    return ZoomLevelSchema.safeParse(value).success
      ? (value as ZoomLevel)
      : DEFAULT_ZOOM_LEVEL;
  }, [settings?.zoomLevel]);

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor="zoom-level">Zoom level</Label>
        <p className="text-sm text-muted-foreground">
          Adjusts the zoom level to make content easier to read.
        </p>
      </div>
      <Select
        value={currentZoomLevel}
        onValueChange={(value) =>
          updateSettings({ zoomLevel: value as ZoomLevel })
        }
      >
        <SelectTrigger id="zoom-level" className="w-[220px]">
          <SelectValue placeholder="Select zoom level" />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(ZOOM_LEVEL_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              <div className="flex flex-col text-left">
                <span>{label}</span>
                <span className="text-xs text-muted-foreground">
                  {ZOOM_LEVEL_DESCRIPTIONS[value as ZoomLevel]}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

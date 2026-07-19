import { useMemo } from "react";
import { useSettings } from "@/hooks/useSettings";
import { ZoomLevel, ZoomLevelSchema, DEFAULT_ZOOM_LEVEL } from "@/lib/schemas";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "react-i18next";

const ZOOM_LEVEL_LABELS: Record<ZoomLevel, string> = {
  "90": "90%",
  "100": "100%",
  "110": "110%",
  "125": "125%",
  "150": "150%",
};

export function ZoomSelector() {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation("settings");
  const currentZoomLevel: ZoomLevel = useMemo(() => {
    const value = settings?.zoomLevel ?? DEFAULT_ZOOM_LEVEL;
    return ZoomLevelSchema.safeParse(value).success
      ? (value as ZoomLevel)
      : DEFAULT_ZOOM_LEVEL;
  }, [settings?.zoomLevel]);

  const getZoomDescription = (value: ZoomLevel) => {
    switch (value) {
      case "90":
        return t("ai.zoomOptionDescription90");
      case "100":
        return t("ai.zoomOptionDescription100");
      case "110":
        return t("ai.zoomOptionDescription110");
      case "125":
        return t("ai.zoomOptionDescription125");
      case "150":
        return t("ai.zoomOptionDescription150");
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor="zoom-level">{t("general.zoom")}</Label>
        <p className="text-sm text-muted-foreground">
          {t("general.zoomDescription")}
        </p>
      </div>
      <Select
        value={currentZoomLevel}
        onValueChange={(value) =>
          updateSettings({ zoomLevel: value as ZoomLevel })
        }
      >
        <SelectTrigger id="zoom-level" className="w-[220px]">
          <SelectValue placeholder={t("general.selectZoom")} />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(ZOOM_LEVEL_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              <div className="flex flex-col text-left">
                <span>{label}</span>
                <span className="text-xs text-muted-foreground">
                  {getZoomDescription(value as ZoomLevel)}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

import { useMemo } from "react";
import { useSettings } from "@/hooks/useSettings";
import {
  WorkspaceTextSize,
  WorkspaceTextSizeSchema,
} from "@/lib/schemas";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const WORKSPACE_TEXT_SIZE_LABELS: Record<WorkspaceTextSize, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
  extraLarge: "Extra large",
};

const WORKSPACE_TEXT_SIZE_DESCRIPTIONS: Record<WorkspaceTextSize, string> = {
  small: "Compact text for maximizing information density.",
  medium: "Default text size.",
  large: "Comfortable larger text for easier reading.",
  extraLarge: "Largest text size for maximum readability.",
};

const DEFAULT_TEXT_SIZE: WorkspaceTextSize = "medium";

export function WorkspaceTextSizeSelector() {
  const { settings, updateSettings } = useSettings();
  const currentSize: WorkspaceTextSize = useMemo(() => {
    const value = settings?.workspaceTextSize ?? DEFAULT_TEXT_SIZE;
    return WorkspaceTextSizeSchema.safeParse(value).success
      ? (value as WorkspaceTextSize)
      : DEFAULT_TEXT_SIZE;
  }, [settings?.workspaceTextSize]);

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor="workspace-text-size">Workspace text size</Label>
        <p className="text-sm text-muted-foreground">
          Choose the font size used throughout the Dyad workspace interface.
        </p>
      </div>
      <Select
        value={currentSize}
        onValueChange={(value) =>
          updateSettings({ workspaceTextSize: value as WorkspaceTextSize })
        }
      >
        <SelectTrigger id="workspace-text-size" className="w-[220px]">
          <SelectValue placeholder="Select text size" />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(WORKSPACE_TEXT_SIZE_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              <div className="flex flex-col text-left">
                <span>{label}</span>
                <span className="text-xs text-muted-foreground">
                  {WORKSPACE_TEXT_SIZE_DESCRIPTIONS[value as WorkspaceTextSize]}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

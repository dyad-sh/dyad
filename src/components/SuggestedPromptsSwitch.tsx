import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_ENABLE_SUGGESTED_PROMPTS } from "@/shared/settings_defaults";

export function SuggestedPromptsSwitch() {
  const { settings, updateSettings } = useSettings();
  const isEnabled =
    settings?.enableSuggestedPrompts ?? DEFAULT_ENABLE_SUGGESTED_PROMPTS;

  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="suggested-prompts"
        aria-label="Suggested follow-up prompts"
        checked={isEnabled}
        disabled={!settings}
        onCheckedChange={(checked) => {
          // The settings mutation shows its own error toast.
          void updateSettings({ enableSuggestedPrompts: checked }).catch(
            () => {},
          );
        }}
      />
      <Label htmlFor="suggested-prompts">Suggested follow-up prompts</Label>
    </div>
  );
}

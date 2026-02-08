import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function PromptForTemplateSwitch() {
  const { settings, updateSettings } = useSettings();
  const isEnabled = settings?.promptForTemplate !== false;

  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="prompt-for-template"
        aria-label="Prompt for template when creating new app"
        checked={isEnabled}
        onCheckedChange={(checked) => {
          updateSettings({
            promptForTemplate: checked,
          });
        }}
      />
      <Label htmlFor="prompt-for-template">
        Prompt for template when creating new app
      </Label>
    </div>
  );
}

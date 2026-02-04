import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function AutocompleteSwitch() {
  const { settings, updateSettings } = useSettings();
  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="enable-autocomplete"
        aria-label="Chat autocomplete"
        checked={settings?.enableAutocomplete ?? false}
        onCheckedChange={() => {
          updateSettings({
            enableAutocomplete: !settings?.enableAutocomplete,
          });
        }}
      />
      <Label htmlFor="enable-autocomplete">Chat autocomplete</Label>
    </div>
  );
}

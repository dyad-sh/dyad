import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/useSettings";

export function BlockUnsafeNpmPackagesSwitch() {
  const { settings, updateSettings } = useSettings();

  return (
    <div className="space-y-1">
      <div className="flex items-center space-x-2">
        <Switch
          id="block-unsafe-npm-packages"
          aria-label="Block unsafe npm packages"
          checked={settings?.blockUnsafeNpmPackages ?? true}
          onCheckedChange={(checked) => {
            updateSettings({
              blockUnsafeNpmPackages: checked,
            });
          }}
        />
        <Label htmlFor="block-unsafe-npm-packages">
          Block unsafe npm packages
        </Label>
      </div>
      <div className="text-sm text-gray-500 dark:text-gray-400">
        Uses socket.dev to detect unsafe packages and blocks them
      </div>
    </div>
  );
}

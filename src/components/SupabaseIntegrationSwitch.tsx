import { useState, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/useSettings";
import { showSuccess, showError } from "@/lib/toast";

interface SupabaseIntegrationSwitchProps {
  showToast?: boolean;
}

export function SupabaseIntegrationSwitch({
  showToast = true,
}: SupabaseIntegrationSwitchProps) {
  const { settings, updateSettings, refreshSettings } = useSettings();
  const [isEnabled, setIsEnabled] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (settings) {
      setIsEnabled(settings.experiments?.enableSupabaseIntegration || false);
    }
  }, [settings]);

  const handleToggle = async () => {
    try {
      setIsUpdating(true);
      const newValue = !isEnabled;

      await updateSettings({
        experiments: {
          enableSupabaseIntegration: newValue,
        },
      });

      setIsEnabled(newValue);
      if (showToast) {
        showSuccess(
          `Supabase integration ${newValue ? "enabled" : "disabled"}`
        );
      }
      refreshSettings();
    } catch (error) {
      console.error("Error toggling Supabase integration:", error);
      if (showToast) {
        showError("Failed to update Supabase integration setting");
      }
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="flex items-center justify-between">
      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
        Enable Supabase Integration
      </label>
      <Switch
        checked={isEnabled}
        onCheckedChange={handleToggle}
        disabled={isUpdating}
        className="data-[state=checked]:bg-blue-600"
      />
    </div>
  );
}

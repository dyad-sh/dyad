import { useState } from "react";
import { Button } from "@/components/ui/button";
// We might need a Supabase icon here, but for now, let's use a generic one or text.
// import { Supabase } from "lucide-react"; // Placeholder
import { DatabaseZap } from "lucide-react"; // Using DatabaseZap as a placeholder
import { useSettings } from "@/hooks/useSettings";
import { showSuccess, showError } from "@/lib/toast";

export function SupabaseIntegration() {
  const { settings, updateSettings } = useSettings();
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const handleDisconnectFromSupabase = async () => {
    setIsDisconnecting(true);
    try {
      // Clear the entire supabase object in settings
      const result = await updateSettings({
        supabase: undefined,
      });
      if (result) {
        showSuccess("Successfully disconnected from Supabase");
      } else {
        showError("Failed to disconnect from Supabase");
      }
    } catch (err: any) {
      showError(
        err.message || "An error occurred while disconnecting from Supabase",
      );
    } finally {
      setIsDisconnecting(false);
    }
  };

  // Check if there's any Supabase accessToken to determine connection status
  const isConnected = !!settings?.supabase?.accessToken;

  if (!isConnected) {
    return null;
  }

  return (
    <div className="flex items-center justify-between">
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Supabase Integration
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Your account is connected to Supabase.
        </p>
      </div>

      <Button
        onClick={handleDisconnectFromSupabase}
        variant="destructive"
        size="sm"
        disabled={isDisconnecting}
        className="flex items-center gap-2"
      >
        {isDisconnecting ? "Disconnecting..." : "Disconnect from Supabase"}
        <DatabaseZap className="h-4 w-4" /> {/* Placeholder icon */}
      </Button>
    </div>
  );
}

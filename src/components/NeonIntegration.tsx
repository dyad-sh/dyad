import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Database } from "lucide-react";
import { useSettings } from "@/hooks/useSettings";
import { showSuccess, showError } from "@/lib/toast";

export function NeonIntegration() {
  const { settings, updateSettings } = useSettings();
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const handleDisconnectFromNeon = async () => {
    setIsDisconnecting(true);
    try {
      await updateSettings({
        neon: undefined,
      });
      showSuccess("Successfully disconnected from Neon");
    } catch (err: any) {
      showError(
        err.message || "An error occurred while disconnecting from Neon",
      );
    } finally {
      setIsDisconnecting(false);
    }
  };

  const isConnected = !!settings?.neon?.accessToken;

  if (!isConnected) {
    return null;
  }

  return (
    <div className="flex items-center justify-between">
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Neon Database Integration
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Your account is connected to Neon Database.
        </p>
      </div>

      <Button
        onClick={handleDisconnectFromNeon}
        variant="destructive"
        size="sm"
        disabled={isDisconnecting}
        className="flex items-center gap-2"
      >
        {isDisconnecting ? "Disconnecting..." : "Disconnect from Neon"}
        <Database className="h-4 w-4" />
      </Button>
    </div>
  );
}

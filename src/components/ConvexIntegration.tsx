import { Button } from "@/components/ui/button";
import { useSettings } from "@/hooks/useSettings";
import { showSuccess, showError } from "@/lib/toast";
import { isConvexConnected } from "@/lib/schemas";

export function ConvexIntegration() {
  const { settings, updateSettings } = useSettings();

  const isConnected = isConvexConnected(settings);

  if (!isConnected) {
    return null;
  }

  const handleDisconnect = async () => {
    try {
      await updateSettings({
        convex: undefined,
      });
      showSuccess("Disconnected from Convex");
    } catch (err: any) {
      showError(
        err.message || "An error occurred while disconnecting from Convex",
      );
    }
  };

  return (
    <div className="flex items-center justify-between">
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Convex
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Connected to {settings?.convex?.deploymentUrl}
        </p>
      </div>
      <Button
        onClick={handleDisconnect}
        variant="destructive"
        size="sm"
        className="flex items-center gap-2"
      >
        Disconnect
      </Button>
    </div>
  );
}

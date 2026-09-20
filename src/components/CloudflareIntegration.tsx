import { useState } from "react";
import { Cloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/hooks/useSettings";
import { showSuccess } from "@/lib/toast";

/**
 * The account-level Cloudflare connection. Removing the token does not touch
 * any Worker or deploy rule: those keep deploying until a new token is added
 * or the app is disconnected from the Publish panel.
 */
export function CloudflareIntegration() {
  const { settings, updateSettings } = useSettings();
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // Shown for a saved token even with the experiment off, or turning it off
  // would leave a stored token with no way to remove it.
  if (!settings?.cloudflareAccessToken) {
    return null;
  }

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await updateSettings({ cloudflareAccessToken: undefined });
      showSuccess("Disconnected from Cloudflare.");
    } catch {
      // useSettings reports a failed write itself.
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <div className="flex items-center justify-between">
      <div>
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Cloudflare Integration
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Your Cloudflare API token is saved.
        </p>
      </div>
      <Button
        onClick={handleDisconnect}
        variant="destructive"
        size="sm"
        disabled={isDisconnecting}
        className="flex items-center gap-2"
      >
        {isDisconnecting ? "Disconnecting..." : "Disconnect from Cloudflare"}
        <Cloud className="h-4 w-4" />
      </Button>
    </div>
  );
}

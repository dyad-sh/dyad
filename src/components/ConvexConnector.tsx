import { useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ipc } from "@/ipc/types";
import { useLoadApp } from "@/hooks/useLoadApp";
import { showError } from "@/lib/toast";
import { toast } from "sonner";

export function ConvexConnector({ appId }: { appId: number }) {
  const { app, refreshApp } = useLoadApp(appId);
  const [isSettingUp, setIsSettingUp] = useState(false);

  const hasConvexIntegration = !!app?.files?.some(
    (filePath) => filePath === "convex" || filePath.startsWith("convex/"),
  );

  const handleSetupConvex = async () => {
    try {
      setIsSettingUp(true);
      const result = await ipc.app.setupConvex({ appId });
      await refreshApp();
      if (result.alreadySetup) {
        toast.success("Convex backend is already set up for this app.");
      } else {
        toast.success("Convex backend set up successfully.");
      }
    } catch (error) {
      showError(error);
    } finally {
      setIsSettingUp(false);
    }
  };

  return (
    <div className="flex flex-col space-y-4 p-4 border bg-white dark:bg-gray-800 rounded-md">
      <div className="flex flex-col items-start justify-between">
        <div className="flex items-center justify-between w-full pb-1">
          <h2 className="text-lg font-medium">Convex Integration</h2>
          <Button
            variant="outline"
            className="ml-2 px-2 py-1 h-8 inline-flex items-center gap-1"
            onClick={() =>
              ipc.system.openExternalUrl("https://docs.convex.dev")
            }
          >
            Docs
            <ExternalLink className="h-3 w-3" />
          </Button>
        </div>

        <p className="text-sm text-gray-500 dark:text-gray-400 pb-3">
          {hasConvexIntegration
            ? "Convex backend files are present in this app."
            : "Set up Convex to use a real-time backend with auth and server functions."}
        </p>

        <Button
          onClick={handleSetupConvex}
          disabled={isSettingUp}
          data-testid="setup-convex-button"
        >
          {isSettingUp ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Setting up...
            </>
          ) : hasConvexIntegration ? (
            "Re-run Convex setup"
          ) : (
            "Set up Convex"
          )}
        </Button>
      </div>
    </div>
  );
}

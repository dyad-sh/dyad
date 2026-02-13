import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ipc } from "@/ipc/types";
import { toast } from "sonner";
import { useSettings } from "@/hooks/useSettings";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLoadApp } from "@/hooks/useLoadApp";
import { ExternalLink } from "lucide-react";
import { isConvexConnected } from "@/lib/schemas";

export function ConvexConnector({ appId }: { appId: number }) {
  const { settings, updateSettings } = useSettings();
  const { app, refreshApp } = useLoadApp(appId);
  const [deploymentUrl, setDeploymentUrl] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);

  const isConnected = isConvexConnected(settings);
  const hasDeployment = !!app?.convexDeploymentUrl;

  const handleConnect = async () => {
    if (!deploymentUrl.trim()) {
      toast.error("Please enter a Convex deployment URL");
      return;
    }

    setIsConnecting(true);
    try {
      // Save the deployment URL to settings
      await updateSettings({
        convex: {
          ...settings?.convex,
          deploymentUrl: deploymentUrl.trim(),
        },
      });

      // Link to the app
      await ipc.convex.setAppDeployment({
        appId,
        deploymentUrl: deploymentUrl.trim(),
      });

      toast.success("Connected to Convex deployment");
      await refreshApp();
      setDeploymentUrl("");
    } catch (error) {
      toast.error(`Failed to connect: ${String(error)}`);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await ipc.convex.unsetAppDeployment({ appId });
      toast.success("Disconnected from Convex");
      await refreshApp();
    } catch (error) {
      console.error("Failed to disconnect:", error);
      toast.error("Failed to disconnect from Convex");
    }
  };

  // Connected and has deployment set
  if (isConnected && hasDeployment) {
    return (
      <Card className="mt-1">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Convex
            <Button
              variant="outline"
              onClick={() => {
                ipc.system.openExternalUrl("https://dashboard.convex.dev/");
              }}
              className="ml-2 px-2 py-1 inline-flex items-center gap-2"
            >
              Convex Dashboard
              <ExternalLink className="h-4 w-4" />
            </Button>
          </CardTitle>
          <CardDescription className="flex flex-col gap-1.5 text-sm">
            Connected to Convex deployment{" "}
            <Badge
              variant="secondary"
              className="ml-2 text-xs font-mono px-3 py-1 break-all"
            >
              {app.convexDeploymentUrl}
            </Badge>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={handleDisconnect}>
            Disconnect Convex
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Not connected - show connect form
  return (
    <Card className="mt-1">
      <CardHeader>
        <CardTitle>Convex</CardTitle>
        <CardDescription>
          Connect your app to a Convex deployment for a real-time reactive
          backend with database, server functions, and file storage.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="convex-deployment-url">Deployment URL</Label>
            <Input
              id="convex-deployment-url"
              placeholder="https://your-project-123.convex.cloud"
              value={deploymentUrl}
              onChange={(e) => setDeploymentUrl(e.target.value)}
              data-testid="convex-deployment-url-input"
            />
            <p className="text-xs text-muted-foreground">
              Find this in your Convex dashboard under Settings &gt; URL &amp;
              Deploy Key.
            </p>
          </div>
          <Button
            onClick={handleConnect}
            disabled={isConnecting || !deploymentUrl.trim()}
            data-testid="connect-convex-button"
          >
            {isConnecting ? "Connecting..." : "Connect to Convex"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

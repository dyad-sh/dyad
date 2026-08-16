import { useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useVercelAccount } from "@/hooks/useVercelAccount";
import { ipc } from "@/ipc/types";
import { showError } from "@/lib/toast";

export function VercelIntegration() {
  const {
    isConnected,
    projects,
    connect,
    isConnecting,
    disconnect,
    isDisconnecting,
  } = useVercelAccount();
  const [token, setToken] = useState("");

  const handleConnect = async () => {
    if (!token.trim()) {
      showError("Enter a Vercel access token.");
      return;
    }
    await connect(token.trim());
    setToken("");
  };

  if (isConnected) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-cyan-50">Vercel connected</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {projects.length} project{projects.length === 1 ? "" : "s"} found.
            The token is encrypted on this device.
          </p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => void disconnect()}
          disabled={isDisconnecting}
        >
          {isDisconnecting ? "Disconnecting…" : "Disconnect"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-5 text-muted-foreground">
        Paste a Vercel access token to deploy apps and read hosting projects.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="settings-vercel-token">Access token</Label>
        <Input
          id="settings-vercel-token"
          type="password"
          autoComplete="off"
          placeholder="Enter your Vercel token"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void handleConnect();
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => void handleConnect()}
          disabled={!token.trim() || isConnecting}
        >
          {isConnecting && <Loader2 className="mr-2 size-4 animate-spin" />}
          Connect Vercel
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            void ipc.system.openExternalUrl(
              "https://vercel.com/account/settings/tokens",
            )
          }
        >
          Create token <ExternalLink className="ml-1 size-3.5" />
        </Button>
      </div>
    </div>
  );
}

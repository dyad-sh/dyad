import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NeonDisconnectButton } from "@/components/NeonDisconnectButton";
import { useDeepLink } from "@/contexts/DeepLinkContext";
import { useSettings } from "@/hooks/useSettings";
import { ipc } from "@/ipc/types";
import { showError } from "@/lib/toast";

const NEON_OAUTH_URL = "https://oauth.dyad.sh/api/integrations/neon/login";

export function NeonIntegration() {
  const { settings, refreshSettings } = useSettings();
  const { lastDeepLink, clearLastDeepLink } = useDeepLink();
  const [connecting, setConnecting] = useState(false);
  const isConnected = !!settings?.neon?.accessToken;

  useEffect(() => {
    if (lastDeepLink?.type !== "neon-oauth-return") return;
    void refreshSettings().finally(() => {
      setConnecting(false);
      clearLastDeepLink();
    });
  }, [clearLastDeepLink, lastDeepLink, refreshSettings]);

  if (isConnected) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-cyan-50">Neon connected</p>
          <p className="mt-1 text-xs text-cyan-100/40">
            OAuth credentials are encrypted on this device.
          </p>
        </div>
        <NeonDisconnectButton />
      </div>
    );
  }

  const connect = async () => {
    setConnecting(true);
    try {
      if (settings?.isTestMode) {
        await ipc.neon.fakeConnect();
        await refreshSettings();
        setConnecting(false);
      } else {
        await ipc.system.openExternalUrl(NEON_OAUTH_URL);
      }
    } catch (error) {
      setConnecting(false);
      showError(error);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs leading-5 text-cyan-100/50">
        Authorize Neon directly from this settings row. The browser returns to
        the app after approval; no project must be selected yet.
      </p>
      <Button onClick={() => void connect()} disabled={connecting}>
        {connecting ? (
          <Loader2 className="mr-2 size-4 animate-spin" />
        ) : (
          <ExternalLink className="mr-2 size-4" />
        )}
        {connecting ? "Waiting for Neon…" : "Connect Neon"}
      </Button>
    </div>
  );
}

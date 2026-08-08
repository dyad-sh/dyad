import { useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useGithubAccount } from "@/hooks/useGithubAccount";
import { ipc } from "@/ipc/types";
import { showError } from "@/lib/toast";

export function GitHubIntegration() {
  const {
    isConnected,
    account,
    setAccessToken,
    isConnecting,
    disconnect,
    isDisconnecting,
  } = useGithubAccount();
  const [token, setToken] = useState("");

  const connect = async () => {
    if (!token.trim()) {
      showError("Enter a GitHub personal access token.");
      return;
    }
    await setAccessToken(token.trim());
    setToken("");
  };

  if (isConnected) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-cyan-50">
            Connected{account?.login ? ` as ${account.login}` : ""}
          </p>
          <p className="mt-1 text-xs text-cyan-100/40">
            This token is encrypted on this device.
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
      <p className="text-xs leading-5 text-cyan-100/50">
        Enter a fine-grained or classic personal access token with repository
        access. Credentials are verified before being stored.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="settings-github-token">Personal access token</Label>
        <Input
          id="settings-github-token"
          type="password"
          autoComplete="off"
          placeholder="github_pat_… or ghp_…"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void connect();
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => void connect()}
          disabled={!token.trim() || isConnecting}
        >
          {isConnecting && <Loader2 className="mr-2 size-4 animate-spin" />}
          Connect GitHub
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            void ipc.system.openExternalUrl(
              "https://github.com/settings/personal-access-tokens",
            )
          }
        >
          Create token <ExternalLink className="ml-1 size-3.5" />
        </Button>
      </div>
    </div>
  );
}

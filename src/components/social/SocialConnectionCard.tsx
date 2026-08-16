import { useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, Unplug } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSocialConnections } from "@/hooks/useSocialMedia";
import { ipc } from "@/ipc/types";
import type { SocialPlatform } from "@/ipc/types/social_media";
import { showError, showSuccess } from "@/lib/toast";
import { X_OAUTH_REDIRECT_URI } from "@/lib/xOAuth";
import { SOCIAL_PLATFORM_META } from "./social-platform-meta";

function CredentialField({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = "password",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function SocialConnectionCard({
  platform,
}: {
  platform: SocialPlatform;
}) {
  const meta = SOCIAL_PLATFORM_META[platform];
  const {
    connections,
    isLoading,
    connectFacebook,
    isConnectingFacebook,
    connectX,
    isConnectingX,
    disconnect,
    isDisconnecting,
  } = useSocialConnections();
  const [facebook, setFacebook] = useState({
    pageId: "",
    pageAccessToken: "",
  });
  const [x, setX] = useState({
    clientId: "",
    clientSecret: "",
  });

  const status = connections?.[platform];
  const isConnected = status?.connected ?? false;
  const isConnecting = isConnectingFacebook || isConnectingX;
  const accountLabel =
    platform === "facebook"
      ? (connections?.facebook.pageName ?? connections?.facebook.pageId)
      : connections?.x.username
        ? `@${connections.x.username}`
        : undefined;

  const handleConnect = async () => {
    try {
      if (platform === "facebook") {
        if (!facebook.pageId.trim() || !facebook.pageAccessToken.trim()) {
          showError("Enter the Facebook Page ID and Page access token.");
          return;
        }
        await connectFacebook({
          pageId: facebook.pageId.trim(),
          pageAccessToken: facebook.pageAccessToken.trim(),
        });
        setFacebook({ pageId: "", pageAccessToken: "" });
      } else {
        if (!x.clientId.trim()) {
          showError("Enter the X OAuth 2.0 Client ID.");
          return;
        }
        await connectX({
          clientId: x.clientId.trim(),
          clientSecret: x.clientSecret.trim() || undefined,
        });
        setX({ clientId: "", clientSecret: "" });
      }
      showSuccess(`${meta.label} connected`);
    } catch (error) {
      showError(error);
    }
  };

  if (isLoading) {
    return <Loader2 className="size-4 animate-spin text-primary/70" />;
  }

  if (isConnected) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-2 text-sm text-foreground">
            <CheckCircle2 className="size-4 text-emerald-500" />
            Connected{accountLabel ? ` as ${accountLabel}` : ""}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Credentials are encrypted on this device.
          </p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => void disconnect(platform)}
          disabled={isDisconnecting}
        >
          {isDisconnecting ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Unplug className="mr-2 size-4" />
          )}
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {platform === "facebook" ? (
        <>
          <CredentialField
            id="settings-facebook-page-id"
            label="Page ID"
            type="text"
            placeholder="113456789012345"
            value={facebook.pageId}
            onChange={(pageId) =>
              setFacebook((current) => ({ ...current, pageId }))
            }
          />
          <CredentialField
            id="settings-facebook-page-token"
            label="Page access token"
            placeholder="EAAB…"
            value={facebook.pageAccessToken}
            onChange={(pageAccessToken) =>
              setFacebook((current) => ({ ...current, pageAccessToken }))
            }
          />
        </>
      ) : (
        <div className="space-y-2">
          <CredentialField
            id="settings-x-client-id"
            label="OAuth 2.0 Client ID"
            type="text"
            value={x.clientId}
            onChange={(clientId) =>
              setX((current) => ({ ...current, clientId }))
            }
          />
          <CredentialField
            id="settings-x-client-secret"
            label="OAuth 2.0 Client Secret"
            placeholder="Optional for public/native apps"
            value={x.clientSecret}
            onChange={(clientSecret) =>
              setX((current) => ({ ...current, clientSecret }))
            }
          />
          <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs">
            <p className="font-medium text-foreground">Callback URI</p>
            <code className="mt-1 block break-all text-muted-foreground">
              {X_OAUTH_REDIRECT_URI}
            </code>
          </div>
          <p className="text-xs text-muted-foreground">
            Allow-list this callback in the X app and enable read and write.
            Connect opens X to grant user-context publishing permissions; the
            app-only Bearer Token cannot publish.
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void handleConnect()} disabled={isConnecting}>
          {isConnecting && <Loader2 className="mr-2 size-4 animate-spin" />}
          Connect {meta.label}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            void ipc.system.openExternalUrl(
              platform === "facebook"
                ? "https://developers.facebook.com/tools/explorer/"
                : "https://developer.x.com/en/portal/dashboard",
            )
          }
        >
          Get credentials <ExternalLink className="ml-1 size-3.5" />
        </Button>
      </div>
    </div>
  );
}

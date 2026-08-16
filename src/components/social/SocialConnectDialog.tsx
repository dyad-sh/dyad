import { useState } from "react";
import { ExternalLink, Loader2, PlugZap } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSocialConnections } from "@/hooks/useSocialMedia";
import type { SocialPlatform } from "@/ipc/types/social_media";
import { showSuccess } from "@/lib/toast";
import { X_OAUTH_REDIRECT_URI } from "@/lib/xOAuth";
import {
  SOCIAL_PLATFORM_META,
  SocialPlatformIcon,
} from "./social-platform-meta";

function FieldRow({
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
        value={value}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function HelpLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-primary hover:underline"
    >
      {children}
      <ExternalLink className="size-3" />
    </a>
  );
}

/**
 * Credential dialog for connecting Facebook (Page id + Page access token) or
 * X (OAuth 2.0 Authorization Code with PKCE). Credentials are verified against
 * the platform API before the resulting tokens are stored encrypted locally.
 */
export function SocialConnectDialog({
  platform,
  open,
  onOpenChange,
}: {
  platform: SocialPlatform;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const meta = SOCIAL_PLATFORM_META[platform];
  const { connectFacebook, connectX, isConnectingFacebook, isConnectingX } =
    useSocialConnections();
  const isConnecting = isConnectingFacebook || isConnectingX;

  const [error, setError] = useState<string | null>(null);
  const [facebookForm, setFacebookForm] = useState({
    pageId: "",
    pageAccessToken: "",
  });
  const [xForm, setXForm] = useState({
    clientId: "",
    clientSecret: "",
  });

  const canSubmit =
    platform === "facebook"
      ? facebookForm.pageId.trim() && facebookForm.pageAccessToken.trim()
      : xForm.clientId.trim();

  const handleConnect = async () => {
    setError(null);
    try {
      if (platform === "facebook") {
        await connectFacebook({
          pageId: facebookForm.pageId.trim(),
          pageAccessToken: facebookForm.pageAccessToken.trim(),
        });
      } else {
        await connectX({
          clientId: xForm.clientId.trim(),
          clientSecret: xForm.clientSecret.trim() || undefined,
        });
      }
      showSuccess(`${meta.label} connected`);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <span
              className={`grid size-9 place-items-center rounded-xl border ${meta.iconWrapClass}`}
            >
              <SocialPlatformIcon platform={platform} className="size-4.5" />
            </span>
            Connect {meta.label}
          </DialogTitle>
          <DialogDescription>
            {platform === "facebook"
              ? "Post to a Facebook Page from Planner. Use a Page access token with the pages_manage_posts permission."
              : "Sign in to X with OAuth 2.0 User Context. Your app credentials never leave this device."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {platform === "facebook" ? (
            <>
              <FieldRow
                id="fb-page-id"
                label="Page ID"
                type="text"
                placeholder="e.g. 113456789012345"
                value={facebookForm.pageId}
                onChange={(pageId) =>
                  setFacebookForm((f) => ({ ...f, pageId }))
                }
              />
              <FieldRow
                id="fb-page-token"
                label="Page access token"
                placeholder="EAAB…"
                value={facebookForm.pageAccessToken}
                onChange={(pageAccessToken) =>
                  setFacebookForm((f) => ({ ...f, pageAccessToken }))
                }
              />
              <p className="text-xs text-muted-foreground">
                Generate both in the{" "}
                <HelpLink href="https://developers.facebook.com/tools/explorer/">
                  Graph API Explorer
                </HelpLink>{" "}
                or your app's dashboard at{" "}
                <HelpLink href="https://developers.facebook.com/apps/">
                  developers.facebook.com
                </HelpLink>
                .
              </p>
            </>
          ) : (
            <>
              <FieldRow
                id="x-client-id"
                label="OAuth 2.0 Client ID"
                type="text"
                placeholder="Your X app Client ID"
                value={xForm.clientId}
                onChange={(clientId) => setXForm((f) => ({ ...f, clientId }))}
              />
              <FieldRow
                id="x-client-secret"
                label="OAuth 2.0 Client Secret"
                placeholder="Optional for public/native apps"
                value={xForm.clientSecret}
                onChange={(clientSecret) =>
                  setXForm((f) => ({ ...f, clientSecret }))
                }
              />
              <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs">
                <p className="font-medium text-foreground">Callback URI</p>
                <code className="mt-1 block break-all text-muted-foreground">
                  {X_OAUTH_REDIRECT_URI}
                </code>
              </div>
              <p className="text-xs text-muted-foreground">
                Add the callback URI above to your X app, enable OAuth 2.0 with
                read and write permissions, then enter the Client ID from the{" "}
                <HelpLink href="https://developer.x.com/en/portal/dashboard">
                  X developer portal
                </HelpLink>
                . Clicking connect opens X to grant tweet.read, users.read,
                tweet.write, media.write, and offline.access. Do not paste the
                app-only Bearer Token.
              </p>
            </>
          )}

          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isConnecting}
          >
            Cancel
          </Button>
          <Button onClick={handleConnect} disabled={!canSubmit || isConnecting}>
            {isConnecting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <PlugZap className="size-4" />
            )}
            {isConnecting ? "Verifying…" : "Verify & connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

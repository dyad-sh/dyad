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
 * X (the four OAuth 1.0a keys from an X developer app). Credentials are
 * verified against the platform API before being stored (encrypted) locally.
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
    apiKey: "",
    apiSecret: "",
    accessToken: "",
    accessTokenSecret: "",
  });

  const canSubmit =
    platform === "facebook"
      ? facebookForm.pageId.trim() && facebookForm.pageAccessToken.trim()
      : Object.values(xForm).every((v) => v.trim());

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
          apiKey: xForm.apiKey.trim(),
          apiSecret: xForm.apiSecret.trim(),
          accessToken: xForm.accessToken.trim(),
          accessTokenSecret: xForm.accessTokenSecret.trim(),
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
              : "Post to X from Planner. Use the keys from an X developer app with Read and Write permissions."}
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
                id="x-api-key"
                label="API key (consumer key)"
                value={xForm.apiKey}
                onChange={(apiKey) => setXForm((f) => ({ ...f, apiKey }))}
              />
              <FieldRow
                id="x-api-secret"
                label="API key secret"
                value={xForm.apiSecret}
                onChange={(apiSecret) => setXForm((f) => ({ ...f, apiSecret }))}
              />
              <FieldRow
                id="x-access-token"
                label="Access token"
                value={xForm.accessToken}
                onChange={(accessToken) =>
                  setXForm((f) => ({ ...f, accessToken }))
                }
              />
              <FieldRow
                id="x-access-token-secret"
                label="Access token secret"
                value={xForm.accessTokenSecret}
                onChange={(accessTokenSecret) =>
                  setXForm((f) => ({ ...f, accessTokenSecret }))
                }
              />
              <p className="text-xs text-muted-foreground">
                Create an app with Read and Write permissions in the{" "}
                <HelpLink href="https://developer.x.com/en/portal/dashboard">
                  X developer portal
                </HelpLink>
                , then copy the four keys from “Keys and tokens”.
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

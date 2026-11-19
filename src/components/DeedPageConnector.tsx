import { useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ipc } from "@/ipc/types";
import { showError, showSuccess } from "@/lib/toast";
import {
  useDeedPageSite,
  useDisconnectDeedPage,
  usePublishToDeedPage,
} from "@/hooks/useDeedPageDeploy";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Publishes the app's build output to https://<site>.deed.page/.
 *
 * No account is needed: the first publish returns an owner token that Dyad
 * stores, encrypted, with its other settings and sends on later publishes.
 */
export function DeedPageConnector({ appId }: { appId: number }) {
  const { data: site, isLoading } = useDeedPageSite(appId);
  const publish = usePublishToDeedPage(appId);
  const disconnect = useDisconnectDeedPage(appId);
  const [slug, setSlug] = useState("");
  const trimmed = slug.trim();
  const slugError =
    trimmed && !SLUG_RE.test(trimmed)
      ? "Use lowercase letters, numbers, and dashes."
      : null;

  const onPublish = () => {
    publish.mutate(site ? {} : { slug: trimmed || undefined }, {
      onSuccess: (result) =>
        showSuccess(`Published ${result.version} to ${result.url}`),
      onError: (error) => showError(error),
    });
  };

  if (isLoading) {
    return <Loader2 className="h-4 w-4 animate-spin" />;
  }

  return (
    <div className="space-y-3" data-testid="deedpage-connector">
      {site ? (
        <div className="flex items-center gap-2 text-sm">
          <span>Live at</span>
          <a
            href={site.url}
            onClick={(event) => {
              event.preventDefault();
              ipc.system.openExternalUrl(site.url);
            }}
            className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
          >
            {site.url}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      ) : (
        <div className="space-y-1">
          <Label htmlFor="deedpage-slug">Site name (optional)</Label>
          <Input
            id="deedpage-slug"
            placeholder="my-app"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
          />
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {slugError ??
              "Leave blank to use the app name. The site is served at <name>.deed.page."}
          </p>
        </div>
      )}
      <div className="flex gap-2">
        <Button onClick={onPublish} disabled={publish.isPending || !!slugError}>
          {publish.isPending && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          {publish.isPending
            ? "Building and publishing..."
            : site
              ? "Publish update"
              : "Publish to deed.page"}
        </Button>
        {site && (
          <Button
            variant="outline"
            onClick={() => disconnect.mutate()}
            disabled={disconnect.isPending || publish.isPending}
          >
            Forget site
          </Button>
        )}
      </div>
      {site && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Forgetting the site only unlinks it from this app; the site stays
          online.
        </p>
      )}
    </div>
  );
}

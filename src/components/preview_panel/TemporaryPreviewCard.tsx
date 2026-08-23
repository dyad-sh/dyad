import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  Timer,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ipc, type TempPreviewStatus } from "@/ipc/types";
import { getErrorMessage } from "@/lib/errors";
import { queryKeys } from "@/lib/queryKeys";

interface TemporaryPreviewCardProps {
  appId: number;
}

export function TemporaryPreviewCard({ appId }: TemporaryPreviewCardProps) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [revokeAppId, setRevokeAppId] = useState<number | null>(null);
  const queryKey = queryKeys.tempPreviews.status({ appId });
  const statusQuery = useQuery({
    queryKey,
    queryFn: () => ipc.tempPreview.getStatus({ appId }),
  });

  const publishMutation = useMutation({
    mutationFn: (originAppId: number) =>
      ipc.tempPreview.publish({ appId: originAppId }),
    onSuccess: (status, originAppId) => {
      const originQueryKey = queryKeys.tempPreviews.status({
        appId: originAppId,
      });
      const previousStatus =
        queryClient.getQueryData<TempPreviewStatus>(originQueryKey);
      queryClient.setQueryData(originQueryKey, status);
      toast.success(
        previousStatus?.state === "active"
          ? "Temporary preview updated"
          : "Temporary preview is live",
      );
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const revokeMutation = useMutation({
    mutationFn: (originAppId: number) =>
      ipc.tempPreview.revoke({ appId: originAppId }),
    onSuccess: (status, originAppId) => {
      queryClient.setQueryData(
        queryKeys.tempPreviews.status({ appId: originAppId }),
        status,
      );
      toast.success("Temporary preview revoked");
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      toast.error("Could not copy the preview URL");
    }
  };

  const status = statusQuery.data;
  const activeStatus =
    status?.state === "active" && status.canonicalUrl
      ? { ...status, canonicalUrl: status.canonicalUrl }
      : null;
  const isPublishing = publishMutation.isPending;
  const statusAnnouncement = getStatusAnnouncement({
    status,
    error: statusQuery.error,
    isChecking: statusQuery.isPending,
    isPublishing: publishMutation.isPending,
    isRevoking: revokeMutation.isPending,
  });

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Timer className="size-5" />
            Temporary preview
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="sr-only" role="status" aria-live="polite">
            {statusAnnouncement}
          </p>
          <div className="space-y-1">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Share a public, static preview without connecting GitHub or a
              deployment provider. It expires automatically after 7 days.
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Anyone with the link can view it. Server-side features and secrets
              are not included.
            </p>
          </div>

          {statusQuery.isPending ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Checking preview status…
            </div>
          ) : statusQuery.isError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <p className="text-destructive">
                {getErrorMessage(statusQuery.error)}
              </p>
              <Button
                className="mt-3"
                size="sm"
                variant="outline"
                onClick={() => statusQuery.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : activeStatus ? (
            <ActivePreview
              status={activeStatus}
              copied={copied}
              isPublishing={isPublishing}
              isRevoking={revokeMutation.isPending}
              onCopy={copyUrl}
              onOpen={(url) => {
                void ipc.system
                  .openExternalUrl(url)
                  .catch((error) => toast.error(getErrorMessage(error)));
              }}
              onUpdate={() => publishMutation.mutate(appId)}
              onRevoke={() => setRevokeAppId(appId)}
            />
          ) : (
            <div className="space-y-3">
              {status?.state === "expired" && (
                <p className="text-sm text-muted-foreground">
                  Your previous preview expired. Create a new one to get a fresh
                  link.
                </p>
              )}
              {status?.state === "revoked" && (
                <p className="text-sm text-muted-foreground">
                  Your previous preview was revoked.
                </p>
              )}
              <Button
                onClick={() => publishMutation.mutate(appId)}
                disabled={isPublishing}
              >
                {isPublishing ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Timer />
                )}
                {isPublishing ? "Building and publishing…" : "Create preview"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={revokeAppId !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeAppId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this temporary preview?</AlertDialogTitle>
            <AlertDialogDescription>
              The public link will stop working immediately. You can create a
              new preview later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revokeMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={revokeMutation.isPending}
              onClick={() => {
                if (revokeAppId !== null) {
                  revokeMutation.mutate(revokeAppId);
                }
              }}
            >
              {revokeMutation.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Trash2 />
              )}
              Revoke preview
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function getStatusAnnouncement({
  status,
  error,
  isChecking,
  isPublishing,
  isRevoking,
}: {
  status: TempPreviewStatus | undefined;
  error: Error | null;
  isChecking: boolean;
  isPublishing: boolean;
  isRevoking: boolean;
}): string {
  if (isChecking) return "Checking preview status";
  if (error) return `Preview status error: ${getErrorMessage(error)}`;
  if (isPublishing) {
    return status?.state === "active"
      ? "Building and updating temporary preview"
      : "Building and publishing temporary preview";
  }
  if (isRevoking) return "Revoking temporary preview";

  switch (status?.state) {
    case "active":
      return "Temporary preview is active";
    case "expired":
      return "Temporary preview expired";
    case "revoked":
      return "Temporary preview revoked";
    default:
      return "Temporary preview is not published";
  }
}

function ActivePreview({
  status,
  copied,
  isPublishing,
  isRevoking,
  onCopy,
  onOpen,
  onUpdate,
  onRevoke,
}: {
  status: TempPreviewStatus & { canonicalUrl: string };
  copied: boolean;
  isPublishing: boolean;
  isRevoking: boolean;
  onCopy: (url: string) => void;
  onOpen: (url: string) => void;
  onUpdate: () => void;
  onRevoke: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/30 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p
              className="truncate text-sm font-medium"
              title={status.canonicalUrl}
            >
              {status.canonicalUrl}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatExpiry(status.expiresAt)}
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button
              aria-label="Copy preview URL"
              size="icon"
              variant="ghost"
              onClick={() => onCopy(status.canonicalUrl)}
            >
              {copied ? <Check /> : <Copy />}
            </Button>
            <Button
              aria-label="Open temporary preview"
              size="icon"
              variant="ghost"
              onClick={() => onOpen(status.canonicalUrl)}
            >
              <ExternalLink />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={onUpdate} disabled={isPublishing || isRevoking}>
          {isPublishing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {isPublishing ? "Building and updating…" : "Update preview"}
        </Button>
        <Button
          variant="outline"
          onClick={onRevoke}
          disabled={isPublishing || isRevoking}
        >
          <Trash2 />
          Revoke
        </Button>
      </div>
    </div>
  );
}

function formatExpiry(expiresAt: string | null): string {
  if (!expiresAt) return "Expires automatically";
  const parsed = new Date(expiresAt);
  if (Number.isNaN(parsed.getTime())) return "Expires automatically";
  return `Expires ${parsed.toLocaleString()}`;
}

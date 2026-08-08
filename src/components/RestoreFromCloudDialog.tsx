import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cloud, Download, Loader2, Package } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ipc } from "@/ipc/types";
import type { CloudApp } from "@/ipc/types/cloud_apps";
import { isIpcRendererAvailable } from "@/ipc/contracts/core";
import { useOpenApp } from "@/hooks/useOpenApp";
import { queryKeys } from "@/lib/queryKeys";
import { showError, showSuccess } from "@/lib/toast";

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function RestoreFromCloudDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const openApp = useOpenApp();

  const listQuery = useQuery({
    queryKey: ["cloudApps", "list"],
    queryFn: () => ipc.cloudApps.list(),
    enabled: open && isIpcRendererAvailable(),
  });

  const restore = useMutation({
    mutationFn: (item: CloudApp) =>
      ipc.cloudApps.restore({ url: item.url, pathname: item.pathname }),
    onSuccess: async ({ appId, name }) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.apps.all });
      showSuccess(`Restored "${name}" from cloud`);
      onOpenChange(false);
      openApp(appId);
    },
    onError: (e) =>
      showError(e instanceof Error ? e.message : "Restore failed"),
  });

  const apps = listQuery.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud className="h-5 w-5" />
            Restore app from cloud
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Pull a backed-up app's source from your cloud <code>code/</code>{" "}
          folder into a new local app and open it in the IDE.
        </p>

        <div className="mt-2 max-h-[55vh] space-y-2 overflow-y-auto">
          {listQuery.isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : listQuery.isError ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Couldn't reach the cloud drive. Connect it in Settings →
              Connections.
            </div>
          ) : apps.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No app backups found yet. The coder saves app source here
              automatically as you build.
            </div>
          ) : (
            apps.map((app) => (
              <div
                key={app.pathname}
                className="flex items-center gap-3 rounded-lg border p-3"
                data-testid="cloud-app-row"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-md border bg-muted">
                  <Package className="h-4 w-4 text-muted-foreground" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={app.name}>
                    {app.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatSize(app.size)} ·{" "}
                    {new Date(app.uploadedAt).toLocaleString()}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={restore.isPending}
                  onClick={() => restore.mutate(app)}
                >
                  {restore.isPending &&
                  restore.variables?.pathname === app.pathname ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Restore
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

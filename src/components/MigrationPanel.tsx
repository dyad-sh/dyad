import { useMutation } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Database, Loader2, CheckCircle2, XCircle } from "lucide-react";

interface MigrationPanelProps {
  appId: number;
}

export const MigrationPanel = ({ appId }: MigrationPanelProps) => {
  const pushMutation = useMutation({
    mutationFn: () => ipc.migration.push({ appId }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Database className="w-5 h-5 text-primary" />
          Database Migration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Push your development database schema to production.
        </p>

        <Button
          onClick={() => pushMutation.mutate()}
          disabled={pushMutation.isPending}
        >
          {pushMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Migrating...
            </>
          ) : (
            <>
              <Database className="w-4 h-4 mr-2" />
              Migrate to Production
            </>
          )}
        </Button>

        {pushMutation.isSuccess && (
          <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            Migration applied successfully.
          </div>
        )}

        {pushMutation.isError && (
          <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
            <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              {pushMutation.error instanceof Error
                ? pushMutation.error.message
                : String(pushMutation.error)}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

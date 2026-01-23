import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExternalLink, Database, Loader2 } from "lucide-react";
import { showSuccess, showError } from "@/lib/toast";
import { useVersions } from "@/hooks/useVersions";

interface PortalMigrateProps {
  appId: number;
}

export const PortalMigrate = ({ appId }: PortalMigrateProps) => {
  const [output, setOutput] = useState<string>("");
  const { refreshVersions } = useVersions(appId);

  const migrateMutation = useMutation({
    mutationFn: async () => {
      const ipcClient = IpcClient.getInstance();
      return ipcClient.portalMigrateCreate({ appId });
    },
    onSuccess: (result) => {
      setOutput(result.output);
      showSuccess(
        "Database migration file generated and committed successfully!",
      );
      refreshVersions();
    },
    onError: (error) => {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      setOutput(`Error: ${errorMessage}`);
      showError(errorMessage);
    },
  });

  const handleCreateMigration = () => {
    setOutput(""); // Clear previous output
    migrateMutation.mutate();
  };

  const openDocs = () => {
    const ipcClient = IpcClient.getInstance();
    ipcClient.openExternalUrl(
      "https://www.dyad.sh/docs/templates/portal#create-a-database-migration",
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Database className="w-5 h-5 text-primary" />
          Portal Database Migration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Generate a new database migration file for your Portal app.
        </p>

        <div className="flex items-center gap-3">
          <Button
            onClick={handleCreateMigration}
            disabled={migrateMutation.isPending}
            // className="bg-primary hover:bg-purple-700 text-white"
          >
            {migrateMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Database className="w-4 h-4 mr-2" />
                Generate database migration
              </>
            )}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={openDocs}
            className="text-sm"
          >
            <ExternalLink className="w-3 h-3 mr-1" />
            Docs
          </Button>
        </div>

        {output && (
          <div className="mt-4">
            <div className="bg-gray-50 dark:bg-gray-900 border rounded-lg p-3">
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Command Output:
              </h4>
              <div className="max-h-64 overflow-auto">
                <pre className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap font-mono">
                  {output}
                </pre>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

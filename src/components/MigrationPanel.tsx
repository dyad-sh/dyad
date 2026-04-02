import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import type { GenerateMigrationDiffResponse } from "@/ipc/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Database,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";

interface MigrationPanelProps {
  appId: number;
}

export const MigrationPanel = ({ appId }: MigrationPanelProps) => {
  const [diffResult, setDiffResult] =
    useState<GenerateMigrationDiffResponse | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applySuccess, setApplySuccess] = useState<boolean>(false);

  const generateDiffMutation = useMutation({
    mutationFn: async () => {
      return ipc.migration.generateDiff({ appId });
    },
    onSuccess: (result) => {
      setDiffResult(result);
      setApplyError(null);
      setApplySuccess(false);
    },
    onError: () => {
      setDiffResult(null);
      setApplyError(null);
      setApplySuccess(false);
    },
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!diffResult?.statements) {
        throw new Error("No migration statements to apply.");
      }
      return ipc.migration.apply({
        appId,
        statements: diffResult.statements.map((s) => s.sql),
      });
    },
    onSuccess: () => {
      setApplySuccess(true);
      setApplyError(null);
    },
    onError: (error) => {
      setApplyError(error instanceof Error ? error.message : String(error));
      setApplySuccess(false);
    },
  });

  const handleGenerate = () => {
    setDiffResult(null);
    setApplyError(null);
    setApplySuccess(false);
    generateDiffMutation.mutate();
  };

  const handleApply = () => {
    setApplyError(null);
    setApplySuccess(false);
    applyMutation.mutate();
  };

  const isGenerating = generateDiffMutation.isPending;
  const isApplying = applyMutation.isPending;
  const generateError = generateDiffMutation.error;
  const noChanges = diffResult !== null && !diffResult.hasChanges;
  const hasChanges = diffResult !== null && diffResult.hasChanges;

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
          Compare your development and production database schemas and apply
          changes to production.
        </p>

        <div className="flex items-center gap-3">
          <Button
            onClick={handleGenerate}
            disabled={isGenerating || isApplying}
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing schemas...
              </>
            ) : (
              <>
                <Database className="w-4 h-4 mr-2" />
                Generate Migration
              </>
            )}
          </Button>

          {hasChanges && !applySuccess && (
            <Button
              onClick={handleApply}
              disabled={isApplying || isGenerating}
              variant={
                diffResult.hasDestructiveChanges ? "destructive" : "default"
              }
            >
              {isApplying ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Applying migration...
                </>
              ) : (
                "Apply Migration to Production"
              )}
            </Button>
          )}
        </div>

        {/* No changes */}
        {noChanges && (
          <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            Your production schema is already up to date.
          </div>
        )}

        {/* Changes detected — summary */}
        {hasChanges && !applySuccess && (
          <div className="text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900 border rounded-lg p-3 space-y-1">
            <p className="font-medium">
              Changes detected ({diffResult.devBranchName} &rarr;{" "}
              {diffResult.prodBranchName}):
            </p>
            <p>
              {[
                diffResult.summary.added.length > 0 &&
                  `${diffResult.summary.added.length} table(s) added`,
                diffResult.summary.altered.length > 0 &&
                  `${diffResult.summary.altered.length} table(s) altered`,
                diffResult.summary.dropped.length > 0 &&
                  `${diffResult.summary.dropped.length} table(s) dropped`,
              ]
                .filter(Boolean)
                .join(", ") || `${diffResult.statements.length} statement(s)`}
            </p>
            {diffResult.hasDestructiveChanges && (
              <div className="flex items-center gap-1.5 text-red-600 dark:text-red-400 mt-1">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                This migration contains destructive operations.
              </div>
            )}
          </div>
        )}

        {/* Generate error */}
        {generateError && (
          <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
            <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              {generateError instanceof Error
                ? generateError.message
                : String(generateError)}
            </span>
          </div>
        )}

        {/* Apply error */}
        {applyError && (
          <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
            <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{applyError}</span>
          </div>
        )}

        {/* Apply success */}
        {applySuccess && (
          <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            Migration applied successfully.
          </div>
        )}
      </CardContent>
    </Card>
  );
};

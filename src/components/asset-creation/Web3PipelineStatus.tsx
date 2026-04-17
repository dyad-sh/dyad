import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, Loader2, AlertCircle } from "lucide-react";

interface PipelineResult {
  celestia?: { contentHash: string; height?: number };
  marketplaceSync?: { marketplaceAssetId?: string; success: boolean };
}

interface Web3PipelineStatusProps {
  isRunning: boolean;
  results: PipelineResult | null;
}

/** Visual status card for the post-mint Web3 pipeline. */
export function Web3PipelineStatus({ isRunning, results }: Web3PipelineStatusProps) {
  const steps = [
    {
      label: "Celestia DA Provenance",
      done: !!results?.celestia?.contentHash,
      failed: results && !results.celestia,
    },
    {
      label: "Marketplace Sync",
      done: !!results?.marketplaceSync?.success,
      failed: results?.marketplaceSync && !results.marketplaceSync.success,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Web3 Pipeline Status</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            {isRunning && !step.done && !step.failed ? (
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
            ) : step.done ? (
              <CheckCircle className="h-4 w-4 text-green-500" />
            ) : step.failed ? (
              <AlertCircle className="h-4 w-4 text-amber-500" />
            ) : (
              <div className="h-4 w-4 rounded-full border border-muted-foreground/30" />
            )}
            <span className={step.done ? "text-foreground" : "text-muted-foreground"}>
              {step.label}
            </span>
          </div>
        ))}
        {results?.celestia?.contentHash && (
          <p className="text-xs text-muted-foreground mt-2">
            DA Hash: <span className="font-mono">{results.celestia.contentHash.slice(0, 20)}...</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

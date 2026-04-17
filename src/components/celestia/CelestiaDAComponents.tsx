import React from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, AlertCircle, Loader2 } from "lucide-react";

/** Small badge showing if Celestia DA node is available. */
export function CelestiaStatusBadge({ isAvailable }: { isAvailable: boolean }) {
  return (
    <Badge variant={isAvailable ? "default" : "secondary"} className="text-xs">
      {isAvailable ? "Celestia Online" : "Celestia Offline"}
    </Badge>
  );
}

interface AnchoringCardProps {
  isAnchoring: boolean;
  result?: { contentHash?: string; height?: number };
  error?: string;
}

/** Card showing the anchoring operation progress/result. */
export function CelestiaAnchoringCard({ isAnchoring, result, error }: AnchoringCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          {isAnchoring ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : result ? (
            <CheckCircle className="h-4 w-4 text-green-500" />
          ) : error ? (
            <AlertCircle className="h-4 w-4 text-red-500" />
          ) : null}
          Celestia DA Anchoring
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm space-y-1">
        {isAnchoring && <p className="text-muted-foreground">Recording provenance to Celestia...</p>}
        {result?.contentHash && (
          <p>
            <span className="text-muted-foreground">Hash:</span>{" "}
            <span className="font-mono text-xs">{result.contentHash.slice(0, 24)}...</span>
          </p>
        )}
        {result?.height && (
          <p>
            <span className="text-muted-foreground">Height:</span> {result.height}
          </p>
        )}
        {error && <p className="text-red-500">{error}</p>}
      </CardContent>
    </Card>
  );
}

interface AnchorSummaryProps {
  contentHash?: string;
  height?: number;
}

/** Compact one-line summary of a Celestia anchor result. */
export function CelestiaAnchorSummary({ contentHash, height }: AnchorSummaryProps) {
  if (!contentHash) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <CheckCircle className="h-3 w-3 text-green-500" />
      Anchored: {contentHash.slice(0, 12)}... (height {height ?? "?"})
    </div>
  );
}

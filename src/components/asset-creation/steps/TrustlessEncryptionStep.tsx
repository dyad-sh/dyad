import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Shield, Loader2 } from "lucide-react";

interface TrustlessEncryptionStepProps {
  onComplete: (config: { enabled: boolean; mode?: string; result?: unknown }) => void;
  nftContract?: string;
  tokenId?: string;
  file?: File | null;
  isProcessing?: boolean;
  /** Legacy compat */
  config?: {
    trustlessEnabled?: boolean;
    trustlessMode?: string;
    trustlessResult?: unknown;
  };
  onConfigChange?: (update: Record<string, unknown>) => void;
  processing?: boolean;
}

/**
 * Step component for trustless encryption configuration.
 * Token-gated decryption happens buyer-side — this configures the seller's encryption preferences.
 */
export function TrustlessEncryptionStep({
  onComplete,
  nftContract,
  tokenId,
  file,
  isProcessing,
  config,
  onConfigChange,
  processing,
}: TrustlessEncryptionStepProps) {
  const [enabled, setEnabled] = useState(config?.trustlessEnabled ?? false);
  const busy = isProcessing || processing;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Shield className="h-5 w-5" />
          Trustless Encryption
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="trustless-toggle">Enable trustless encryption</Label>
          <Switch
            id="trustless-toggle"
            checked={enabled}
            onCheckedChange={(checked) => {
              setEnabled(checked);
              onConfigChange?.({ trustlessEnabled: checked });
            }}
          />
        </div>
        {enabled && (
          <p className="text-sm text-muted-foreground">
            Chunks will be encrypted with AES-256-GCM. Buyers decrypt using their ERC-1155 token ownership as the access gate.
          </p>
        )}
        {nftContract && (
          <p className="text-xs text-muted-foreground">Contract: {nftContract.slice(0, 10)}...</p>
        )}
        <Button
          className="w-full"
          disabled={busy}
          onClick={() => onComplete({ enabled, mode: enabled ? "aes-256-gcm" : undefined })}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          {enabled ? "Configure & Continue" : "Skip Encryption & Continue"}
        </Button>
      </CardContent>
    </Card>
  );
}

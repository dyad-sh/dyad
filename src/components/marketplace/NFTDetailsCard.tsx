import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExternalLink } from "lucide-react";

interface NFTDetailsCardProps {
  tokenId?: string;
  contractAddress?: string;
  chainId?: number;
  metadataCid?: string;
  imageCid?: string;
}

export function NFTDetailsCard({ tokenId, contractAddress, chainId, metadataCid, imageCid }: NFTDetailsCardProps) {
  const explorerBase = chainId === 80002
    ? "https://amoy.polygonscan.com"
    : "https://polygonscan.com";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">NFT Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {tokenId && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Token ID</span>
            <span className="font-mono">{tokenId}</span>
          </div>
        )}
        {contractAddress && (
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Contract</span>
            <a
              href={`${explorerBase}/address/${contractAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-blue-500 hover:underline font-mono text-xs"
            >
              {contractAddress.slice(0, 6)}...{contractAddress.slice(-4)}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}
        {metadataCid && (
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Metadata</span>
            <a
              href={`https://gateway.pinata.cloud/ipfs/${metadataCid}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-blue-500 hover:underline font-mono text-xs"
            >
              {metadataCid.slice(0, 12)}...
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

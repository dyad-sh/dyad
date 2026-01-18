/**
 * Joy Blockchain Identity Settings Component
 * Configure Joy ID and Collection Contract for blockchain validation
 */

import { useState } from "react";
import { useSettings } from "@/hooks/useSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Wallet, Copy, Check, Key } from "lucide-react";
import { toast } from "sonner";

export function JoyIdentitySettings() {
  const { settings, updateSettings } = useSettings();
  const [joyId, setJoyId] = useState(settings?.joyId || "");
  const [collectionContract, setCollectionContract] = useState(settings?.collectionContract || "");
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleSave = () => {
    updateSettings({
      joyId: joyId.trim() || undefined,
      collectionContract: collectionContract.trim() || undefined,
    });
    toast.success("Joy identity settings saved successfully");
  };

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
    toast.success("Copied to clipboard");
  };

  const hasChanges = 
    joyId !== (settings?.joyId || "") || 
    collectionContract !== (settings?.collectionContract || "");

  return (
    <Card className="border-purple-500/20 bg-gradient-to-br from-purple-500/5 to-transparent">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-purple-500/20 to-indigo-500/20 border border-purple-500/20">
            <Wallet className="h-5 w-5 text-purple-500" />
          </div>
          <div>
            <CardTitle className="flex items-center gap-2">
              Joy Blockchain Identity
            </CardTitle>
            <CardDescription>
              Configure your Joy ID and collection contract for blockchain validation
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Joy ID Field */}
        <div className="space-y-2">
          <Label htmlFor="joy-id" className="flex items-center gap-2">
            <Key className="h-4 w-4 text-purple-500" />
            Joy ID
          </Label>
          <div className="flex gap-2">
            <Input
              id="joy-id"
              placeholder="Enter your Joy ID (e.g., joy1abc...xyz)"
              value={joyId}
              onChange={(e) => setJoyId(e.target.value)}
              className="font-mono text-sm"
            />
            {settings?.joyId && (
              <Button
                variant="outline"
                size="icon"
                onClick={() => handleCopy(settings.joyId!, "joyId")}
                disabled={!settings.joyId}
              >
                {copiedField === "joyId" ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Your unique Joy blockchain identity. Used for signing and validating data on the Joy network.
          </p>
        </div>

        {/* Collection Contract Field */}
        <div className="space-y-2">
          <Label htmlFor="collection-contract" className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-purple-500" />
            Collection Contract Address
          </Label>
          <div className="flex gap-2">
            <Input
              id="collection-contract"
              placeholder="Enter collection contract address (e.g., 0xabc...xyz)"
              value={collectionContract}
              onChange={(e) => setCollectionContract(e.target.value)}
              className="font-mono text-sm"
            />
            {settings?.collectionContract && (
              <Button
                variant="outline"
                size="icon"
                onClick={() => handleCopy(settings.collectionContract!, "contract")}
                disabled={!settings.collectionContract}
              >
                {copiedField === "contract" ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            The smart contract address for your NFT collection. Required for publishing verified data.
          </p>
        </div>

        {/* Info Box */}
        <div className="mt-4 p-4 bg-purple-500/10 border border-purple-500/20 rounded-lg">
          <div className="flex items-start gap-3">
            <Wallet className="h-5 w-5 text-purple-500 mt-0.5 flex-shrink-0" />
            <div className="space-y-2 text-sm">
              <p className="font-medium text-purple-700 dark:text-purple-300">
                Wallet Signing & Validation
              </p>
              <p className="text-purple-600/80 dark:text-purple-400/80">
                When you publish data to Joy, these credentials will be used to sign transactions with your wallet. 
                This ensures authenticity and enables on-chain validation of your published content.
              </p>
              <ul className="space-y-1 text-purple-600/70 dark:text-purple-400/70 ml-4 list-disc">
                <li>Your Joy ID identifies you on the blockchain</li>
                <li>The collection contract links your data to your NFT collection</li>
                <li>All publications are cryptographically signed for verification</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end pt-2">
          <Button
            onClick={handleSave}
            disabled={!hasChanges}
            className="bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600"
          >
            <Check className="h-4 w-4 mr-2" />
            Save Identity Settings
          </Button>
        </div>

        {/* Current Settings Display */}
        {(settings?.joyId || settings?.collectionContract) && (
          <div className="mt-4 pt-4 border-t border-purple-500/20">
            <p className="text-xs font-medium text-muted-foreground mb-2">Current Configuration:</p>
            <div className="space-y-1.5 text-xs">
              {settings.joyId && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground min-w-[100px]">Joy ID:</span>
                  <code className="bg-purple-500/10 px-2 py-0.5 rounded text-purple-700 dark:text-purple-300 font-mono">
                    {settings.joyId.slice(0, 20)}...{settings.joyId.slice(-10)}
                  </code>
                </div>
              )}
              {settings.collectionContract && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground min-w-[100px]">Contract:</span>
                  <code className="bg-purple-500/10 px-2 py-0.5 rounded text-purple-700 dark:text-purple-300 font-mono">
                    {settings.collectionContract.slice(0, 20)}...{settings.collectionContract.slice(-10)}
                  </code>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

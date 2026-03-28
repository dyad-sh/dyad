/**
 * HuggingFace Integration Settings Component
 * Manages HF token configuration and auth status
 */

import { useState } from "react";
import { useSettings } from "@/hooks/useSettings";
import { useHfAuthStatus } from "@/hooks/useHuggingFace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { showSuccess, showError } from "@/lib/toast";
import { CheckCircle2, XCircle, Eye, EyeOff } from "lucide-react";

export function HuggingFaceIntegration() {
  const { settings, updateSettings } = useSettings();
  const { data: authStatus, refetch } = useHfAuthStatus();
  const [tokenInput, setTokenInput] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);

  const isConnected = authStatus?.authenticated === true;
  const hasToken = !!settings?.huggingFaceToken?.value;

  const handleSaveToken = async () => {
    if (!tokenInput.trim()) return;
    setSaving(true);
    try {
      await updateSettings({
        huggingFaceToken: { value: tokenInput.trim(), encryptionType: "electron-safe-storage" },
      });
      setTokenInput("");
      await refetch();
      showSuccess("HuggingFace token saved");
    } catch (err) {
      showError("Failed to save token");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveToken = async () => {
    setSaving(true);
    try {
      await updateSettings({
        huggingFaceToken: undefined,
      });
      await refetch();
      showSuccess("HuggingFace token removed");
    } catch {
      showError("Failed to remove token");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img
            src="https://huggingface.co/front/assets/huggingface_logo-noborder.svg"
            alt="HF"
            className="h-5 w-5"
          />
          <h3 className="font-medium text-sm">HuggingFace</h3>
        </div>
        {isConnected ? (
          <Badge variant="default" className="gap-1 text-xs">
            <CheckCircle2 className="h-3 w-3" />
            {authStatus.username}
          </Badge>
        ) : hasToken ? (
          <Badge variant="destructive" className="gap-1 text-xs">
            <XCircle className="h-3 w-3" />
            Invalid token
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-xs">Not connected</Badge>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Add your HuggingFace access token to search, download, and push models.
        Get one at{" "}
        <a
          href="https://huggingface.co/settings/tokens"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline"
        >
          huggingface.co/settings/tokens
        </a>
      </p>

      {!isConnected && (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              type={showToken ? "text" : "password"}
              placeholder="hf_..."
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              className="pr-8 h-8 text-sm"
            />
            <button
              type="button"
              onClick={() => setShowToken(!showToken)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          <Button
            size="sm"
            className="h-8"
            disabled={!tokenInput.trim() || saving}
            onClick={handleSaveToken}
          >
            Save
          </Button>
        </div>
      )}

      {hasToken && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={saving}
          onClick={handleRemoveToken}
        >
          Remove Token
        </Button>
      )}
    </div>
  );
}

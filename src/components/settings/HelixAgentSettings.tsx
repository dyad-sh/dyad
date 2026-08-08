import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, KeyRound, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSettings } from "@/hooks/useSettings";
import { SECTION_IDS, SETTING_IDS } from "@/lib/settingsSearchIndex";

const settingsCardClass =
  "rounded-xl p-6 scroll-mt-24 border border-cyan-500/15 bg-[rgba(8,18,36,0.72)] shadow-[0_0_24px_rgba(0,229,255,0.06)] backdrop-blur-md";

/**
 * Vercel AI Gateway token used by the Helix coding agent. The token is passed
 * to the embedded Helix server as AI_GATEWAY_API_KEY when it starts.
 */
export function HelixAgentSettings() {
  const { settings, updateSettings, isUpdatePending } = useSettings();
  const [tokenInput, setTokenInput] = useState("");

  // Helix accepts the key from either home: this field, or the Vercel AI
  // Gateway provider. Reading only this one reported "not configured" for a
  // key the server was already using.
  const savedToken = settings?.vercelAiGatewayApiKey?.value ?? "";
  const providerToken =
    settings?.providerSettings?.vercel?.apiKey?.value?.trim() ?? "";
  const isConfigured = savedToken.length > 0 || providerToken.length > 0;
  const fromProvider = savedToken.length === 0 && providerToken.length > 0;

  // Clear the local input once a save lands so the field shows the masked state.
  useEffect(() => {
    setTokenInput("");
  }, [savedToken]);

  const handleSave = async () => {
    const trimmed = tokenInput.trim();
    if (!trimmed) return;
    await updateSettings({ vercelAiGatewayApiKey: { value: trimmed } });
  };

  const handleClear = async () => {
    await updateSettings({ vercelAiGatewayApiKey: undefined });
    setTokenInput("");
  };

  return (
    <div id={SECTION_IDS.helix} className={settingsCardClass}>
      <h2 className="font-jarvis-ui text-sm font-medium uppercase tracking-widest text-cyan-300/70 mb-1">
        Helix Coding Agent
      </h2>
      <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
        Helix runs on the Vercel AI Gateway. The token below is injected into
        the Helix server as{" "}
        <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-xs text-cyan-200">
          AI_GATEWAY_API_KEY
        </code>{" "}
        when it starts.
      </p>

      <div id={SETTING_IDS.helixGatewayKey} className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="helix-gateway-key">Vercel AI Gateway token</Label>
          {isConfigured && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
              <CheckCircle2 className="size-3" />
              {fromProvider ? "Using provider key" : "Configured"}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="helix-gateway-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={isConfigured ? "••••••••••••••••" : "vck_…"}
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            className="w-full max-w-md"
          />
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!tokenInput.trim() || isUpdatePending}
          >
            {isUpdatePending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <KeyRound className="size-3.5" />
            )}
            Save token
          </Button>
          {isConfigured && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleClear}
              disabled={isUpdatePending}
            >
              Remove
            </Button>
          )}
        </div>
        {fromProvider && (
          <p className="text-sm text-emerald-300/80">
            Helix is using the key from Settings → Providers → Vercel AI
            Gateway. Set one here only to override it.
          </p>
        )}
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Create a token in the{" "}
          <a
            href="https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Vercel dashboard → AI Gateway → API keys
            <ExternalLink className="size-3" />
          </a>
          . Restart Helix after changing it.
        </p>
      </div>
    </div>
  );
}

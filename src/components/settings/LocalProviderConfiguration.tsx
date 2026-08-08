import { useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, Server, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslation } from "react-i18next";
import { ipc } from "@/ipc/types";
import {
  DEFAULT_LM_STUDIO_BASE_URL,
  DEFAULT_OLLAMA_BASE_URL,
} from "@/lib/local_provider_utils";
import { DEFAULT_MX_SERVE_BASE_URL, dedupeMxServeModels } from "@/lib/mx_serve";
import type { LocalProviderSetting, UserSettings } from "@/lib/schemas";
import { useLocalProviderDiscovery } from "@/hooks/useLocalProviderStatus";

interface LocalProviderConfigurationProps {
  provider: LocalProviderId;
  providerDisplayName: string;
  settings: UserSettings | null | undefined;
  isSaving: boolean;
  onSave: (apiBaseUrl: string) => Promise<void>;
  onSetDisableThinking?: (disabled: boolean) => Promise<void>;
}

/** Every provider that runs on the user's own machine. */
type LocalProviderId = "lmstudio" | "ollama" | "mx_serve";

function getDefaultUrl(provider: LocalProviderId): string {
  if (provider === "lmstudio") return DEFAULT_LM_STUDIO_BASE_URL;
  if (provider === "mx_serve") return DEFAULT_MX_SERVE_BASE_URL;
  return DEFAULT_OLLAMA_BASE_URL;
}

function getPlaceholder(provider: LocalProviderId): string {
  if (provider === "lmstudio") return "http://localhost:1234";
  if (provider === "mx_serve") return DEFAULT_MX_SERVE_BASE_URL;
  return "http://localhost:11434";
}

/** Shown when the server cannot be reached — the fix, not just the fault. */
function getStartHint(provider: LocalProviderId): string | null {
  return provider === "mx_serve"
    ? "Open MX Serve, load a model, and start the server."
    : null;
}

export function LocalProviderConfiguration({
  provider,
  providerDisplayName,
  settings,
  isSaving,
  onSave,
  onSetDisableThinking,
}: LocalProviderConfigurationProps) {
  const { t } = useTranslation("settings");
  const stored = settings?.providerSettings?.[provider] as
    | LocalProviderSetting
    | undefined;

  const [serverUrl, setServerUrl] = useState(
    () => stored?.apiBaseUrl?.trim() || getDefaultUrl(provider),
  );
  const [testStatus, setTestStatus] = useState<
    "idle" | "testing" | "success" | "error"
  >("idle");
  const [testMessage, setTestMessage] = useState<string | null>(null);
  /** Named models from the last successful test, so the user can see them. */
  const [testedModels, setTestedModels] = useState<string[]>([]);
  const discoveryTarget = stored?.apiBaseUrl?.trim() || getDefaultUrl(provider);
  const discovery = useLocalProviderDiscovery([discoveryTarget]);
  const discoveredServers =
    discovery.data?.servers.filter((server) => server.provider === provider) ??
    [];

  const handleTestConnection = async () => {
    setTestStatus("testing");
    setTestMessage(null);
    try {
      await onSave(serverUrl.trim());
      if (provider === "mx_serve") {
        // Probed from the main process, not here. A renderer fetch to a local
        // server is a cross-origin request, and MX Serve sends no CORS header
        // — so it fails in the browser even while the server is healthy.
        const refreshed = await discovery.refetch();
        // One endpoint, not every reachable one: IPv4 and IPv6 loopback are
        // usually the same process, and merging their lists double-counts it.
        const endpoint = refreshed.data?.servers.find(
          (server) =>
            server.provider === "mx_serve" && server.models.length > 0,
        );
        const models = dedupeMxServeModels(
          (endpoint?.models ?? []).map((model) => ({
            ...model,
            id: model.modelName,
          })),
        );
        if (models.length === 0) {
          setTestStatus("error");
          setTestMessage(
            "Could not reach MX Serve. Open MX Serve, load a model, and start the server.",
          );
          setTestedModels([]);
          return;
        }
        setTestStatus("success");
        // Replaces the previous list rather than adding to it.
        setTestedModels(
          models.map((model) => model.displayName || model.modelName),
        );
        setTestMessage(`Connected — found ${models.length} model(s).`);
        return;
      }

      const result =
        provider === "lmstudio"
          ? await ipc.languageModel.listLMStudioModels()
          : await ipc.languageModel.listOllamaModels();
      setTestedModels(
        result.models
          .map(
            (model: { modelName?: string; displayName?: string }) =>
              model.displayName ?? model.modelName ?? "",
          )
          .filter(Boolean),
      );
      const count = result.models.length;
      setTestStatus("success");
      setTestMessage(
        t("localProvider.connectionSuccess", {
          count,
          defaultValue: `Connected — found ${count} model(s).`,
        }),
      );
    } catch (error) {
      setTestStatus("error");
      setTestMessage(
        error instanceof Error
          ? error.message
          : t("localProvider.connectionFailed"),
      );
    }
  };

  const handleSave = async () => {
    setTestStatus("idle");
    setTestMessage(null);
    await onSave(serverUrl.trim());
  };

  const handleReset = () => {
    setServerUrl(getDefaultUrl(provider));
    setTestStatus("idle");
    setTestMessage(null);
  };

  const selectDiscoveredServer = async (
    url: string,
    modelCount: number,
  ): Promise<void> => {
    setServerUrl(url);
    setTestStatus("testing");
    setTestMessage(null);
    try {
      await onSave(url);
      setTestStatus("success");
      setTestMessage(`Connected — found ${modelCount} model(s).`);
    } catch (error) {
      setTestStatus("error");
      setTestMessage(
        error instanceof Error ? error.message : "Could not save this server.",
      );
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-border/70 bg-card/50 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Server className="size-4" />
        </div>
        <div className="min-w-0 space-y-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {t("localProvider.serverTitle")}
            {/* Runs on this machine — worth saying, since it decides whether
                private memory may be sent to it. */}
            <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
              Local
            </span>
          </h3>
          <p className="text-sm text-muted-foreground">
            {provider === "mx_serve"
              ? "MX Serve runs models on this Mac and exposes an OpenAI-compatible API (default port 8080)."
              : provider === "lmstudio"
                ? t("localProvider.lmStudioDescription")
                : t("localProvider.ollamaDescription")}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <label
          htmlFor={`${provider}-server-url`}
          className="text-sm font-medium text-foreground"
        >
          {t("localProvider.serverUrlLabel", { name: providerDisplayName })}
        </label>
        <Input
          id={`${provider}-server-url`}
          value={serverUrl}
          onChange={(e) => {
            setServerUrl(e.target.value);
            setTestStatus("idle");
            setTestMessage(null);
          }}
          placeholder={getPlaceholder(provider)}
          className="font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground">
          {provider === "mx_serve"
            ? "Host and port, or the full /v1 root — both work."
            : provider === "lmstudio"
              ? t("localProvider.lmStudioHint")
              : t("localProvider.ollamaHint")}
        </p>
      </div>

      <div className="rounded-xl border border-cyan-400/15 bg-cyan-500/5 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <Wifi className="mt-0.5 size-4 shrink-0 text-cyan-300" />
            <div>
              <p className="text-sm font-medium text-cyan-50/90">
                Local network discovery
              </p>
              <p className="mt-0.5 text-xs leading-5 text-cyan-100/40">
                Automatically checks this computer and your private local subnet
                on the standard {providerDisplayName} port.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void discovery.refetch()}
            disabled={discovery.isFetching}
            className="shrink-0 text-cyan-100/55 hover:bg-cyan-500/10 hover:text-cyan-50"
          >
            {discovery.isFetching ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Scan
          </Button>
        </div>

        <div className="mt-3 space-y-2">
          {discovery.isPending ? (
            <div className="flex items-center gap-2 rounded-lg border border-cyan-400/10 bg-black/10 px-3 py-2 text-xs text-cyan-100/45">
              <Loader2 className="size-3.5 animate-spin" />
              Looking for {providerDisplayName} servers…
            </div>
          ) : discoveredServers.length === 0 ? (
            <div className="rounded-lg border border-red-400/15 bg-red-500/5 px-3 py-2 text-xs text-red-200/65">
              No online {providerDisplayName} server found on this computer or
              local network.
            </div>
          ) : (
            discoveredServers.map((server) => {
              const selected = serverUrl.trim() === server.url;
              return (
                <div
                  key={`${server.provider}:${server.url}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-cyan-400/15 bg-[#06111f]/75 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm text-cyan-50/85">
                      <CheckCircle2 className="size-3.5 shrink-0 text-emerald-400" />
                      <span className="truncate">{server.name}</span>
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[10px] text-cyan-100/40">
                      {server.url} · {server.models.length}{" "}
                      {server.models.length === 1 ? "model" : "models"} ·{" "}
                      {server.latencyMs} ms
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant={selected ? "ghost" : "outline"}
                    size="sm"
                    disabled={selected || isSaving || testStatus === "testing"}
                    onClick={() =>
                      void selectDiscoveredServer(
                        server.url,
                        server.models.length,
                      )
                    }
                    className={
                      selected
                        ? "text-emerald-300/75"
                        : "border-cyan-400/20 bg-cyan-500/5 text-cyan-100/75 hover:bg-cyan-500/10 hover:text-cyan-50"
                    }
                  >
                    {selected ? "Selected" : "Use server"}
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Reasoning models deliberate before every reply, including trivial
          ones. This sends /no_think so they answer straight away. */}
      {onSetDisableThinking && (
        <label className="flex items-start gap-2.5 rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <input
            type="checkbox"
            checked={stored?.disableThinking === true}
            onChange={(event) =>
              void onSetDisableThinking(event.target.checked)
            }
            disabled={isSaving}
            className="mt-0.5 size-4 accent-cyan-400"
            data-testid="local-provider-disable-thinking"
          />
          <span className="min-w-0">
            <span className="block text-sm text-foreground">
              Skip the model&apos;s thinking step
            </span>
            <span className="block text-xs text-muted-foreground">
              Reasoning models such as Qwen3 deliberate before answering, which
              is slow for ordinary chat. This asks them to reply directly.
              Models that do not think are unaffected.
            </span>
          </span>
        </label>
      )}

      {getStartHint(provider) && (
        <p className="text-xs text-muted-foreground">
          {getStartHint(provider)}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="w-fit"
          onClick={() => {
            void navigator.clipboard.writeText(
              serverUrl.trim() || getDefaultUrl(provider),
            );
          }}
        >
          Copy base URL
        </Button>
        <Button
          type="button"
          onClick={handleSave}
          disabled={isSaving || !serverUrl.trim()}
          className="w-fit"
        >
          {isSaving ? t("localProvider.saving") : t("localProvider.save")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleTestConnection}
          disabled={isSaving || testStatus === "testing" || !serverUrl.trim()}
          className="w-fit"
        >
          {testStatus === "testing" ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              {t("localProvider.testing")}
            </>
          ) : (
            t("localProvider.testConnection")
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleReset}
          disabled={isSaving}
        >
          {t("localProvider.resetDefault")}
        </Button>
      </div>

      {testMessage && (
        <p
          className={
            testStatus === "success"
              ? "text-xs text-emerald-600 dark:text-emerald-400"
              : "text-xs text-destructive"
          }
        >
          {testMessage}
        </p>
      )}

      {/* Naming the models is the point of the test: a count tells you the
          server answered, but not whether the model you wanted is loaded. */}
      {testStatus === "success" && testedModels.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            Available models
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {testedModels.map((model) => (
              <li
                key={model}
                className="rounded-md border border-border/70 bg-muted/40 px-2 py-1 font-mono text-xs text-foreground"
              >
                {model}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Assign these to a role under Settings → Model Roles.
          </p>
        </div>
      )}
    </div>
  );
}

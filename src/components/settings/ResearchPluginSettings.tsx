import { useState, type ReactNode } from "react";
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/useSettings";
import { ipc } from "@/ipc/types";
import type { ResearchPlugins } from "@/lib/schemas";
import { showError, showSuccess } from "@/lib/toast";

type ResearchPluginId =
  | "travel-search"
  | "duckduckgo"
  | "coingecko"
  | "weather"
  | "maps"
  | "skyscanner"
  | "amadeus"
  | "duffel";

const controlClass =
  "border-cyan-400/15 bg-slate-950/45 text-cyan-50 placeholder:text-cyan-100/25";

function StatusLine({
  connected,
  children,
}: {
  connected: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-cyan-100/50">
      <span
        className={`size-2 rounded-full ${
          connected
            ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.65)]"
            : "bg-amber-400"
        }`}
      />
      {children}
    </div>
  );
}

function ChatAgentAccessToggle({
  checked,
  onCheckedChange,
  unavailableReason,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  unavailableReason?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-cyan-400/12 bg-cyan-950/20 px-3.5 py-3">
      <div>
        <Label className="text-sm text-cyan-50">Chat Agent access</Label>
        <p className="mt-0.5 text-xs text-cyan-100/40">
          {checked
            ? unavailableReason
              ? `Enabled, but unavailable: ${unavailableReason}`
              : "Enabled — Chat Agent may use this plugin when relevant."
            : "Disabled — Chat Agent cannot use this plugin."}
        </p>
      </div>
      <Switch
        aria-label="Allow Chat Agent to use this plugin"
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

export function ResearchPluginSettings({
  plugin,
}: {
  plugin: ResearchPluginId;
}) {
  const { settings, updateSettings } = useSettings();
  const [testing, setTesting] = useState(false);
  const plugins = settings?.researchPlugins ?? {};
  const config =
    plugin === "travel-search"
      ? plugins.travelSearch
      : plugin === "duckduckgo"
        ? plugins.duckDuckGo
        : plugin === "coingecko"
          ? plugins.coinGecko
          : plugin === "weather"
            ? plugins.weather
            : plugin === "maps"
              ? plugins.maps
              : plugin === "amadeus"
                ? plugins.amadeus
                : plugin === "duffel"
                  ? plugins.duffel
                  : plugins.skyscanner;

  const patchPlugins = (patch: Partial<ResearchPlugins>) =>
    updateSettings({
      researchPlugins: {
        ...plugins,
        ...patch,
      },
    });

  const test = async () => {
    setTesting(true);
    try {
      const result = await ipc.settings.testResearchPlugin({
        plugin,
        settings: { researchPlugins: plugins },
      });
      showSuccess(result.message);
    } catch (error) {
      showError(error instanceof Error ? error.message : "Connection failed");
    } finally {
      setTesting(false);
    }
  };

  if (plugin === "travel-search") {
    const travelSearch = plugins.travelSearch ?? {
      enabled: true,
      market: "AU",
      locale: "en-AU",
      currency: "AUD",
    };
    const enabled = travelSearch.enabled !== false;
    return (
      <div className="space-y-4 pb-1">
        <div>
          <StatusLine connected={enabled}>
            {enabled ? "Ready · no API key required" : "Disabled"}
          </StatusLine>
          <p className="mt-2 max-w-2xl text-sm text-cyan-100/45">
            Creates flight-search cards from Chat Agent and opens current
            results on Skyscanner. Prices stay on Skyscanner, so no partner key
            or scraping is required.
          </p>
        </div>
        <ChatAgentAccessToggle
          checked={enabled}
          onCheckedChange={(checked) =>
            void patchPlugins({
              travelSearch: { ...travelSearch, enabled: checked },
            })
          }
        />
        <div className="grid grid-cols-3 gap-3">
          {(
            [
              ["Market", "market", "AU"],
              ["Locale", "locale", "en-AU"],
              ["Currency", "currency", "AUD"],
            ] as const
          ).map(([label, field, placeholder]) => (
            <div key={field} className="space-y-2">
              <Label htmlFor={`travel-search-${field}`}>{label}</Label>
              <Input
                id={`travel-search-${field}`}
                value={travelSearch[field] ?? ""}
                placeholder={placeholder}
                className={controlClass}
                onChange={(event) =>
                  void patchPlugins({
                    travelSearch: {
                      ...travelSearch,
                      [field]: event.target.value,
                    },
                  })
                }
              />
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!enabled || testing}
          onClick={() => void test()}
        >
          {testing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Search className="size-4" />
          )}
          Test travel search
        </Button>
      </div>
    );
  }

  if (plugin === "duckduckgo") {
    const enabled = config?.enabled !== false;
    return (
      <div className="space-y-4 pb-1">
        <div>
          <StatusLine connected={enabled}>
            {enabled ? "Ready · no API key required" : "Disabled"}
          </StatusLine>
          <p className="mt-2 max-w-2xl text-sm text-cyan-100/45">
            Gives Chat Agent keyless DuckDuckGo Instant Answers and linked
            sources. It does not scrape or pretend to provide a complete web
            search index.
          </p>
        </div>
        <ChatAgentAccessToggle
          checked={enabled}
          onCheckedChange={(checked) =>
            void patchPlugins({
              duckDuckGo: { ...plugins.duckDuckGo, enabled: checked },
            })
          }
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!enabled || testing}
            onClick={() => void test()}
          >
            {testing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Search className="size-4" />
            )}
            Test search
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              void ipc.system.openExternalUrl(
                "https://duckduckgo.com/duckduckgo-help-pages/features/instant-answers-and-other-features",
              )
            }
          >
            About Instant Answers <ExternalLink className="size-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  if (plugin === "coingecko") {
    const coinGecko = plugins.coinGecko ?? {
      enabled: true,
      plan: "public" as const,
    };
    const enabled = coinGecko.enabled !== false;
    const plan = coinGecko.plan ?? "public";
    return (
      <div className="space-y-4 pb-1">
        <div>
          <StatusLine connected={enabled}>
            {enabled
              ? plan === "public"
                ? "Ready · keyless public access"
                : `${plan === "pro" ? "Pro" : "Demo"} API configured`
              : "Disabled"}
          </StatusLine>
          <p className="mt-2 text-sm text-cyan-100/45">
            Adds live crypto prices, market cap, volume and 24-hour movement to
            Chat Agent.
          </p>
        </div>
        <ChatAgentAccessToggle
          checked={enabled}
          onCheckedChange={(checked) =>
            void patchPlugins({
              coinGecko: { ...coinGecko, enabled: checked },
            })
          }
        />
        <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
          <div className="space-y-2">
            <Label>Access tier</Label>
            <Select
              value={plan}
              onValueChange={(value) =>
                void patchPlugins({
                  coinGecko: {
                    ...coinGecko,
                    plan: value as "public" | "demo" | "pro",
                  },
                })
              }
            >
              <SelectTrigger className={controlClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">Public · no key</SelectItem>
                <SelectItem value="demo">Demo API</SelectItem>
                <SelectItem value="pro">Pro API</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {plan !== "public" && (
            <div className="space-y-2">
              <Label htmlFor="coingecko-api-key">API key</Label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-2.5 size-4 text-cyan-100/30" />
                <Input
                  id="coingecko-api-key"
                  type="password"
                  autoComplete="off"
                  value={coinGecko.apiKey?.value ?? ""}
                  placeholder="Enter CoinGecko API key"
                  className={`${controlClass} pl-9`}
                  onChange={(event) =>
                    void patchPlugins({
                      coinGecko: {
                        ...coinGecko,
                        apiKey: event.target.value
                          ? { value: event.target.value }
                          : undefined,
                      },
                    })
                  }
                />
              </div>
            </div>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!enabled || testing}
          onClick={() => void test()}
        >
          {testing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <CheckCircle2 className="size-4" />
          )}
          Test market data
        </Button>
      </div>
    );
  }

  if (plugin === "weather") {
    const weather = plugins.weather ?? {
      enabled: true,
      temperatureUnit: "celsius" as const,
      windSpeedUnit: "kmh" as const,
      forecastDays: 7,
    };
    const enabled = weather.enabled !== false;
    return (
      <div className="space-y-4 pb-1">
        <div>
          <StatusLine connected={enabled}>
            {enabled ? "Ready · no API key required" : "Disabled"}
          </StatusLine>
          <p className="mt-2 max-w-2xl text-sm text-cyan-100/45">
            Gives Chat Agent current conditions and daily forecasts from
            Open-Meteo, rendered as native weather cards.
          </p>
        </div>
        <ChatAgentAccessToggle
          checked={enabled}
          onCheckedChange={(checked) =>
            void patchPlugins({
              weather: { ...weather, enabled: checked },
            })
          }
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>Temperature</Label>
            <Select
              value={weather.temperatureUnit ?? "celsius"}
              onValueChange={(value) =>
                void patchPlugins({
                  weather: {
                    ...weather,
                    temperatureUnit: value as "celsius" | "fahrenheit",
                  },
                })
              }
            >
              <SelectTrigger className={controlClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="celsius">Celsius · °C</SelectItem>
                <SelectItem value="fahrenheit">Fahrenheit · °F</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Wind speed</Label>
            <Select
              value={weather.windSpeedUnit ?? "kmh"}
              onValueChange={(value) =>
                void patchPlugins({
                  weather: {
                    ...weather,
                    windSpeedUnit: value as "kmh" | "mph",
                  },
                })
              }
            >
              <SelectTrigger className={controlClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="kmh">Kilometres/hour</SelectItem>
                <SelectItem value="mph">Miles/hour</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Forecast length</Label>
            <Select
              value={String(weather.forecastDays ?? 7)}
              onValueChange={(value) =>
                void patchPlugins({
                  weather: {
                    ...weather,
                    forecastDays: Number(value),
                  },
                })
              }
            >
              <SelectTrigger className={controlClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3">3 days</SelectItem>
                <SelectItem value="5">5 days</SelectItem>
                <SelectItem value="7">7 days</SelectItem>
                <SelectItem value="10">10 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!enabled || testing}
          onClick={() => void test()}
        >
          {testing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <CheckCircle2 className="size-4" />
          )}
          Test weather
        </Button>
      </div>
    );
  }

  if (plugin === "maps") {
    const maps = plugins.maps ?? {
      enabled: true,
      style: "dark" as const,
    };
    const enabled = maps.enabled !== false;
    return (
      <div className="space-y-4 pb-1">
        <div>
          <StatusLine connected={enabled}>
            {enabled ? "Ready · no API key required" : "Disabled"}
          </StatusLine>
          <p className="mt-2 max-w-2xl text-sm text-cyan-100/45">
            Lets Chat Agent find cities and places, then renders the result on
            an interactive MapLibre map using OpenFreeMap tiles.
          </p>
        </div>
        <ChatAgentAccessToggle
          checked={enabled}
          onCheckedChange={(checked) =>
            void patchPlugins({ maps: { ...maps, enabled: checked } })
          }
        />
        <div className="max-w-xs space-y-2">
          <Label>Map style</Label>
          <Select
            value={maps.style ?? "dark"}
            onValueChange={(value) =>
              void patchPlugins({
                maps: {
                  ...maps,
                  style: value as "dark" | "liberty" | "positron",
                },
              })
            }
          >
            <SelectTrigger className={controlClass}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectItem value="liberty">Liberty</SelectItem>
              <SelectItem value="positron">Positron</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!enabled || testing}
          onClick={() => void test()}
        >
          {testing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <CheckCircle2 className="size-4" />
          )}
          Test place search
        </Button>
      </div>
    );
  }

  if (plugin === "amadeus") {
    const amadeus = plugins.amadeus ?? {
      enabled: false,
      environment: "test" as const,
      currency: "AUD",
    };
    const hasCredentials = Boolean(
      amadeus.apiKey?.value?.trim() && amadeus.apiSecret?.value?.trim(),
    );
    return (
      <div className="space-y-4 pb-1">
        <div>
          <StatusLine connected={amadeus.enabled === true && hasCredentials}>
            {!amadeus.enabled
              ? "Disabled"
              : hasCredentials
                ? `${amadeus.environment === "production" ? "Production" : "Test"} API ready`
                : "Enabled · API key and secret required"}
          </StatusLine>
          <p className="mt-2 max-w-2xl text-sm text-cyan-100/45">
            Searches structured Amadeus Flight Offers. New accounts receive a
            free monthly request quota; test data has limited coverage.
          </p>
        </div>
        <ChatAgentAccessToggle
          checked={amadeus.enabled === true}
          unavailableReason={
            hasCredentials ? undefined : "enter an API key and secret below"
          }
          onCheckedChange={(checked) =>
            void patchPlugins({
              amadeus: { ...amadeus, enabled: checked },
            })
          }
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="amadeus-api-key">API key</Label>
            <Input
              id="amadeus-api-key"
              type="password"
              autoComplete="off"
              value={amadeus.apiKey?.value ?? ""}
              placeholder="Amadeus API key"
              className={controlClass}
              onChange={(event) =>
                void patchPlugins({
                  amadeus: {
                    ...amadeus,
                    apiKey: event.target.value
                      ? { value: event.target.value }
                      : undefined,
                  },
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="amadeus-api-secret">API secret</Label>
            <Input
              id="amadeus-api-secret"
              type="password"
              autoComplete="off"
              value={amadeus.apiSecret?.value ?? ""}
              placeholder="Amadeus API secret"
              className={controlClass}
              onChange={(event) =>
                void patchPlugins({
                  amadeus: {
                    ...amadeus,
                    apiSecret: event.target.value
                      ? { value: event.target.value }
                      : undefined,
                  },
                })
              }
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-[220px_160px]">
          <div className="space-y-2">
            <Label>Environment</Label>
            <Select
              value={amadeus.environment ?? "test"}
              onValueChange={(value) =>
                void patchPlugins({
                  amadeus: {
                    ...amadeus,
                    environment: value as "test" | "production",
                  },
                })
              }
            >
              <SelectTrigger className={controlClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="test">Test · free quota</SelectItem>
                <SelectItem value="production">Production</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="amadeus-currency">Currency</Label>
            <Input
              id="amadeus-currency"
              value={amadeus.currency ?? ""}
              placeholder="AUD"
              className={controlClass}
              onChange={(event) =>
                void patchPlugins({
                  amadeus: { ...amadeus, currency: event.target.value },
                })
              }
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasCredentials || testing}
            onClick={() => void test()}
          >
            {testing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            Test credentials
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              void ipc.system.openExternalUrl(
                "https://developers.amadeus.com/register",
              )
            }
          >
            Get free credentials <ExternalLink className="size-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  if (plugin === "duffel") {
    const duffel = plugins.duffel ?? { enabled: false };
    const hasToken = Boolean(duffel.accessToken?.value?.trim());
    return (
      <div className="space-y-4 pb-1">
        <div>
          <StatusLine connected={duffel.enabled === true && hasToken}>
            {!duffel.enabled
              ? "Disabled"
              : hasToken
                ? "Sandbox ready"
                : "Enabled · test token required"}
          </StatusLine>
          <p className="mt-2 max-w-2xl text-sm text-cyan-100/45">
            Uses Duffel test mode for integration development. Results are
            simulated and must never be presented as real bookable fares.
          </p>
        </div>
        <ChatAgentAccessToggle
          checked={duffel.enabled === true}
          unavailableReason={
            hasToken ? undefined : "enter a Duffel test token below"
          }
          onCheckedChange={(checked) =>
            void patchPlugins({ duffel: { ...duffel, enabled: checked } })
          }
        />
        <div className="space-y-2">
          <Label htmlFor="duffel-test-token">Sandbox access token</Label>
          <Input
            id="duffel-test-token"
            type="password"
            autoComplete="off"
            value={duffel.accessToken?.value ?? ""}
            placeholder="duffel_test_…"
            className={controlClass}
            onChange={(event) =>
              void patchPlugins({
                duffel: {
                  ...duffel,
                  accessToken: event.target.value
                    ? { value: event.target.value }
                    : undefined,
                },
              })
            }
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasToken || testing}
            onClick={() => void test()}
          >
            {testing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            Test sandbox
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              void ipc.system.openExternalUrl("https://app.duffel.com/join")
            }
          >
            Create Duffel account <ExternalLink className="size-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  const skyscanner = plugins.skyscanner ?? {
    enabled: false,
    market: "AU",
    locale: "en-AU",
    currency: "AUD",
  };
  const hasKey = Boolean(skyscanner.apiKey?.value?.trim());
  return (
    <div className="space-y-4 pb-1">
      <div>
        <StatusLine connected={skyscanner.enabled === true && hasKey}>
          {!skyscanner.enabled
            ? "Disabled"
            : hasKey
              ? "Ready"
              : "Enabled · partner API key required"}
        </StatusLine>
        <p className="mt-2 max-w-2xl text-sm text-cyan-100/45">
          Searches Skyscanner Live Prices from Chat Agent. Skyscanner issues
          keys only to approved Travel API partners.
        </p>
      </div>
      <ChatAgentAccessToggle
        checked={skyscanner.enabled === true}
        unavailableReason={
          !hasKey ? "enter a Skyscanner partner API key below" : undefined
        }
        onCheckedChange={(checked) =>
          void patchPlugins({
            skyscanner: { ...skyscanner, enabled: checked },
          })
        }
      />
      <div className="space-y-2">
        <Label htmlFor="skyscanner-api-key">Partner API key</Label>
        <Input
          id="skyscanner-api-key"
          type="password"
          autoComplete="off"
          value={skyscanner.apiKey?.value ?? ""}
          placeholder="Enter x-api-key"
          className={controlClass}
          onChange={(event) =>
            void patchPlugins({
              skyscanner: {
                ...skyscanner,
                apiKey: event.target.value
                  ? { value: event.target.value }
                  : undefined,
              },
            })
          }
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        {(
          [
            ["Market", "market", "AU"],
            ["Locale", "locale", "en-AU"],
            ["Currency", "currency", "AUD"],
          ] as const
        ).map(([label, field, placeholder]) => (
          <div key={field} className="space-y-2">
            <Label htmlFor={`skyscanner-${field}`}>{label}</Label>
            <Input
              id={`skyscanner-${field}`}
              value={skyscanner[field] ?? ""}
              placeholder={placeholder}
              className={controlClass}
              onChange={(event) =>
                void patchPlugins({
                  skyscanner: {
                    ...skyscanner,
                    [field]: event.target.value,
                  },
                })
              }
            />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!hasKey || testing}
          onClick={() => void test()}
        >
          {testing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <CheckCircle2 className="size-4" />
          )}
          Test connection
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            void ipc.system.openExternalUrl(
              "https://www.partners.skyscanner.net/product/travel-api",
            )
          }
        >
          Apply for access <ExternalLink className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

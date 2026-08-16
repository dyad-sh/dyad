import { useEffect, useState } from "react";
import {
  AlertCircle,
  AudioLines,
  Bot,
  Brain,
  CheckCircle2,
  CircleOff,
  KeyRound,
  Loader2,
  Mic,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useSettings } from "@/hooks/useSettings";
import { useSettingsDraftContext } from "@/contexts/SettingsDraftContext";
import { MicrophoneTester } from "./MicrophoneTester";
import { SECTION_IDS, SETTING_IDS } from "@/lib/settingsSearchIndex";
import type { JarvisSettings as JarvisSettingsValue } from "@/lib/schemas";
import { jarvisClient } from "@/ipc/types/jarvis";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";

const cardClass =
  "rounded-xl border border-cyan-500/15 bg-[rgba(8,18,36,0.72)] p-6 shadow-[0_0_24px_rgba(0,229,255,0.06)] backdrop-blur-md";
const headingClass =
  "font-jarvis-ui text-sm font-medium uppercase tracking-widest text-cyan-300/70";
const rowClass =
  "flex items-center justify-between gap-4 rounded-xl border border-cyan-400/15 bg-slate-950/35 px-4 py-3";

export function getElevenLabsConnectionStatus({
  hasKey,
  isFetching,
  isError,
  hasResponse,
  voiceCount,
}: {
  hasKey: boolean;
  isFetching: boolean;
  isError: boolean;
  hasResponse: boolean;
  voiceCount: number;
}) {
  if (!hasKey) {
    return {
      state: "not-configured" as const,
      label: "Not configured",
      description: "Add an API key to connect",
    };
  }
  if (isFetching && !hasResponse) {
    return {
      state: "checking" as const,
      label: "Checking",
      description: "Contacting ElevenLabs",
    };
  }
  if (isError) {
    return {
      state: "error" as const,
      label: "Needs attention",
      description: "Could not connect to ElevenLabs",
    };
  }
  if (hasResponse) {
    return {
      state: "connected" as const,
      label: "Connected",
      description: `${voiceCount} ${voiceCount === 1 ? "voice" : "voices"} available`,
    };
  }
  return {
    state: "checking" as const,
    label: "Checking",
    description: "Waiting to verify the connection",
  };
}

export function getElevenLabsConnectionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^DyadError:\s*/i, "")
    .trim();
}

function ToggleRow({
  title,
  description,
  checked,
  onCheckedChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
}) {
  const id = `jarvis-toggle-${title.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div className={rowClass}>
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm font-medium text-cyan-50">
          {title}
        </Label>
        <p className="mt-1 text-xs leading-5 text-cyan-100/45">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function SliderRow({
  title,
  description,
  value,
  min,
  max,
  step,
  onChange,
}: {
  title: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const id = `jarvis-slider-${title.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div className={rowClass}>
      <div className="min-w-0 flex-1">
        <Label htmlFor={id} className="text-sm font-medium text-cyan-50">
          {title}
        </Label>
        <p className="mt-1 text-xs leading-5 text-cyan-100/45">{description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-32 accent-cyan-400"
        />
        <span className="w-10 text-right font-mono text-xs text-cyan-200/70">
          {value.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

export function JarvisSettings() {
  const { settings, updateSettings } = useSettings();
  // Null outside the Settings page; inside it, writes are staged in a draft
  // until the tab is saved.
  const draft = useSettingsDraftContext();
  const jarvis = settings?.jarvis;

  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const hasStoredKey = !!jarvis?.elevenLabsApiKey?.value;
  const voicesQuery = useQuery({
    queryKey: queryKeys.jarvis.voices,
    queryFn: () => jarvisClient.listVoices(undefined),
    enabled: hasStoredKey,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const voices = voicesQuery.data?.voices ?? [];
  const connectionStatus = getElevenLabsConnectionStatus({
    hasKey: hasStoredKey,
    isFetching: voicesQuery.isFetching,
    isError: voicesQuery.isError,
    hasResponse: voicesQuery.data !== undefined,
    voiceCount: voices.length,
  });

  useEffect(() => {
    setApiKeySaved(false);
  }, [hasStoredKey]);

  // Send only what changed. Spreading the whole object would let a stale
  // draft overwrite fields saved elsewhere — that is how the API key was lost.
  const patch = (changes: Partial<JarvisSettingsValue>) => {
    void updateSettings({ jarvis: changes });
  };

  /**
   * The API key has its own Save button, so persist it straight away instead
   * of leaving it staged behind the tab's save bar.
   */
  const patchNow = async (changes: Partial<JarvisSettingsValue>) => {
    if (draft) {
      await draft.saveTabPatch("jarvis", { jarvis: changes });
      return;
    }
    await updateSettings({ jarvis: changes });
  };

  const saveApiKey = async () => {
    const trimmed = apiKeyDraft.trim();
    if (!trimmed) return;
    // The key is encrypted by the main process before it reaches disk.
    await patchNow({ elevenLabsApiKey: { value: trimmed } });
    setApiKeyDraft("");
    setApiKeySaved(true);
    void voicesQuery.refetch();
  };

  const clearApiKey = () => {
    void patchNow({ elevenLabsApiKey: undefined });
    setApiKeyDraft("");
    setApiKeySaved(false);
  };

  return (
    <section id={SECTION_IDS.jarvis} className="scroll-mt-24 space-y-6">
      {/* General */}
      <div className={cardClass}>
        <div className="mb-5 flex items-center gap-2">
          <AudioLines className="size-4 text-cyan-300/70" />
          <h2 className={headingClass}>Meta Human OS</h2>
        </div>
        <p className="mb-5 text-sm text-cyan-100/45">
          A continuous, interruptible voice conversation. ElevenLabs handles
          speech only — every response is generated by the models you have
          connected in this app.
        </p>

        <div className="space-y-3">
          <ToggleRow
            title="Start listening when opened"
            description="Open the microphone as soon as the Meta Human OS workspace appears."
            checked={jarvis?.startListeningOnOpen ?? true}
            onCheckedChange={(value) => patch({ startListeningOnOpen: value })}
          />
          <ToggleRow
            title="Continue listening after a response"
            description="Stay in the conversation instead of stopping after each answer."
            checked={jarvis?.continueListeningAfterResponse ?? true}
            onCheckedChange={(value) =>
              patch({ continueListeningAfterResponse: value })
            }
          />
          <ToggleRow
            title="Show Activity panel"
            description="Display the live timeline of models, tools and outcomes."
            checked={jarvis?.showActivityPanel ?? true}
            onCheckedChange={(value) => patch({ showActivityPanel: value })}
          />
          <ToggleRow
            title="Play interface sounds"
            description="A short chime when a session activates."
            checked={jarvis?.playInterfaceSounds ?? true}
            onCheckedChange={(value) => patch({ playInterfaceSounds: value })}
          />

          <div className={rowClass}>
            <div className="min-w-0 flex-1">
              <Label
                htmlFor="jarvis-greeting"
                className="text-sm font-medium text-cyan-50"
              >
                Activation greeting
              </Label>
              <p className="mt-1 text-xs leading-5 text-cyan-100/45">
                Spoken when the session opens.
              </p>
            </div>
            <Input
              id="jarvis-greeting"
              value={jarvis?.greeting ?? ""}
              placeholder="Meta Human OS online. How can I assist?"
              onChange={(event) => patch({ greeting: event.target.value })}
              className="w-64 shrink-0"
            />
          </div>

          <div className={rowClass}>
            <div className="min-w-0 flex-1">
              <Label
                htmlFor="jarvis-timeout"
                className="text-sm font-medium text-cyan-50"
              >
                Inactivity timeout
              </Label>
              <p className="mt-1 text-xs leading-5 text-cyan-100/45">
                Seconds of silence before the session closes. 0 disables it.
              </p>
            </div>
            <Input
              id="jarvis-timeout"
              type="number"
              min={0}
              value={jarvis?.inactivityTimeoutSeconds ?? 300}
              onChange={(event) =>
                patch({
                  inactivityTimeoutSeconds: Number(event.target.value),
                })
              }
              className="w-24 shrink-0"
            />
          </div>
        </div>
      </div>

      {/* Credentials */}
      <div className={cardClass}>
        <div className="mb-5 flex items-center gap-2">
          <KeyRound className="size-4 text-cyan-300/70" />
          <h2 className={headingClass}>ElevenLabs</h2>
          <div
            className={cn(
              "ml-auto flex items-center gap-2 rounded-full border px-3 py-1.5",
              connectionStatus.state === "connected" &&
                "border-emerald-400/25 bg-emerald-400/8 text-emerald-200",
              connectionStatus.state === "checking" &&
                "border-cyan-400/25 bg-cyan-400/8 text-cyan-200",
              connectionStatus.state === "error" &&
                "border-rose-400/25 bg-rose-400/8 text-rose-200",
              connectionStatus.state === "not-configured" &&
                "border-slate-400/20 bg-slate-400/5 text-slate-300/70",
            )}
            title={connectionStatus.description}
            data-testid="elevenlabs-connection-status"
            data-state={connectionStatus.state}
          >
            {connectionStatus.state === "connected" ? (
              <CheckCircle2 className="size-3.5" />
            ) : connectionStatus.state === "checking" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : connectionStatus.state === "error" ? (
              <AlertCircle className="size-3.5" />
            ) : (
              <CircleOff className="size-3.5" />
            )}
            <span className="text-[11px] font-medium tracking-wide uppercase">
              {connectionStatus.label}
            </span>
          </div>
        </div>

        <div className={rowClass}>
          <div className="min-w-0 flex-1">
            <Label
              htmlFor="jarvis-api-key"
              className="text-sm font-medium text-cyan-50"
            >
              API key
            </Label>
            <p className="mt-1 text-xs leading-5 text-cyan-100/45">
              {hasStoredKey
                ? "A key is saved and encrypted with your OS credential store."
                : "Required for speech input and voice output. Enable Voices and Text to Speech permissions on restricted keys."}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Input
              id="jarvis-api-key"
              type="password"
              value={apiKeyDraft}
              placeholder={hasStoredKey ? "••••••••••••" : "xi-..."}
              onChange={(event) => setApiKeyDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveApiKey();
              }}
              className="w-56"
            />
            <button
              type="button"
              onClick={() => void saveApiKey()}
              disabled={!apiKeyDraft.trim()}
              className="rounded-lg border border-cyan-400/25 px-3 py-2 text-xs text-cyan-100 hover:bg-cyan-400/10 disabled:opacity-40"
            >
              {apiKeySaved ? "Saved" : "Save"}
            </button>
            {hasStoredKey && (
              <button
                type="button"
                onClick={clearApiKey}
                className="rounded-lg border border-rose-400/25 px-3 py-2 text-xs text-rose-200/80 hover:bg-rose-400/10"
              >
                Remove
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 space-y-3">
          <div id={SETTING_IDS.jarvisChatReadAloud} className={rowClass}>
            <div className="min-w-0 flex-1">
              <Label
                htmlFor="jarvis-chat-read-aloud-provider"
                className="text-sm font-medium text-cyan-50"
              >
                Chat read-aloud provider
              </Label>
              <p className="mt-1 text-xs leading-5 text-cyan-100/45">
                Voice used by the audio button on AI-generated chat messages.
              </p>
            </div>
            <select
              id="jarvis-chat-read-aloud-provider"
              value={jarvis?.chatReadAloudProvider ?? "system"}
              onChange={(event) =>
                patch({
                  chatReadAloudProvider: event.target
                    .value as JarvisSettingsValue["chatReadAloudProvider"],
                })
              }
              className="h-10 w-64 shrink-0 rounded-lg border border-cyan-400/20 bg-slate-950/70 px-3 text-sm text-cyan-50 outline-none focus:border-cyan-300/60"
            >
              <option value="system">System voice</option>
              <option value="elevenlabs">ElevenLabs</option>
            </select>
          </div>

          <div className={rowClass}>
            <div className="min-w-0 flex-1">
              <Label
                htmlFor="jarvis-voice-id"
                className="text-sm font-medium text-cyan-50"
              >
                Voice ID
              </Label>
              <p className="mt-1 text-xs leading-5 text-cyan-100/45">
                The ElevenLabs voice used for live replies and chat read-aloud.
              </p>
            </div>
            <div className="flex w-64 shrink-0 items-center gap-2">
              {voices.length > 0 ? (
                <select
                  id="jarvis-voice-id"
                  value={jarvis?.voiceId ?? ""}
                  onChange={(event) => patch({ voiceId: event.target.value })}
                  className="h-10 min-w-0 flex-1 rounded-lg border border-cyan-400/20 bg-slate-950/70 px-3 text-sm text-cyan-50 outline-none focus:border-cyan-300/60"
                >
                  <option value="">Rachel (default)</option>
                  {jarvis?.voiceId &&
                    !voices.some(
                      (voice) => voice.voiceId === jarvis.voiceId,
                    ) && (
                      <option value={jarvis.voiceId}>
                        Custom voice ({jarvis.voiceId})
                      </option>
                    )}
                  {voices.map((voice) => (
                    <option key={voice.voiceId} value={voice.voiceId}>
                      {voice.name}
                      {voice.category ? ` · ${voice.category}` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id="jarvis-voice-id"
                  value={jarvis?.voiceId ?? ""}
                  placeholder="21m00Tcm4TlvDq8ikWAM"
                  onChange={(event) => patch({ voiceId: event.target.value })}
                  className="min-w-0 flex-1"
                />
              )}
              <button
                type="button"
                title="Refresh ElevenLabs voices"
                aria-label="Refresh ElevenLabs voices"
                disabled={!hasStoredKey || voicesQuery.isFetching}
                onClick={() => void voicesQuery.refetch()}
                className="grid size-10 shrink-0 place-items-center rounded-lg border border-cyan-400/20 text-cyan-200/70 hover:bg-cyan-400/10 disabled:opacity-40"
              >
                {voicesQuery.isFetching ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
              </button>
            </div>
          </div>
          {hasStoredKey && voicesQuery.isError && (
            <div
              className="rounded-lg border border-rose-400/20 bg-rose-400/6 px-4 py-3"
              role="alert"
            >
              <p className="text-xs font-medium text-rose-100">
                ElevenLabs connection failed
              </p>
              <p className="mt-1 text-xs leading-5 text-rose-100/70">
                {getElevenLabsConnectionError(voicesQuery.error)}
              </p>
              <p className="mt-1 text-[11px] leading-5 text-rose-100/45">
                In ElevenLabs, open Developers → API Keys and enable Voices and
                Text to Speech. Also check expiry, credit limits, and IP
                restrictions.
              </p>
            </div>
          )}

          <div className={rowClass}>
            <div className="min-w-0 flex-1">
              <Label
                htmlFor="jarvis-tts-model"
                className="text-sm font-medium text-cyan-50"
              >
                Text-to-speech model
              </Label>
              <p className="mt-1 text-xs leading-5 text-cyan-100/45">
                Low-latency models keep spoken replies responsive.
              </p>
            </div>
            <Input
              id="jarvis-tts-model"
              value={jarvis?.ttsModelId ?? ""}
              placeholder="eleven_turbo_v2_5"
              onChange={(event) => patch({ ttsModelId: event.target.value })}
              className="w-64 shrink-0"
            />
          </div>

          <div className={rowClass}>
            <div className="min-w-0 flex-1">
              <Label
                htmlFor="jarvis-stt-model"
                className="text-sm font-medium text-cyan-50"
              >
                Speech-to-text model
              </Label>
              <p className="mt-1 text-xs leading-5 text-cyan-100/45">
                Realtime transcription model.
              </p>
            </div>
            <Input
              id="jarvis-stt-model"
              value={jarvis?.sttModelId ?? ""}
              placeholder="scribe_v2_realtime"
              onChange={(event) => patch({ sttModelId: event.target.value })}
              className="w-64 shrink-0"
            />
          </div>

          <SliderRow
            title="Stability"
            description="Lower is more expressive, higher is more consistent."
            value={jarvis?.stability ?? 0.5}
            min={0}
            max={1}
            step={0.05}
            onChange={(value) => patch({ stability: value })}
          />
          <SliderRow
            title="Similarity"
            description="How closely output matches the selected voice."
            value={jarvis?.similarityBoost ?? 0.75}
            min={0}
            max={1}
            step={0.05}
            onChange={(value) => patch({ similarityBoost: value })}
          />
          <SliderRow
            title="Speed"
            description="Speaking rate for voice output."
            value={jarvis?.speed ?? 1}
            min={0.7}
            max={1.2}
            step={0.05}
            onChange={(value) => patch({ speed: value })}
          />
        </div>
      </div>

      {/* Voice input */}
      <div className={cardClass}>
        <div className="mb-5 flex items-center gap-2">
          <Mic className="size-4 text-cyan-300/70" />
          <h2 className={headingClass}>Voice Input</h2>
        </div>
        <div className="space-y-3">
          <MicrophoneTester
            deviceId={jarvis?.inputDeviceId}
            onDeviceChange={(inputDeviceId) => patchNow({ inputDeviceId })}
          />
          <ToggleRow
            title="Automatic language detection"
            description="Detect the spoken language instead of forcing one."
            checked={jarvis?.autoDetectLanguage ?? true}
            onCheckedChange={(value) => patch({ autoDetectLanguage: value })}
          />
          <ToggleRow
            title="Echo cancellation"
            description="Off by default: on some Macs this silences the microphone entirely."
            checked={jarvis?.echoCancellation ?? false}
            onCheckedChange={(value) => patch({ echoCancellation: value })}
          />
          <ToggleRow
            title="Noise suppression"
            description="Filter steady background noise from the microphone."
            checked={jarvis?.noiseSuppression ?? false}
            onCheckedChange={(value) => patch({ noiseSuppression: value })}
          />
          <ToggleRow
            title="Allow interruptions"
            description="Speaking over Meta Human OS stops playback and starts a new turn."
            checked={jarvis?.allowInterruptions ?? true}
            onCheckedChange={(value) => patch({ allowInterruptions: value })}
          />
          <SliderRow
            title="Voice activity sensitivity"
            description="Lower values pick up quieter speech but trigger more often."
            value={jarvis?.vadSensitivity ?? 0.02}
            min={0.005}
            max={0.15}
            step={0.005}
            onChange={(value) => patch({ vadSensitivity: value })}
          />

          <div className={rowClass}>
            <div className="min-w-0 flex-1">
              <Label
                htmlFor="jarvis-silence"
                className="text-sm font-medium text-cyan-50"
              >
                Silence timeout
              </Label>
              <p className="mt-1 text-xs leading-5 text-cyan-100/45">
                Milliseconds of silence that end an utterance.
              </p>
            </div>
            <Input
              id="jarvis-silence"
              type="number"
              min={200}
              step={100}
              value={jarvis?.silenceTimeoutMs ?? 700}
              onChange={(event) =>
                patch({ silenceTimeoutMs: Number(event.target.value) })
              }
              className="w-24 shrink-0"
            />
          </div>
        </div>
      </div>

      {/* Intelligence */}
      <div className={cardClass}>
        <div className="mb-5 flex items-center gap-2">
          <Brain className="size-4 text-cyan-300/70" />
          <h2 className={headingClass}>Intelligence</h2>
        </div>
        <p className="mb-4 text-sm text-cyan-100/45">
          Meta Human OS reasons with the models configured in this app.
          ElevenLabs provides the audio pipeline and voice only — never a
          language model.
        </p>

        {jarvis?.brainAgentId && (
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-cyan-400/25 bg-cyan-400/5 px-4 py-3">
            <Bot className="mt-0.5 size-4 shrink-0 text-cyan-300/80" />
            <p className="text-xs leading-5 text-cyan-100/70">
              A Hermes agent is set as the voice brain, so it answers every
              voice turn and the model choice below is not used. Change or clear
              it from the{" "}
              <Link to="/agent-os" className="text-cyan-300 underline">
                Agents
              </Link>{" "}
              page.
            </p>
          </div>
        )}

        <div className={rowClass}>
          <div className="min-w-0 flex-1">
            <Label
              htmlFor="jarvis-voice-engine"
              className="text-sm font-medium text-cyan-50"
            >
              Voice engine
            </Label>
            <p className="mt-1 text-xs leading-5 text-cyan-100/45">
              Realtime is speech-to-speech through OpenAI: lowest latency, with
              turn-taking and interruption handled for you. It needs an OpenAI
              API key and uses an OpenAI model for the conversation itself.
            </p>
          </div>
          <select
            id="jarvis-voice-engine"
            value={jarvis?.voiceEngine ?? "pipeline"}
            onChange={(event) =>
              void patchNow({
                voiceEngine: event.target
                  .value as JarvisSettingsValue["voiceEngine"],
              })
            }
            className="w-48 shrink-0 rounded-lg border border-cyan-400/20 bg-slate-950/60 px-3 py-2 text-sm text-cyan-50"
          >
            <option value="pipeline">ElevenLabs + my models</option>
            <option value="realtime">OpenAI Realtime (fastest)</option>
          </select>
        </div>

        {jarvis?.voiceEngine === "realtime" && (
          <div className={`${rowClass} mt-3`}>
            <div className="min-w-0 flex-1">
              <Label
                htmlFor="jarvis-realtime-voice"
                className="text-sm font-medium text-cyan-50"
              >
                Realtime voice
              </Label>
              <p className="mt-1 text-xs leading-5 text-cyan-100/45">
                The OpenAI voice used for spoken replies.
              </p>
            </div>
            <Input
              id="jarvis-realtime-voice"
              value={jarvis?.realtimeVoice ?? ""}
              placeholder="marin"
              onChange={(event) => patch({ realtimeVoice: event.target.value })}
              className="w-48 shrink-0"
            />
          </div>
        )}

        <div className={`${rowClass} mt-3`}>
          <div className="min-w-0 flex-1">
            <Label
              htmlFor="jarvis-model-mode"
              className="text-sm font-medium text-cyan-50"
            >
              Conversation model
            </Label>
            <p className="mt-1 text-xs leading-5 text-cyan-100/45">
              Automatic routes by request type. Chat model reuses your Chat
              Agent model.
            </p>
          </div>
          <select
            id="jarvis-model-mode"
            value={jarvis?.modelMode ?? "automatic"}
            onChange={(event) =>
              patch({
                modelMode: event.target
                  .value as JarvisSettingsValue["modelMode"],
              })
            }
            disabled={!!jarvis?.brainAgentId}
            className="w-48 shrink-0 rounded-lg border border-cyan-400/20 bg-slate-950/60 px-3 py-2 text-sm text-cyan-50 disabled:opacity-40"
          >
            <option value="automatic">Automatic</option>
            <option value="chat">Use Chat model</option>
            <option value="voice">Use dedicated Voice model</option>
            <option value="custom">Select a specific model</option>
          </select>
        </div>

        <div className="mt-3 space-y-3">
          <ToggleRow
            title="Prefer local models"
            description="Favour LM Studio, Ollama and other local endpoints when routing."
            checked={jarvis?.preferLocalModels ?? false}
            onCheckedChange={(value) => patch({ preferLocalModels: value })}
          />
          <ToggleRow
            title="Local models only"
            description="Never route a voice turn to a cloud provider."
            checked={jarvis?.localModelsOnly ?? false}
            onCheckedChange={(value) => patch({ localModelsOnly: value })}
          />
        </div>
      </div>

      {/* Permissions */}
      <div className={cardClass}>
        <div className="mb-5 flex items-center gap-2">
          <ShieldCheck className="size-4 text-cyan-300/70" />
          <h2 className={headingClass}>Permissions</h2>
        </div>
        <p className="mb-4 text-sm text-cyan-100/45">
          Destructive actions — deleting files or conversations, publishing,
          pushing code, changing account security — always ask first and cannot
          be turned off here.
        </p>

        <div className="space-y-3">
          <ToggleRow
            title="Confirm configuration changes"
            description="Ask before saving settings or switching default models."
            checked={jarvis?.permissions?.files === "confirm"}
            onCheckedChange={(value) =>
              patch({
                permissions: {
                  ...jarvis?.permissions,
                  files: value ? "confirm" : "allow",
                },
              })
            }
          />
          <ToggleRow
            title="Confirm builds and tests"
            description="Ask before starting a build or running a test suite."
            checked={jarvis?.permissions?.builds === "confirm"}
            onCheckedChange={(value) =>
              patch({
                permissions: {
                  ...jarvis?.permissions,
                  builds: value ? "confirm" : "allow",
                },
              })
            }
          />
          <ToggleRow
            title="Confirm paid API usage"
            description="Ask before generating content that consumes paid credits."
            checked={jarvis?.permissions?.externalApis === "confirm"}
            onCheckedChange={(value) =>
              patch({
                permissions: {
                  ...jarvis?.permissions,
                  externalApis: value ? "confirm" : "allow",
                },
              })
            }
          />
          <ToggleRow
            title="Require spoken confirmation"
            description="A clear spoken yes is needed in addition to the on-screen button."
            checked={jarvis?.permissions?.requireSpokenConfirmation ?? false}
            onCheckedChange={(value) =>
              patch({
                permissions: {
                  ...jarvis?.permissions,
                  requireSpokenConfirmation: value,
                },
              })
            }
          />
        </div>
      </div>
    </section>
  );
}

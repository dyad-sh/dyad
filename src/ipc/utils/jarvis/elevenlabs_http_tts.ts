export const DEFAULT_ELEVENLABS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
export const DEFAULT_ELEVENLABS_TTS_MODEL = "eleven_turbo_v2_5";

export type ElevenLabsVoice = {
  voiceId: string;
  name: string;
  category?: string;
  previewUrl?: string | null;
};

export class ElevenLabsHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ElevenLabsHttpError";
  }
}

type Fetcher = typeof fetch;

async function toElevenLabsHttpError(
  response: Response,
  fallbackMessage: string,
): Promise<ElevenLabsHttpError> {
  let code: string | undefined;
  try {
    const body = (await response.json()) as {
      detail?: { status?: unknown; code?: unknown } | string;
      status?: unknown;
      code?: unknown;
    };
    const detail = typeof body.detail === "object" ? body.detail : undefined;
    const candidate =
      detail?.status ?? detail?.code ?? body.status ?? body.code;
    if (typeof candidate === "string") code = candidate;
  } catch {
    // Provider error bodies are not guaranteed to be JSON. Never include the
    // raw body because it may contain account or request details.
  }
  return new ElevenLabsHttpError(response.status, fallbackMessage, code);
}

export async function listElevenLabsVoices(
  apiKey: string,
  fetcher: Fetcher = fetch,
): Promise<ElevenLabsVoice[]> {
  const response = await fetcher(
    // Keep this request deliberately minimal. Some ElevenLabs workspaces have
    // rejected the optional server-side sort parameters with HTTP 400 even
    // though the core v2 voice-library endpoint is available to the key.
    "https://api.elevenlabs.io/v2/voices?page_size=100",
    { headers: { "xi-api-key": apiKey } },
  );
  if (!response.ok) {
    throw await toElevenLabsHttpError(
      response,
      `Could not load ElevenLabs voices (HTTP ${response.status}).`,
    );
  }

  const body = (await response.json()) as {
    voices?: Array<{
      voice_id?: unknown;
      name?: unknown;
      category?: unknown;
      preview_url?: unknown;
    }>;
  };
  return (body.voices ?? [])
    .filter(
      (voice): voice is typeof voice & { voice_id: string; name: string } =>
        typeof voice.voice_id === "string" && typeof voice.name === "string",
    )
    .map((voice) => ({
      voiceId: voice.voice_id,
      name: voice.name,
      ...(typeof voice.category === "string"
        ? { category: voice.category }
        : {}),
      ...(typeof voice.preview_url === "string"
        ? { previewUrl: voice.preview_url }
        : {}),
    }))
    .sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
    );
}

export async function synthesizeElevenLabsSpeech(
  options: {
    apiKey: string;
    voiceId: string;
    modelId: string;
    text: string;
    stability?: number;
    similarityBoost?: number;
    speed?: number;
  },
  fetcher: Fetcher = fetch,
): Promise<{ audioBase64: string; mimeType: string }> {
  const voiceSettings: Record<string, number> = {};
  if (options.stability != null) voiceSettings.stability = options.stability;
  if (options.similarityBoost != null) {
    voiceSettings.similarity_boost = options.similarityBoost;
  }
  if (options.speed != null) voiceSettings.speed = options.speed;

  const response = await fetcher(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(options.voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": options.apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: options.text,
        model_id: options.modelId,
        ...(Object.keys(voiceSettings).length > 0
          ? { voice_settings: voiceSettings }
          : {}),
      }),
    },
  );
  if (!response.ok) {
    throw await toElevenLabsHttpError(
      response,
      `ElevenLabs speech generation failed (HTTP ${response.status}).`,
    );
  }

  return {
    audioBase64: Buffer.from(await response.arrayBuffer()).toString("base64"),
    mimeType:
      response.headers.get("content-type")?.split(";")[0] || "audio/mpeg",
  };
}

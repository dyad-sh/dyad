import log from "electron-log";
import { systemPreferences, type WebContents } from "electron";
import { createTypedHandler } from "./base";
import { jarvisContracts } from "../types/jarvis";
import { JarvisSession } from "../utils/jarvis/jarvis_session";
import { readSettings } from "../../main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  DEFAULT_ELEVENLABS_TTS_MODEL,
  DEFAULT_ELEVENLABS_VOICE_ID,
  ElevenLabsHttpError,
  listElevenLabsVoices,
  synthesizeElevenLabsSpeech,
} from "../utils/jarvis/elevenlabs_http_tts";

const logger = log.scope("jarvis_handlers");

/**
 * Only one primary voice session may exist per application window, so
 * sessions are keyed by the renderer's WebContents id. Starting a session in
 * a window that already has one tears the previous session down first — this
 * is what prevents two live microphone streams after a reconnect.
 */
const sessionsByWindow = new Map<number, JarvisSession>();

function requireElevenLabsSettings() {
  const jarvis = readSettings().jarvis;
  const apiKey = jarvis?.elevenLabsApiKey?.value?.trim();
  if (!apiKey) {
    throw new DyadError(
      "Add an ElevenLabs API key in Settings → Voice Assistant first.",
      DyadErrorKind.Precondition,
    );
  }
  return { jarvis, apiKey };
}

function throwElevenLabsError(error: unknown): never {
  if (error instanceof ElevenLabsHttpError) {
    const kind =
      error.status === 401 || error.status === 403
        ? DyadErrorKind.Auth
        : error.status === 422
          ? DyadErrorKind.Validation
          : error.status === 429
            ? DyadErrorKind.RateLimited
            : DyadErrorKind.External;
    const message =
      error.code === "insufficient_permissions"
        ? "The ElevenLabs API key is valid but lacks permission to read voices. Enable Voices and Text to Speech for this key in ElevenLabs Developers → API Keys."
        : error.status === 401
          ? "ElevenLabs rejected or expired the API key. Create or update it in ElevenLabs Developers → API Keys."
          : error.status === 403
            ? "ElevenLabs blocked this request. Check the key's Voices and Text to Speech permissions and any IP allowlist."
            : error.status === 422
              ? "ElevenLabs could not use that voice or text. Check the selected Voice ID."
              : error.status === 429
                ? "ElevenLabs rate limit or voice quota reached. Try again shortly or check your plan."
                : error.message;
    throw new DyadError(message, kind);
  }
  throw error;
}

export function getActiveJarvisSession(
  sender: WebContents,
): JarvisSession | undefined {
  return sessionsByWindow.get(sender.id);
}

function requireSession(sender: WebContents, sessionId: string): JarvisSession {
  const session = sessionsByWindow.get(sender.id);
  if (!session || session.sessionId !== sessionId) {
    throw new DyadError(
      "No active Meta Human OS session for this window.",
      DyadErrorKind.Precondition,
    );
  }
  return session;
}

/**
 * macOS gates microphone access behind TCC, and an Electron app only gets the
 * system prompt when the main process asks for it — a renderer `getUserMedia`
 * on its own is refused silently. Ask once per session start, and report the
 * outcome so the UI can explain a denial instead of appearing deaf.
 */
async function ensureMicrophoneAccess(): Promise<
  "granted" | "denied" | "unsupported"
> {
  if (process.platform !== "darwin") return "unsupported";
  try {
    const status = systemPreferences.getMediaAccessStatus("microphone");
    // Always report it: a stale "granted" that yields a silent stream looks
    // identical to a healthy one unless the status is stated outright.
    logger.info(`macOS microphone access status: ${status}`);
    if (status === "granted") return "granted";
    if (status === "not-determined") {
      const granted = await systemPreferences.askForMediaAccess("microphone");
      logger.info(`Microphone access prompt returned: ${granted}`);
      return granted ? "granted" : "denied";
    }
    logger.warn(`Microphone access is ${status}; voice input will not work.`);
    return "denied";
  } catch (error) {
    logger.warn("Could not determine microphone access", error);
    return "unsupported";
  }
}

export function registerJarvisHandlers() {
  createTypedHandler(jarvisContracts.startSession, async (event, params) => {
    const windowId = event.sender.id;
    const microphoneAccess = await ensureMicrophoneAccess();
    const existing = sessionsByWindow.get(windowId);
    if (existing) {
      logger.info(
        `Replacing existing Meta Human OS session ${existing.sessionId} in window ${windowId}`,
      );
      existing.stop("Replaced by a new session");
      sessionsByWindow.delete(windowId);
    }

    const session = new JarvisSession({
      sessionId: params.sessionId,
      sender: event.sender,
      mock: params.mock ?? false,
      onEnded: (sessionId) => {
        const current = sessionsByWindow.get(windowId);
        if (current?.sessionId === sessionId) {
          sessionsByWindow.delete(windowId);
        }
      },
    });
    sessionsByWindow.set(windowId, session);

    // Tear the session down if the window goes away mid-conversation.
    event.sender.once("destroyed", () => {
      const current = sessionsByWindow.get(windowId);
      if (current) {
        current.stop("Window closed");
        sessionsByWindow.delete(windowId);
      }
    });

    await session.start();

    const model = session.model;
    return {
      ok: true as const,
      greeting: session.greeting,
      mock: params.mock ?? false,
      model: { provider: model.provider, name: model.name },
      voiceConfigured: session.voiceConfigured,
      microphoneAccess,
      engine: session.usesRealtime
        ? ("realtime" as const)
        : ("pipeline" as const),
      captureSampleRate: session.captureSampleRate,
    };
  });

  createTypedHandler(jarvisContracts.stopSession, async (event, params) => {
    const session = sessionsByWindow.get(event.sender.id);
    if (session && session.sessionId === params.sessionId) {
      session.stop(params.reason ?? "Stopped by user");
      sessionsByWindow.delete(event.sender.id);
    }
    return { ok: true as const };
  });

  createTypedHandler(jarvisContracts.sendAudioChunk, async (event, params) => {
    // Audio chunks arrive continuously; a missing session is a benign race
    // with teardown rather than an error worth throwing on every frame.
    const session = sessionsByWindow.get(event.sender.id);
    if (session?.sessionId === params.sessionId) {
      session.handleAudioChunk(params.chunk);
    }
    return { ok: true as const };
  });

  createTypedHandler(jarvisContracts.speechActivity, async (event, params) => {
    const session = sessionsByWindow.get(event.sender.id);
    if (session?.sessionId === params.sessionId) {
      session.handleSpeechActivity(params.kind);
    }
    return { ok: true as const };
  });

  createTypedHandler(jarvisContracts.sendTextTurn, async (event, params) => {
    requireSession(event.sender, params.sessionId).handleTextTurn(params.text);
    return { ok: true as const };
  });

  createTypedHandler(jarvisContracts.interrupt, async (event, params) => {
    const session = sessionsByWindow.get(event.sender.id);
    if (session?.sessionId === params.sessionId) {
      session.interrupt(params.reason);
    }
    return { ok: true as const };
  });

  createTypedHandler(jarvisContracts.transcribe, async (_, params) => {
    const settings = readSettings();
    const apiKey = settings.jarvis?.elevenLabsApiKey?.value;
    if (!apiKey) {
      throw new DyadError(
        "Add an ElevenLabs API key in Settings → Voice Assistant to use voice input.",
        DyadErrorKind.Precondition,
      );
    }

    const extension = params.mimeType.includes("wav")
      ? "wav"
      : params.mimeType.includes("mp4") || params.mimeType.includes("mpeg")
        ? "mp4"
        : "webm";

    const form = new FormData();
    form.append("model_id", "scribe_v1");
    form.append(
      "file",
      new Blob([Buffer.from(params.audio, "base64")], {
        type: params.mimeType,
      }),
      `speech.${extension}`,
    );

    const response = await fetch(
      "https://api.elevenlabs.io/v1/speech-to-text",
      {
        method: "POST",
        headers: { "xi-api-key": apiKey },
        body: form,
      },
    );

    if (!response.ok) {
      // Never surface the key or the raw provider body.
      throw new DyadError(
        response.status === 401
          ? "ElevenLabs rejected the API key. Update it in Settings → Voice Assistant."
          : `Transcription failed (HTTP ${response.status}).`,
        DyadErrorKind.External,
      );
    }

    const result = (await response.json()) as { text?: string };
    return { text: result.text?.trim() ?? "" };
  });

  createTypedHandler(jarvisContracts.listVoices, async () => {
    const { apiKey } = requireElevenLabsSettings();
    try {
      return { voices: await listElevenLabsVoices(apiKey) };
    } catch (error) {
      throwElevenLabsError(error);
    }
  });

  createTypedHandler(jarvisContracts.synthesizeSpeech, async (_, params) => {
    const { jarvis, apiKey } = requireElevenLabsSettings();
    try {
      const result = await synthesizeElevenLabsSpeech({
        apiKey,
        voiceId: jarvis?.voiceId?.trim() || DEFAULT_ELEVENLABS_VOICE_ID,
        modelId: jarvis?.ttsModelId?.trim() || DEFAULT_ELEVENLABS_TTS_MODEL,
        text: params.text,
        stability: jarvis?.stability,
        similarityBoost: jarvis?.similarityBoost,
        speed: jarvis?.speed,
      });
      return { ...result, provider: "elevenlabs" as const };
    } catch (error) {
      throwElevenLabsError(error);
    }
  });

  createTypedHandler(
    jarvisContracts.respondToConfirmation,
    async (event, params) => {
      requireSession(event.sender, params.sessionId).respondToConfirmation(
        params.requestId,
        params.approved,
      );
      return { ok: true as const };
    },
  );
}

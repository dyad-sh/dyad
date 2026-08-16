import { describe, expect, it, vi } from "vitest";
import {
  ElevenLabsHttpError,
  listElevenLabsVoices,
  synthesizeElevenLabsSpeech,
} from "./elevenlabs_http_tts";

describe("ElevenLabs HTTP text to speech", () => {
  it("maps the signed-in user's voice library", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          voices: [
            {
              voice_id: "voice-2",
              name: "Zulu Voice",
              category: "professional",
            },
            {
              voice_id: "voice-1",
              name: "Studio Voice",
              category: "cloned",
              preview_url: "https://example.com/voice.mp3",
            },
            { voice_id: 123, name: "Invalid" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(listElevenLabsVoices("secret", fetcher)).resolves.toEqual([
      {
        voiceId: "voice-1",
        name: "Studio Voice",
        category: "cloned",
        previewUrl: "https://example.com/voice.mp3",
      },
      {
        voiceId: "voice-2",
        name: "Zulu Voice",
        category: "professional",
      },
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.elevenlabs.io/v2/voices?page_size=100",
      { headers: { "xi-api-key": "secret" } },
    );
  });

  it("sends the configured model and voice controls and returns playable audio", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      }),
    );

    const result = await synthesizeElevenLabsSpeech(
      {
        apiKey: "secret",
        voiceId: "my voice",
        modelId: "eleven_multilingual_v2",
        text: "Read this response",
        stability: 0.4,
        similarityBoost: 0.8,
        speed: 1.1,
      },
      fetcher,
    );

    expect(result).toEqual({ audioBase64: "AQID", mimeType: "audio/mpeg" });
    const [url, request] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/text-to-speech/my%20voice");
    expect(request.headers).toMatchObject({ "xi-api-key": "secret" });
    expect(JSON.parse(String(request.body))).toEqual({
      text: "Read this response",
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.4,
        similarity_boost: 0.8,
        speed: 1.1,
      },
    });
  });

  it("does not expose provider response bodies on failure", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response("sensitive provider response", { status: 401 }),
      );

    await expect(
      synthesizeElevenLabsSpeech(
        {
          apiKey: "secret",
          voiceId: "voice-1",
          modelId: "model-1",
          text: "Hello",
        },
        fetcher,
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ElevenLabsHttpError>>({ status: 401 }),
    );
  });

  it("retains safe ElevenLabs error codes for actionable permission guidance", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: {
            status: "insufficient_permissions",
            message: "private account details that must not be surfaced",
          },
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(listElevenLabsVoices("secret", fetcher)).rejects.toEqual(
      expect.objectContaining<Partial<ElevenLabsHttpError>>({
        status: 403,
        code: "insufficient_permissions",
        message: "Could not load ElevenLabs voices (HTTP 403).",
      }),
    );
  });
});

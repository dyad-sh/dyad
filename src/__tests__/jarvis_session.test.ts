import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UserSettings } from "@/lib/schemas";
import type {
  RealtimeSttSession,
  SttCallbacks,
  StreamingTtsSession,
  TtsCallbacks,
} from "@/ipc/utils/jarvis/voice_providers";

// The session imports Electron-backed modules at load time. None of them are
// exercised here — the session takes injected settings, providers and LLM.
vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp") },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (buffer: Buffer) => buffer.toString(),
  },
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock("../main/settings", () => ({
  readSettings: vi.fn(() => ({}) as UserSettings),
  writeSettings: vi.fn(),
}));

vi.mock("../ipc/utils/get_model_client", () => ({
  getModelClient: vi.fn(),
}));

vi.mock("../ipc/utils/token_utils", () => ({
  getMaxTokens: vi.fn(async () => 2048),
  getTemperature: vi.fn(async () => 0.7),
}));

const { JarvisSession, resolveJarvisModel } =
  await import("@/ipc/utils/jarvis/jarvis_session");

/** Captures every IPC event the session emits. */
function createSender() {
  const events: { channel: string; payload: any }[] = [];
  const sender = {
    id: 1,
    isDestroyed: () => false,
    isCrashed: () => false,
    send: (channel: string, payload: unknown) =>
      events.push({ channel, payload }),
    once: () => {},
  };
  return {
    sender: sender as any,
    events,
    payloads: (channel: string) =>
      events.filter((event) => event.channel === channel).map((e) => e.payload),
    states: () =>
      events
        .filter((event) => event.channel === "jarvis:event:state")
        .map((event) => event.payload.state),
  };
}

/** Controllable STT stand-in that records what audio it received. */
class TestStt implements RealtimeSttSession {
  static latest: TestStt | null = null;
  chunks: Buffer[] = [];
  activity: string[] = [];
  closed = false;

  constructor(readonly callbacks: SttCallbacks) {
    TestStt.latest = this;
  }
  sendAudio(pcm16: Buffer) {
    this.chunks.push(pcm16);
  }
  notifySpeechActivity(kind: "start" | "end") {
    this.activity.push(kind);
  }
  close() {
    this.closed = true;
  }
}

/** Controllable TTS stand-in that records phrases and cancellation. */
class TestTts implements StreamingTtsSession {
  static instances: TestTts[] = [];
  phrases: string[] = [];
  finished = false;
  cancelled = false;

  constructor(readonly callbacks: TtsCallbacks) {
    TestTts.instances.push(this);
  }
  speak(text: string) {
    if (this.cancelled) return;
    this.phrases.push(text);
    this.callbacks.onAudio(Buffer.alloc(320), 24000);
  }
  finish() {
    if (this.cancelled) return;
    this.finished = true;
    this.callbacks.onDone();
  }
  cancel() {
    this.cancelled = true;
  }
}

const baseSettings = (overrides: Partial<UserSettings> = {}) =>
  ({
    selectedModel: { name: "auto", provider: "auto" },
    providerSettings: {},
    selectedTemplateId: "react",
    enableAutoUpdate: true,
    releaseChannel: "stable",
    chatAgentModel: { name: "test-model", provider: "openai" },
    jarvis: {
      greeting: "JARVIS online.",
      inactivityTimeoutSeconds: 0,
      ...(overrides as any).jarvis,
    },
    ...overrides,
  }) as unknown as UserSettings;

function buildSession(
  options: {
    settings?: UserSettings;
    llm?: (request: any) => Promise<string>;
    withTts?: boolean;
    brainAgent?: any;
  } = {},
) {
  const harness = createSender();
  const session = new JarvisSession({
    sessionId: "session-1",
    sender: harness.sender,
    mock: true,
    brainAgent: options.brainAgent,
    settings: options.settings ?? baseSettings(),
    sttFactory: async (callbacks) => new TestStt(callbacks),
    ttsFactory:
      options.withTts === false
        ? undefined
        : async (callbacks) => new TestTts(callbacks),
    llm:
      options.llm ??
      (async (request) => {
        request.onDelta("Opening the coding agent. ");
        request.onDelta("It is ready.");
        return "Opening the coding agent. It is ready.";
      }),
  });
  return { session, ...harness };
}

beforeEach(() => {
  TestTts.instances = [];
  TestStt.latest = null;
});

describe("JarvisSession", () => {
  it("connects, greets, and begins listening", async () => {
    const { session, states, payloads } = buildSession();
    await session.start();

    expect(states().slice(0, 2)).toEqual(["connecting", "listening"]);
    const greeting = payloads("jarvis:event:committed-transcript")[0];
    expect(greeting).toMatchObject({
      role: "assistant",
      text: "JARVIS online.",
    });
  });

  it("reports the resolved model without exposing credentials", async () => {
    const settings = baseSettings({
      jarvis: {
        elevenLabsApiKey: { value: "xi-secret-key" },
        inactivityTimeoutSeconds: 0,
      },
    } as any);
    const { session, events } = buildSession({ settings });
    await session.start();

    expect(session.model).toEqual({ name: "test-model", provider: "openai" });
    // No emitted event may ever carry the API key.
    expect(JSON.stringify(events)).not.toContain("xi-secret-key");
  });

  it("runs a full turn: transcript, streamed text, and spoken phrases", async () => {
    const { session, payloads, states } = buildSession();
    await session.start();

    TestStt.latest!.callbacks.onCommitted("open the coding agent");
    await vi.waitFor(() =>
      expect(payloads("jarvis:event:assistant-done")).toHaveLength(1),
    );

    expect(payloads("jarvis:event:committed-transcript")).toContainEqual(
      expect.objectContaining({ role: "user", text: "open the coding agent" }),
    );
    expect(
      payloads("jarvis:event:assistant-delta")
        .map((p) => p.delta)
        .join(""),
    ).toBe("Opening the coding agent. It is ready.");

    // Speech is emitted phrase-by-phrase, not as one blob after the stream.
    const spoken = TestTts.instances.flatMap((tts) => tts.phrases);
    expect(spoken).toContain("Opening the coding agent.");
    expect(spoken).toContain("It is ready.");
    expect(states()).toContain("thinking");
    expect(payloads("jarvis:event:audio").length).toBeGreaterThan(0);
  });

  it("returns to listening after speaking", async () => {
    const { session, states, payloads } = buildSession();
    await session.start();

    TestStt.latest!.callbacks.onCommitted("hello");
    await vi.waitFor(() =>
      expect(payloads("jarvis:event:audio-done").length).toBeGreaterThan(0),
    );
    await vi.waitFor(() => expect(session.state).toBe("listening"));
    expect(states()).toContain("speaking");
  });

  it("cancels queued speech and aborts the model on barge-in", async () => {
    let aborted = false;
    let releaseStream: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });

    const { session } = buildSession({
      llm: async (request) => {
        request.onDelta("This is the first sentence. ");
        request.abortSignal.addEventListener("abort", () => {
          aborted = true;
        });
        await gate;
        request.onDelta("This should never be spoken.");
        return "unused";
      },
    });
    await session.start();

    TestStt.latest!.callbacks.onCommitted("tell me a story");
    await vi.waitFor(() =>
      expect(TestTts.instances.some((tts) => tts.phrases.length > 0)).toBe(
        true,
      ),
    );

    const turnTts = TestTts.instances.find((tts) =>
      tts.phrases.includes("This is the first sentence."),
    )!;
    expect(turnTts).toBeDefined();

    session.handleSpeechActivity("start");

    expect(aborted).toBe(true);
    expect(turnTts.cancelled).toBe(true);

    releaseStream();
    await Promise.resolve();

    // Nothing further reaches TTS after the interruption.
    const spoken = TestTts.instances.flatMap((tts) => tts.phrases);
    expect(spoken).not.toContain("This should never be spoken.");
  });

  it("does not start a second turn while one is running", async () => {
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const { session } = buildSession({
      llm: async () => {
        calls++;
        await gate;
        return "done";
      },
    });
    await session.start();

    TestStt.latest!.callbacks.onCommitted("first request");
    await vi.waitFor(() => expect(calls).toBe(1));

    // A late transcript arriving mid-turn must not spawn a duplicate turn.
    TestStt.latest!.callbacks.onCommitted("second request");
    expect(calls).toBe(1);

    release();
  });

  it("ends the session on an end-session phrase", async () => {
    const { session, payloads } = buildSession();
    await session.start();

    TestStt.latest!.callbacks.onCommitted("that's all, end session");

    expect(payloads("jarvis:event:ended")).toHaveLength(1);
    expect(session.state).toBe("offline");
    expect(TestStt.latest!.closed).toBe(true);
  });

  it("only forwards microphone audio in mic-active states", async () => {
    const { session } = buildSession();
    const chunk = Buffer.alloc(320).toString("base64");

    // Offline: audio is dropped.
    session.handleAudioChunk(chunk);
    await session.start();

    session.handleAudioChunk(chunk);
    expect(TestStt.latest!.chunks).toHaveLength(1);

    session.stop("test");
    session.handleAudioChunk(chunk);
    expect(TestStt.latest!.chunks).toHaveLength(1);
  });

  it("still answers when the model streams nothing", async () => {
    // Mirrors an OpenAI-compatible endpoint that ignores `stream: true` and
    // replies with one JSON body: the stream yields no deltas at all.
    const { session, payloads } = buildSession({
      llm: async (request) => {
        const answer = "The build passed.";
        request.onDelta(answer);
        return answer;
      },
    });
    await session.start();

    TestStt.latest!.callbacks.onCommitted("did the build pass");
    await vi.waitFor(() =>
      expect(payloads("jarvis:event:assistant-done")).toHaveLength(1),
    );

    expect(payloads("jarvis:event:assistant-done")[0].text).toBe(
      "The build passed.",
    );
    // The whole answer still reaches speech, so a non-streaming brain is
    // slower but never silent.
    expect(TestTts.instances.flatMap((tts) => tts.phrases)).toContain(
      "The build passed.",
    );
    await vi.waitFor(() => expect(session.state).toBe("listening"));
  });

  it("surfaces a recoverable error when the model fails", async () => {
    const { session, payloads } = buildSession({
      llm: async () => {
        throw new Error("Local model server offline");
      },
    });
    await session.start();

    TestStt.latest!.callbacks.onCommitted("hello");
    await vi.waitFor(() =>
      expect(payloads("jarvis:event:error")).toHaveLength(1),
    );

    expect(payloads("jarvis:event:error")[0]).toMatchObject({
      message: "Local model server offline",
      recoverable: true,
    });
    // The session stays usable after a failed turn.
    await vi.waitFor(() => expect(session.state).toBe("listening"));
  });

  it("emits activity events without hidden reasoning", async () => {
    const { session, payloads } = buildSession();
    await session.start();

    TestStt.latest!.callbacks.onCommitted("hello");
    await vi.waitFor(() =>
      expect(payloads("jarvis:event:assistant-done")).toHaveLength(1),
    );

    const activity = payloads("jarvis:event:activity");
    expect(activity.map((event) => event.title)).toContain("JARVIS online");
    expect(activity.map((event) => event.title)).toContain(
      "Model: openai/test-model",
    );
    for (const event of activity) {
      expect(event).toHaveProperty("status");
      expect(event).toHaveProperty("timestamp");
      expect(event.isUserVisible).toBe(true);
    }
  });

  it("resolves the session-starting step instead of leaving it spinning", async () => {
    const { session, payloads } = buildSession();
    await session.start();

    const starting = payloads("jarvis:event:activity").filter(
      (event) => event.title === "Session starting",
    );
    // Emitted running, then re-emitted with the same id once connected, so the
    // timeline row resolves rather than showing a permanent spinner.
    expect(starting.length).toBe(2);
    expect(starting[0].status).toBe("running");
    expect(starting[1].status).toBe("success");
    expect(starting[1].id).toBe(starting[0].id);
    expect(starting[1].durationMs).toBeGreaterThanOrEqual(0);

    // Nothing is left running once the session is up.
    const unresolved = payloads("jarvis:event:activity")
      .filter((event) => event.status === "running")
      .filter(
        (event) =>
          !payloads("jarvis:event:activity").some(
            (later) => later.id === event.id && later.status !== "running",
          ),
      );
    expect(unresolved).toEqual([]);
  });

  it("stops cleanly and reports the reason", async () => {
    const { session, payloads } = buildSession();
    await session.start();

    session.stop("Workspace closed");
    expect(payloads("jarvis:event:ended")[0]).toMatchObject({
      reason: "Workspace closed",
    });

    // Stopping twice must not emit a second ended event.
    session.stop("again");
    expect(payloads("jarvis:event:ended")).toHaveLength(1);
  });
});

describe("JARVIS brain agent", () => {
  const hermes = {
    id: "agent-hermes",
    name: "Hermes",
    modelName: "hermes-3",
    endpoint: "http://192.168.68.111:8642/v1",
    model: {} as any,
  };

  it("reports the agent as the brain instead of a model role", async () => {
    const { session, payloads } = buildSession({ brainAgent: hermes });
    await session.start();

    expect(session.model).toEqual({
      provider: "agent:Hermes",
      name: "hermes-3",
    });

    const brainEvent = payloads("jarvis:event:activity").find((event) =>
      event.title.startsWith("Brain:"),
    );
    expect(brainEvent).toMatchObject({
      type: "agent",
      title: "Brain: Hermes",
      summary: "hermes-3 via http://192.168.68.111:8642/v1",
    });
  });

  it("falls back to the model roles when no agent is selected", async () => {
    const { session, payloads } = buildSession();
    await session.start();

    expect(session.model).toEqual({ provider: "openai", name: "test-model" });
    expect(
      payloads("jarvis:event:activity").some((event) =>
        event.title.startsWith("Brain:"),
      ),
    ).toBe(false);
  });

  it("never emits the agent's endpoint credentials", async () => {
    const { session, events } = buildSession({
      brainAgent: { ...hermes, model: {} as any },
    });
    await session.start();
    expect(JSON.stringify(events)).not.toContain("apiKey");
  });
});

describe("resolveJarvisModel", () => {
  it("falls back to the chat model in automatic mode", () => {
    expect(resolveJarvisModel(baseSettings())).toEqual({
      name: "test-model",
      provider: "openai",
    });
  });

  it("uses the dedicated voice model when configured", () => {
    const settings = baseSettings({
      jarvis: {
        modelMode: "voice",
        voiceModel: { name: "qwen2.5", provider: "lmstudio" },
      },
    } as any);
    expect(resolveJarvisModel(settings)).toEqual({
      name: "qwen2.5",
      provider: "lmstudio",
    });
  });

  it("ignores a voice-model selection with no model set", () => {
    const settings = baseSettings({
      jarvis: { modelMode: "custom" },
    } as any);
    expect(resolveJarvisModel(settings)).toEqual({
      name: "test-model",
      provider: "openai",
    });
  });
});

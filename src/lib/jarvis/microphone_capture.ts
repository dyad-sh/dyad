/**
 * Microphone capture + local voice activity detection for Meta Human OS.
 *
 * Produces 16 kHz mono PCM16 frames for the main process (which owns the
 * ElevenLabs credentials) and a smoothed amplitude signal that drives the
 * orb. VAD runs locally so the orb and the thinking indicator react without
 * a network round trip.
 */

export interface MicrophoneCaptureOptions {
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  deviceId?: string;
  /** Sample rate to deliver to the transcriber (16k pipeline, 24k realtime). */
  targetSampleRate?: number;
  /** 0..1 RMS threshold above which speech is considered active. */
  vadThreshold?: number;
  /** Silence duration that ends an utterance. */
  silenceTimeoutMs?: number;
  onAudio: (pcm16: ArrayBuffer) => void;
  onAmplitude: (amplitude: number) => void;
  onSpeechStart: () => void;
  onSpeechEnd: () => void;
  /** Device-level problems worth showing the user (muted or ended track). */
  onDeviceIssue?: (message: string) => void;
}

const TARGET_SAMPLE_RATE = 16000;
/** Send roughly this much audio per IPC message. */
const SEND_INTERVAL_MS = 100;
const FRAME_SIZE = 2048;
// Measured input on real hardware peaks far lower than the theoretical
// full-scale range once the OS applies its own gain, so a 0.02 RMS gate never
// opened. Keep this low and let the trailing-silence timer end the utterance.
const DEFAULT_VAD_THRESHOLD = 0.006;
const DEFAULT_SILENCE_TIMEOUT_MS = 700;
/** Speech must persist this long before we declare an utterance started. */
const SPEECH_ONSET_MS = 120;

const WORKLET_SOURCE = `
class JarvisCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      this.port.postMessage(input[0].slice());
    }
    return true;
  }
}
registerProcessor('jarvis-capture', JarvisCaptureProcessor);
`;

export class MicrophoneCapture {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private workletUrl: string | null = null;
  private muted = false;
  private speaking = false;
  private speechOnsetAt: number | null = null;
  private lastVoiceAt = 0;
  private silenceTimer: number | null = null;
  private stopped = false;
  /** Resampled 16 kHz audio awaiting the next send. */
  private outgoing: Float32Array[] = [];
  private outgoingSamples = 0;
  private readonly targetSampleRate: number;
  private readonly samplesPerSend: number;

  constructor(private options: MicrophoneCaptureOptions) {
    this.targetSampleRate = options.targetSampleRate ?? TARGET_SAMPLE_RATE;
    this.samplesPerSend = (this.targetSampleRate * SEND_INTERVAL_MS) / 1000;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: this.options.echoCancellation ?? false,
        noiseSuppression: this.options.noiseSuppression ?? false,
        // Keep AGC: it lifts a quiet input without gating it the way the
        // echo canceller does.
        autoGainControl: true,
        ...(this.options.deviceId
          ? { deviceId: { exact: this.options.deviceId } }
          : {}),
      },
    });
    if (this.stopped) {
      this.stream.getTracks().forEach((track) => track.stop());
      return;
    }

    this.watchTrack(this.stream.getAudioTracks()[0]);

    const context = new AudioContext();
    this.context = context;
    this.source = context.createMediaStreamSource(this.stream);

    const handleFrame = (samples: Float32Array) => this.handleFrame(samples);

    try {
      const blob = new Blob([WORKLET_SOURCE], {
        type: "application/javascript",
      });
      this.workletUrl = URL.createObjectURL(blob);
      await context.audioWorklet.addModule(this.workletUrl);
      if (this.stopped) return;
      const node = new AudioWorkletNode(context, "jarvis-capture");
      node.port.onmessage = (event) => handleFrame(event.data as Float32Array);
      this.source.connect(node);
      // A worklet with no destination connection is not pulled by the graph
      // in Chromium, so terminate it in a muted gain node.
      const sink = context.createGain();
      sink.gain.value = 0;
      node.connect(sink).connect(context.destination);
      this.worklet = node;
    } catch {
      // AudioWorklet unavailable (rare) — fall back to ScriptProcessor.
      const processor = context.createScriptProcessor(FRAME_SIZE, 1, 1);
      processor.onaudioprocess = (event) =>
        handleFrame(event.inputBuffer.getChannelData(0));
      const sink = context.createGain();
      sink.gain.value = 0;
      this.source.connect(processor);
      processor.connect(sink).connect(context.destination);
      this.processor = processor;
    }
  }

  /**
   * A track can be live yet "muted" — the browser's term for the source
   * producing no data, which macOS does when the device is held elsewhere or
   * the input is disabled. It looks identical to silence unless reported.
   */
  private watchTrack(track: MediaStreamTrack | undefined): void {
    if (!track) {
      this.options.onDeviceIssue?.("No audio track was returned.");
      return;
    }
    const settings = track.getSettings();
    // eslint-disable-next-line no-console
    console.info("[jarvis] capture track", {
      label: track.label,
      muted: track.muted,
      readyState: track.readyState,
      deviceId: settings.deviceId,
      sampleRate: settings.sampleRate,
      channelCount: settings.channelCount,
    });

    if (track.muted) {
      this.options.onDeviceIssue?.(
        `"${track.label || "The microphone"}" is delivering no audio. Another app may be using it, or the input is disabled — pick a different device in Voice settings.`,
      );
    }
    track.addEventListener("mute", () =>
      this.options.onDeviceIssue?.(
        `"${track.label || "The microphone"}" stopped delivering audio.`,
      ),
    );
    track.addEventListener("ended", () =>
      this.options.onDeviceIssue?.(
        `"${track.label || "The microphone"}" was disconnected.`,
      ),
    );
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    if (muted && this.speaking) {
      this.endSpeech();
    }
    if (muted) {
      this.options.onAmplitude(0);
    }
  }

  stop(): void {
    this.stopped = true;
    this.outgoing = [];
    this.outgoingSamples = 0;
    if (this.silenceTimer) {
      window.clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.worklet) {
      this.worklet.port.onmessage = null;
      this.worklet.disconnect();
      this.worklet = null;
    }
    if (this.processor) {
      this.processor.onaudioprocess = null;
      this.processor.disconnect();
      this.processor = null;
    }
    this.source?.disconnect();
    this.source = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    void this.context?.close().catch(() => {});
    this.context = null;
  }

  private handleFrame(samples: Float32Array): void {
    if (this.stopped || this.muted || !this.context) return;

    let sumSquares = 0;
    for (let i = 0; i < samples.length; i++) {
      sumSquares += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sumSquares / samples.length);
    this.options.onAmplitude(Math.min(1, rms * 6));

    const threshold = this.options.vadThreshold ?? DEFAULT_VAD_THRESHOLD;
    const now = performance.now();
    if (rms >= threshold) {
      this.lastVoiceAt = now;
      if (!this.speaking) {
        this.speechOnsetAt ??= now;
        if (now - this.speechOnsetAt >= SPEECH_ONSET_MS) {
          this.speaking = true;
          this.speechOnsetAt = null;
          this.options.onSpeechStart();
        }
      }
      this.scheduleSilenceCheck();
    } else if (!this.speaking) {
      this.speechOnsetAt = null;
    }

    // Stream continuously rather than only while local VAD hears speech.
    // Realtime transcription does its own segmentation and closes an idle
    // socket, so gating on VAD both starved it and let it time out.
    // Worklet blocks are tiny (128 samples), so batch them before crossing
    // the IPC boundary.
    this.outgoing.push(
      resampleTo(samples, this.context.sampleRate, this.targetSampleRate),
    );
    this.outgoingSamples += this.outgoing.at(-1)!.length;
    if (this.outgoingSamples >= this.samplesPerSend) {
      const merged = new Float32Array(this.outgoingSamples);
      let offset = 0;
      for (const part of this.outgoing) {
        merged.set(part, offset);
        offset += part.length;
      }
      this.outgoing = [];
      this.outgoingSamples = 0;
      this.options.onAudio(floatToPcm16(merged));
    }
  }

  private scheduleSilenceCheck(): void {
    if (this.silenceTimer) return;
    const timeout = this.options.silenceTimeoutMs ?? DEFAULT_SILENCE_TIMEOUT_MS;
    this.silenceTimer = window.setTimeout(() => {
      this.silenceTimer = null;
      if (!this.speaking) return;
      if (performance.now() - this.lastVoiceAt >= timeout) {
        this.endSpeech();
      } else {
        this.scheduleSilenceCheck();
      }
    }, timeout);
  }

  private endSpeech(): void {
    this.speaking = false;
    this.speechOnsetAt = null;
    if (this.silenceTimer) {
      window.clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    this.options.onSpeechEnd();
  }
}

/** Linear-interpolation resample to an arbitrary target rate. */
export function resampleTo(
  samples: Float32Array,
  inputSampleRate: number,
  targetSampleRate: number,
): Float32Array {
  if (inputSampleRate === targetSampleRate) return samples;
  const ratio = inputSampleRate / targetSampleRate;
  const outputLength = Math.floor(samples.length / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const next = Math.min(index + 1, samples.length - 1);
    const weight = position - index;
    output[i] = samples[index] * (1 - weight) + samples[next] * weight;
  }
  return output;
}

export function floatToPcm16(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(
      i * 2,
      clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
      true,
    );
  }
  return buffer;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** Back-compatible helper: resample to the 16 kHz pipeline rate. */
export function downsampleTo16k(
  samples: Float32Array,
  inputSampleRate: number,
): Float32Array {
  return resampleTo(samples, inputSampleRate, TARGET_SAMPLE_RATE);
}

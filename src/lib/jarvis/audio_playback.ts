/**
 * Audio playback coordinator for streamed TTS.
 *
 * Schedules incoming PCM16 chunks back-to-back on a single reusable
 * AudioContext so speech plays gaplessly, and can cut playback instantly on
 * barge-in. Also exposes a smoothed output amplitude for the orb's speaking
 * animation.
 */

export interface AudioPlaybackOptions {
  onAmplitude?: (amplitude: number) => void;
  onPlaybackEnd?: () => void;
  onError?: (message: string) => void;
}

export class AudioPlaybackCoordinator {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private nextStartTime = 0;
  private amplitudeTimer: number | null = null;
  private amplitudeData: Uint8Array<ArrayBuffer> | null = null;
  private disposed = false;

  constructor(private options: AudioPlaybackOptions = {}) {}

  private ensureContext(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext();
      this.gain = this.context.createGain();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 256;
      this.amplitudeData = new Uint8Array(
        new ArrayBuffer(this.analyser.frequencyBinCount),
      );
      this.gain.connect(this.analyser).connect(this.context.destination);
    }
    if (this.context.state === "suspended") {
      void this.context.resume().catch(() => {});
    }
    return this.context;
  }

  /** Queue one chunk of mono PCM16 audio. */
  enqueue(pcm16: ArrayBuffer, sampleRate: number): void {
    if (this.disposed) return;
    try {
      const context = this.ensureContext();
      const samples = new Int16Array(pcm16);
      if (samples.length === 0) return;

      const buffer = context.createBuffer(1, samples.length, sampleRate);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) {
        channel[i] = samples[i] / 0x8000;
      }

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.gain!);

      // Small lead-in so the first chunk isn't clipped by scheduling jitter.
      const startAt = Math.max(this.nextStartTime, context.currentTime + 0.02);
      source.start(startAt);
      this.nextStartTime = startAt + buffer.duration;

      this.sources.add(source);
      source.onended = () => {
        this.sources.delete(source);
        if (this.sources.size === 0) {
          this.stopAmplitudeTracking();
          this.options.onPlaybackEnd?.();
        }
      };
      this.startAmplitudeTracking();
    } catch (error) {
      this.options.onError?.(
        error instanceof Error ? error.message : "Audio playback failed",
      );
    }
  }

  /** Stop immediately and drop everything queued (barge-in / stop button). */
  cancel(): void {
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already ended.
      }
      source.disconnect();
    }
    this.sources.clear();
    this.nextStartTime = 0;
    this.stopAmplitudeTracking();
    this.options.onAmplitude?.(0);
  }

  get isPlaying(): boolean {
    return this.sources.size > 0;
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
    void this.context?.close().catch(() => {});
    this.context = null;
    this.gain = null;
    this.analyser = null;
  }

  private startAmplitudeTracking(): void {
    if (this.amplitudeTimer != null || !this.options.onAmplitude) return;
    const tick = () => {
      if (!this.analyser || !this.amplitudeData) return;
      this.analyser.getByteTimeDomainData(this.amplitudeData);
      let peak = 0;
      for (let i = 0; i < this.amplitudeData.length; i++) {
        peak = Math.max(peak, Math.abs(this.amplitudeData[i] - 128) / 128);
      }
      this.options.onAmplitude?.(peak);
      this.amplitudeTimer = window.requestAnimationFrame(tick);
    };
    this.amplitudeTimer = window.requestAnimationFrame(tick);
  }

  private stopAmplitudeTracking(): void {
    if (this.amplitudeTimer != null) {
      window.cancelAnimationFrame(this.amplitudeTimer);
      this.amplitudeTimer = null;
    }
    this.options.onAmplitude?.(0);
  }
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

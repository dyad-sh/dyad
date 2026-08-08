import { describe, expect, it } from "vitest";
import {
  arrayBufferToBase64,
  downsampleTo16k,
  floatToPcm16,
} from "@/lib/jarvis/microphone_capture";

/**
 * The capture path converts Float32 worklet blocks to 16 kHz PCM16 before it
 * crosses IPC. If these lose the signal, a working microphone still arrives as
 * silence, so they are pinned down here.
 */

function sine(sampleCount: number, sampleRate: number, hz = 440): Float32Array {
  const samples = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = Math.sin((2 * Math.PI * hz * i) / sampleRate) * 0.5;
  }
  return samples;
}

function peakOfPcm16(buffer: ArrayBuffer): number {
  const view = new DataView(buffer);
  let peak = 0;
  for (let offset = 0; offset + 1 < buffer.byteLength; offset += 2) {
    peak = Math.max(peak, Math.abs(view.getInt16(offset, true)));
  }
  return peak / 32768;
}

describe("downsampleTo16k", () => {
  it("preserves the signal when resampling 48 kHz to 16 kHz", () => {
    const resampled = downsampleTo16k(sine(4800, 48000), 48000);
    expect(resampled.length).toBe(1600);
    const peak = resampled.reduce((max, v) => Math.max(max, Math.abs(v)), 0);
    expect(peak).toBeGreaterThan(0.3);
  });

  it("handles the 128-sample blocks an AudioWorklet emits", () => {
    const resampled = downsampleTo16k(sine(128, 48000), 48000);
    expect(resampled.length).toBe(42);
    expect(resampled.some((value) => value !== 0)).toBe(true);
  });

  it("passes audio through untouched when already at 16 kHz", () => {
    const input = sine(160, 16000);
    expect(downsampleTo16k(input, 16000)).toBe(input);
  });

  it("works at 44.1 kHz too", () => {
    const resampled = downsampleTo16k(sine(4410, 44100), 44100);
    expect(resampled.length).toBeGreaterThan(1500);
    expect(resampled.some((value) => Math.abs(value) > 0.3)).toBe(true);
  });
});

describe("floatToPcm16", () => {
  it("keeps the amplitude of a real signal", () => {
    const peak = peakOfPcm16(floatToPcm16(sine(1600, 16000)));
    // 0.5 amplitude in, roughly 0.5 of full scale out.
    expect(peak).toBeGreaterThan(0.45);
    expect(peak).toBeLessThanOrEqual(1);
  });

  it("emits two bytes per sample", () => {
    expect(floatToPcm16(new Float32Array(1600)).byteLength).toBe(3200);
  });

  it("returns silence only for silent input", () => {
    expect(peakOfPcm16(floatToPcm16(new Float32Array(320)))).toBe(0);
  });

  it("clamps rather than wrapping on overdriven input", () => {
    const hot = new Float32Array([2, -2, 1.5, -1.5]);
    const view = new DataView(floatToPcm16(hot));
    expect(view.getInt16(0, true)).toBe(32767);
    expect(view.getInt16(2, true)).toBe(-32768);
  });
});

describe("end-to-end capture conversion", () => {
  it("a 48 kHz sine survives resample, conversion and base64", () => {
    const pcm = floatToPcm16(downsampleTo16k(sine(4800, 48000), 48000));
    expect(peakOfPcm16(pcm)).toBeGreaterThan(0.4);

    const base64 = arrayBufferToBase64(pcm);
    const decoded = Buffer.from(base64, "base64");
    expect(decoded.length).toBe(pcm.byteLength);

    let peak = 0;
    for (let offset = 0; offset + 1 < decoded.length; offset += 2) {
      peak = Math.max(peak, Math.abs(decoded.readInt16LE(offset)));
    }
    // What the main process decodes must match what was captured.
    expect(peak / 32768).toBeGreaterThan(0.4);
  });
});

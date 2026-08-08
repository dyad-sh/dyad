/**
 * Subtle synthesized interface sounds. Generated with WebAudio rather than
 * shipped assets so there is nothing to load and nothing to license.
 */

let context: AudioContext | null = null;

function getContext(): AudioContext | null {
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") {
      void context.resume().catch(() => {});
    }
    return context;
  } catch {
    return null;
  }
}

/** Two-tone rising chime played when a session activates. */
export function playActivationChime(): void {
  const audio = getContext();
  if (!audio) return;

  const now = audio.currentTime;
  const master = audio.createGain();
  master.gain.value = 0.06;
  master.connect(audio.destination);

  for (const [index, frequency] of [523.25, 783.99].entries()) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;

    const start = now + index * 0.09;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(1, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.32);

    oscillator.connect(gain).connect(master);
    oscillator.start(start);
    oscillator.stop(start + 0.35);
  }
}

let sharedAudioCtx: AudioContext | null = null;

//Plays a soft programmatic chime using a shared Web Audio API context.

export async function playDoneChime() {
  try {
    if (!sharedAudioCtx) {
      const AudioContextClass =
        window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        sharedAudioCtx = new AudioContextClass();
      }
    }

    if (!sharedAudioCtx) return;
    const ctx = sharedAudioCtx;

    // Resume context if suspended (common browser policy)
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      440,
      ctx.currentTime + 0.3,
    );

    gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.4);
  } catch (error) {
    console.error("Failed to play notification sound:", error);
  }
}

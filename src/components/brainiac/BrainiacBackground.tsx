/** Animated Jarvis-style backdrop: grid, targeting geometry, vignette, pulse. */
export function BrainiacBackground() {
  return (
    <div className="brainiac-bg" aria-hidden>
      <div className="brainiac-bg-grid" />
      <div className="brainiac-bg-diagonals" />
      <div className="brainiac-bg-radar" />
      <div className="brainiac-bg-reticle brainiac-bg-reticle--tl" />
      <div className="brainiac-bg-reticle brainiac-bg-reticle--tr" />
      <div className="brainiac-bg-reticle brainiac-bg-reticle--bl" />
      <div className="brainiac-bg-reticle brainiac-bg-reticle--br" />
      <div className="brainiac-bg-vignette" />
      <div className="brainiac-bg-pulse" />
    </div>
  );
}

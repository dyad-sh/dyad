'use client'

export function HolographicBackground() {
  return (
    <div className="holo-bg" aria-hidden="true">
      <div className="holo-blob holo-blob-1" />
      <div className="holo-blob holo-blob-2" />
      <div className="holo-blob holo-blob-3" />
      <div className="holo-grid" />
      <div className="holo-vignette" />
      <div className="holo-scanlines" />
    </div>
  )
}

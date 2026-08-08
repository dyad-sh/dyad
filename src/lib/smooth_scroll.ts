/**
 * Scrolling the transcript so the newest text stays in view.
 *
 * The browser's native `behavior: "smooth"` has a fixed duration and easing
 * that we cannot tune, and it restarts from scratch on every call — which,
 * during streaming, means it is re-triggered twenty times a second and never
 * settles. Driving it ourselves keeps the movement continuous and lets it ease
 * out, so the viewport drifts upward rather than jumping.
 */

/** Decelerating curve: quick to start moving, gentle to stop. */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - clamped, 3);
}

/**
 * Duration for a given distance, within the range that reads as deliberate
 * rather than sluggish. Short hops finish quickly; long ones never drag.
 */
export function scrollDurationFor(distance: number): number {
  const magnitude = Math.abs(distance);
  if (magnitude < 8) return 0;
  return Math.min(400, Math.max(250, magnitude * 0.6));
}

export type ScrollAnimation = { cancel: () => void };

/**
 * Animates `element` to `top`, returning a handle so a new target can replace
 * an in-flight animation instead of fighting it.
 */
export function animateScrollTo(
  element: HTMLElement,
  top: number,
  options: {
    duration?: number;
    now?: () => number;
    schedule?: (callback: () => void) => number;
    cancelScheduled?: (handle: number) => void;
  } = {},
): ScrollAnimation {
  const {
    now = () => performance.now(),
    schedule = (callback: () => void) => requestAnimationFrame(callback),
    cancelScheduled = (handle: number) => cancelAnimationFrame(handle),
  } = options;

  const start = element.scrollTop;
  const distance = top - start;
  const duration = options.duration ?? scrollDurationFor(distance);

  if (duration === 0) {
    element.scrollTop = top;
    return { cancel: () => {} };
  }

  const began = now();
  let handle = 0;
  let cancelled = false;

  const step = () => {
    if (cancelled) return;
    const elapsed = now() - began;
    const progress = elapsed / duration;
    if (progress >= 1) {
      element.scrollTop = top;
      return;
    }
    element.scrollTop = start + distance * easeOutCubic(progress);
    handle = schedule(step);
  };

  handle = schedule(step);

  return {
    cancel: () => {
      cancelled = true;
      cancelScheduled(handle);
    },
  };
}

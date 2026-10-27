const FIRST_WARNING_MS = 30_000;
const MAX_WARNING_INTERVAL_MS = 10 * 60_000;

export interface PhaseStallWatch {
  /** Record the step the operation is in now. */
  setPhase(phase: string): void;
  currentPhase(): string;
  /** Stop watching and summarize how long each phase took. */
  stop(): string;
}

/**
 * Warn when a multi-step operation stays in one step for a long time, naming
 * that step. An operation that never settles otherwise leaves nothing in the
 * log. Warnings back off (30s, 1m, 2m, ... capped at 10m) so one left stuck for
 * days does not flood the log. Only step names and durations are logged, so
 * callers must not put paths or user content in `label` or phase names.
 */
export function startPhaseStallWatch({
  label,
  initialPhase,
  warn,
  firstWarningMs = FIRST_WARNING_MS,
}: {
  label: string;
  initialPhase: string;
  warn: (message: string) => void;
  firstWarningMs?: number;
}): PhaseStallWatch {
  const startedAt = Date.now();
  const durations: [string, number][] = [];
  let phase = initialPhase;
  let phaseStartedAt = startedAt;
  let delay = firstWarningMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const seconds = (since: number) => Math.round((Date.now() - since) / 1000);
  const endPhase = () => {
    durations.push([phase, Date.now() - phaseStartedAt]);
  };

  const schedule = () => {
    timer = setTimeout(() => {
      warn(
        `${label} still running after ${seconds(startedAt)}s; in "${phase}" for ${seconds(phaseStartedAt)}s`,
      );
      delay = Math.min(delay * 2, MAX_WARNING_INTERVAL_MS);
      schedule();
    }, delay);
    timer.unref?.();
  };
  schedule();

  return {
    setPhase(next) {
      if (timer === undefined) return;
      endPhase();
      phase = next;
      phaseStartedAt = Date.now();
    },
    currentPhase: () => phase,
    stop() {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
        endPhase();
      }
      return durations.map(([name, ms]) => `${name}: ${ms} ms`).join("; ");
    },
  };
}

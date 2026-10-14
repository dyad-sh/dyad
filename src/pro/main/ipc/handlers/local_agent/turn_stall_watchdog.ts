import log from "electron-log";

const logger = log.scope("turn_stall_watchdog");

const FIRST_WARNING_MS = 30_000;
const MAX_WARNING_INTERVAL_MS = 10 * 60_000;

export interface TurnStallWatchdog {
  /** Record the setup step the turn is in now. */
  setPhase(phase: string): void;
  /** The turn produced model output (or ended); stop watching. */
  stop(): void;
}

/**
 * Warn in the log when an agent turn has produced no model output for a
 * while, naming the step it's stuck in. A turn that hangs before its first
 * model request (e.g. on an MCP server that never answers) otherwise leaves
 * nothing in the log. Warnings back off (30s, 1m, 2m, ... capped at 10m) so a
 * turn left stuck for days doesn't flood the log.
 */
export function startTurnStallWatchdog(
  chatId: number,
  { firstWarningMs = FIRST_WARNING_MS } = {},
): TurnStallWatchdog {
  const startedAt = Date.now();
  let phase = "preparing turn";
  let phaseStartedAt = startedAt;
  let delay = firstWarningMs;
  let warned = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const seconds = (since: number) => Math.round((Date.now() - since) / 1000);

  const schedule = () => {
    timer = setTimeout(() => {
      warned = true;
      logger.warn(
        `Chat ${chatId}: no model output after ${seconds(startedAt)}s; in phase "${phase}" for ${seconds(phaseStartedAt)}s`,
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
      phase = next;
      phaseStartedAt = Date.now();
    },
    stop() {
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = undefined;
      if (warned) {
        logger.info(
          `Chat ${chatId}: stall ended after ${seconds(startedAt)}s in phase "${phase}"`,
        );
      }
    },
  };
}

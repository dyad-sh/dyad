import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ipc } from "@/ipc/types";
import {
  TerminalDataPayloadSchema,
  TerminalExitPayloadSchema,
  type TerminalOpenResult,
} from "@/ipc/types/terminal";
import { showSuccess, showWarning } from "@/lib/toast";

type TerminalStatus = "idle" | "connecting" | "ready" | "exited" | "error";

interface UseTerminalSessionParams {
  appId: number | null;
  enabled: boolean;
  cols: number;
  rows: number;
  onData: (chunk: string) => void;
  onExit?: () => void;
}

interface TerminalExitState {
  exitCode: number | null;
  signal?: number | null;
}

function terminalDataChannel(sessionId: string): string {
  return `terminal:data:${sessionId}`;
}

function terminalExitChannel(sessionId: string): string {
  return `terminal:exit:${sessionId}`;
}

function getBufferedSuffixMissingFromReplay(
  replay: string,
  buffered: string,
): string {
  const maxOverlap = Math.min(replay.length, buffered.length);
  for (let overlap = maxOverlap; overlap > 0; overlap--) {
    if (replay.endsWith(buffered.slice(0, overlap))) {
      return buffered.slice(overlap);
    }
  }
  return buffered;
}

function getIpcRenderer():
  | {
      on(channel: string, listener: (payload: unknown) => void): () => void;
    }
  | undefined {
  return (window as any).electron?.ipcRenderer;
}

export function useTerminalSession({
  appId,
  enabled,
  cols,
  rows,
  onData,
  onExit,
}: UseTerminalSessionParams) {
  const { t } = useTranslation("chat");
  const onDataRef = useRef(onData);
  const onExitRef = useRef(onExit);
  const latestSizeRef = useRef({ cols, rows });
  const [restartNonce, setRestartNonce] = useState(0);
  const [session, setSession] = useState<TerminalOpenResult | null>(null);
  const [status, setStatus] = useState<TerminalStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [exit, setExit] = useState<TerminalExitState | null>(null);

  useEffect(() => {
    onDataRef.current = onData;
  }, [onData]);

  useEffect(() => {
    onExitRef.current = onExit;
  }, [onExit]);

  useEffect(() => {
    latestSizeRef.current = { cols, rows };
  }, [cols, rows]);

  useEffect(() => {
    if (!enabled || appId === null) {
      setStatus("idle");
      setSession(null);
      setError(null);
      setExit(null);
      return;
    }

    let cancelled = false;
    let activeSessionId: string | null = null;
    let unsubscribeData: (() => void) | undefined;
    let unsubscribeExit: (() => void) | undefined;
    let hydrating = true;
    let bufferedDuringHydration = "";
    let latestExit: TerminalExitState | null = null;

    setStatus("connecting");
    setError(null);
    setExit(null);

    ipc.terminal
      .open({
        appId,
        cols: latestSizeRef.current.cols,
        rows: latestSizeRef.current.rows,
      })
      .then(async (result) => {
        if (cancelled) {
          void ipc.terminal.close({ sessionId: result.sessionId });
          return;
        }

        activeSessionId = result.sessionId;
        setSession(result);
        const ipcRenderer = getIpcRenderer();
        if (!ipcRenderer) {
          if (result.scrollback) {
            onDataRef.current(result.scrollback);
          }
          if (result.exited) {
            setExit(result.exited);
            setStatus("exited");
          } else {
            setStatus("ready");
          }
          return;
        }

        unsubscribeData = ipcRenderer.on(
          terminalDataChannel(result.sessionId),
          (payload) => {
            const parsed = TerminalDataPayloadSchema.safeParse(payload);
            if (parsed.success && parsed.data.sessionId === result.sessionId) {
              if (hydrating) {
                bufferedDuringHydration += parsed.data.chunk;
              } else {
                onDataRef.current(parsed.data.chunk);
              }
            }
          },
        );

        unsubscribeExit = ipcRenderer.on(
          terminalExitChannel(result.sessionId),
          (payload) => {
            const parsed = TerminalExitPayloadSchema.safeParse(payload);
            if (!parsed.success || parsed.data.sessionId !== result.sessionId) {
              return;
            }
            latestExit = {
              exitCode: parsed.data.exitCode,
              signal: parsed.data.signal ?? null,
            };
            setExit(latestExit);
            setStatus("exited");
            onExitRef.current?.();
          },
        );

        try {
          const { scrollback } = await ipc.terminal.serialize({
            sessionId: result.sessionId,
          });
          if (cancelled) return;
          if (scrollback) {
            onDataRef.current(scrollback);
          }
          const missedChunk = getBufferedSuffixMissingFromReplay(
            scrollback,
            bufferedDuringHydration,
          );
          if (missedChunk) {
            onDataRef.current(missedChunk);
          }
        } finally {
          hydrating = false;
        }

        if (cancelled) return;
        const resolvedExit = latestExit ?? result.exited;
        if (resolvedExit) {
          setExit(resolvedExit);
          setStatus("exited");
        } else {
          setStatus("ready");
        }

        if (result.created) {
          showSuccess(t("terminal.readyToast", { appName: result.appName }));
        }
        if (result.evicted) {
          showWarning(
            t("terminal.evictedToast", { appName: result.evicted.appName }),
          );
        }
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setStatus("error");
      });

    return () => {
      cancelled = true;
      unsubscribeData?.();
      unsubscribeExit?.();
      if (activeSessionId) {
        void ipc.terminal.close({ sessionId: activeSessionId });
      }
    };
  }, [appId, enabled, restartNonce, t]);

  const write = useCallback(
    (data: string) => {
      if (!session?.sessionId || status !== "ready") return;
      void ipc.terminal
        .write({ sessionId: session.sessionId, data })
        .catch((err: Error) => {
          setError(err.message);
          setStatus("error");
        });
    },
    [session?.sessionId, status],
  );

  const resize = useCallback(
    (nextCols: number, nextRows: number) => {
      if (!session?.sessionId || status === "idle") return;
      void ipc.terminal.resize({
        sessionId: session.sessionId,
        cols: nextCols,
        rows: nextRows,
      });
    },
    [session?.sessionId, status],
  );

  const kill = useCallback(() => {
    if (!session?.sessionId) return;
    void ipc.terminal.kill({ sessionId: session.sessionId });
    setExit({ exitCode: null, signal: null });
    setStatus("exited");
  }, [session?.sessionId]);

  const restart = useCallback(() => {
    if (session?.sessionId) {
      void ipc.terminal.kill({ sessionId: session.sessionId });
    }
    setSession(null);
    setExit(null);
    setError(null);
    setStatus("connecting");
    setRestartNonce((prev) => prev + 1);
  }, [session?.sessionId]);

  return {
    session,
    status,
    error,
    exit,
    write,
    resize,
    kill,
    restart,
  };
}

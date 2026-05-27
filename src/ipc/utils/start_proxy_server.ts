// startProxy.js – helper to launch proxy.js as a worker

import { Worker } from "worker_threads";
import path from "path";
import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("start_proxy_server");

export async function startProxy(
  targetOrigin: string,
  opts: {
    port: number;
    onStarted?: (proxyUrl: string) => void;
    fixedHeaders?: Record<string, string>;
  },
) {
  if (!/^https?:\/\//.test(targetOrigin))
    throw new DyadError(
      "startProxy: targetOrigin must be absolute http/https URL",
      DyadErrorKind.Validation,
    );
  const { port, onStarted, fixedHeaders } = opts;
  logger.info("Starting proxy on port", port);

  const worker = new Worker(
    path.resolve(__dirname, "..", "..", "worker", "proxy_server.js"),
    {
      workerData: {
        targetOrigin,
        port,
        fixedHeaders,
      },
    },
  );

  worker.on("message", (m) => {
    logger.info("[proxy]", m);
    if (typeof m === "string" && m.startsWith("proxy-server-start url=")) {
      const url = m.substring("proxy-server-start url=".length);
      onStarted?.(url);
    }
  });
  worker.on("error", (e) => logger.error("[proxy] error:", e));
  worker.on("exit", (c) => logger.info("[proxy] exit", c));

  return worker; // let the caller keep a handle if desired
}

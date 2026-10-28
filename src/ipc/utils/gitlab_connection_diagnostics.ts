import { app, net } from "electron";
import log from "electron-log";
import type { GitLabConnectionDiagnostics } from "../types/gitlab";
import { normalizeGitLabInstanceUrl } from "../../shared/gitlab_instance_url";
import { formatGitLabConnectionDiagnostics } from "../../shared/gitlab_connection_diagnostics";
import { describeTransportError } from "./gitlab_client";

const logger = log.scope("gitlab_connection_diagnostics");
const TIMEOUT_MS = 15_000;

/** Read-only, token-free probes of the same endpoint using both main-process stacks. */
export async function testGitLabConnection(
  instanceUrl: string,
): Promise<GitLabConnectionDiagnostics> {
  const url = `${normalizeGitLabInstanceUrl(instanceUrl)}/api/v4/user`;
  const probe = async (
    transport: "Node fetch" | "Electron net.fetch",
    request: (url: string, init: RequestInit) => Promise<Response>,
  ) => {
    const started = performance.now();
    try {
      const response = await request(url, {
        method: "GET",
        credentials: "omit",
        redirect: "manual",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // Only the HTTP status matters. Do not read or log server bodies/headers.
      void response.body?.cancel().catch(() => {});
      return {
        transport,
        durationMs: Math.round(performance.now() - started),
        httpStatus: response.status,
        error: null,
      };
    } catch (error) {
      return {
        transport,
        durationMs: Math.round(performance.now() - started),
        httpStatus: null,
        error:
          error instanceof Error && error.name === "TimeoutError"
            ? "No response within 15s"
            : describeTransportError(error, ""),
      };
    }
  };
  const report: GitLabConnectionDiagnostics = {
    url,
    testedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron ?? "unknown",
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    results: await Promise.all([
      probe("Node fetch", (url, init) => fetch(url, init)),
      probe("Electron net.fetch", (url, init) => net.fetch(url, init)),
    ]),
  };
  // Local log only. Hostnames and transport details must not enter telemetry.
  logger.info(formatGitLabConnectionDiagnostics(report));
  return report;
}

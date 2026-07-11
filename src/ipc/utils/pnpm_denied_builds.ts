import {
  parsePnpmIgnoredBuildsFromOutput,
  readPnpmIgnoredBuilds,
  recordDeniedPnpmBuilds,
  type PnpmIgnoredBuild,
} from "@/ipc/utils/socket_firewall";
import { sendTelemetryEvent } from "@/ipc/utils/telemetry";

export type PnpmDeniedBuildsTelemetrySource =
  | "add-dependency"
  | "app-run"
  | "app-upgrade"
  | "self-heal"
  | "cloud-sandbox";

/**
 * Resolves the ignored-builds list the way every local flow should:
 * `.modules.yaml` is authoritative when present; the install/error output is
 * the fallback (e.g. narrow-PTY wrapping makes the output less reliable).
 */
export async function resolvePnpmIgnoredBuilds(
  appPath: string,
  fallbackOutput?: string,
): Promise<PnpmIgnoredBuild[]> {
  const ignoredBuildsFromModulesYaml = await readPnpmIgnoredBuilds(appPath);
  if (ignoredBuildsFromModulesYaml.length > 0) {
    return ignoredBuildsFromModulesYaml;
  }
  return fallbackOutput ? parsePnpmIgnoredBuildsFromOutput(fallbackOutput) : [];
}

/**
 * Records tagged denials for the given ignored builds and emits the
 * `pnpm:build-auto-denied` telemetry event when anything new was denied.
 * Single owner of the record + telemetry contract for all call sites.
 */
export async function recordAndReportDeniedPnpmBuilds({
  appPath,
  ignoredBuilds,
  source,
  disableHooks,
}: {
  appPath: string;
  ignoredBuilds: PnpmIgnoredBuild[];
  source: PnpmDeniedBuildsTelemetrySource;
  disableHooks?: boolean;
}): Promise<{ deniedBuilds: PnpmIgnoredBuild[] }> {
  const { deniedBuilds } = await recordDeniedPnpmBuilds({
    appPath,
    ignoredBuilds,
    ...(disableHooks === undefined ? {} : { disableHooks }),
  });
  if (deniedBuilds.length > 0) {
    sendTelemetryEvent("pnpm:build-auto-denied", {
      packages: deniedBuilds.map((ignoredBuild) => ignoredBuild.packageSpec),
      source,
    });
  }
  return { deniedBuilds };
}

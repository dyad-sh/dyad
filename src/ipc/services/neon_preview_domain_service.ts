import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { getDyadAppPath } from "@/paths/paths";
import type { AppRunInvocationRef } from "@/app_run/state";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getAppPreviewHostname } from "../../../shared/preview_hostname";
import { readEnvVarsOrEmpty } from "../utils/app_env_var_utils";
import { ensureNeonAuthTrustedDomain } from "../utils/neon_utils";
import { abortable } from "../utils/abortable";
import { retryOnLocked } from "../utils/retryOnLocked";

export interface NeonPreviewTarget {
  projectId: string;
  branchId: string;
}

/** Capture under runtime-config admission so the association and env agree. */
export async function resolveNeonPreviewTarget(
  appId: number,
): Promise<NeonPreviewTarget | null> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app?.neonProjectId) return null;
  const env = await readEnvVarsOrEmpty({ appPath: getDyadAppPath(app.path) });
  if (!env.some(({ key, value }) => key === "NEON_AUTH_BASE_URL" && value))
    return null;
  const branchId = app.neonActiveBranchId ?? app.neonDevelopmentBranchId;
  if (!branchId)
    throw new DyadError(
      "The active Neon Auth branch is unavailable.",
      DyadErrorKind.Precondition,
    );
  return { projectId: app.neonProjectId, branchId };
}

export class NeonPreviewDomainService {
  private readonly pending = new Map<string, Promise<void>>();

  constructor(private readonly register = ensureNeonAuthTrustedDomain) {}

  async ensureTrustedDomain(input: {
    appId: number;
    processId: number;
    invocationRef?: AppRunInvocationRef;
    target: NeonPreviewTarget;
    origin: string;
    signal: AbortSignal;
  }): Promise<void> {
    const url = URL.parse(input.origin);
    if (
      !url ||
      url.protocol !== "http:" ||
      url.hostname !== getAppPreviewHostname(input.appId) ||
      !url.port ||
      url.origin !== input.origin
    ) {
      throw new DyadError(
        "Invalid app preview origin",
        DyadErrorKind.Validation,
      );
    }
    const key = JSON.stringify([
      input.appId,
      input.processId,
      input.invocationRef?.operationId,
      input.target,
      input.origin,
    ]);
    const existing = this.pending.get(key);
    if (existing) return abortable(existing, input.signal);
    // The runtime owns cancellation. Slow requests must not be abandoned on
    // a timer: previews remain usable while registration runs in the background.
    const signal = input.signal;
    const work = (async () => {
      signal.throwIfAborted();
      await abortable(
        retryOnLocked(
          () =>
            this.register({ ...input.target, origin: input.origin, signal }),
          "Register Neon preview origin",
          { signal },
        ),
        signal,
      );
      signal.throwIfAborted();
    })();
    this.pending.set(key, work);
    const cleanup = () => {
      if (this.pending.get(key) === work) this.pending.delete(key);
    };
    void work.then(cleanup, cleanup);
    return work;
  }
}

export const neonPreviewDomainService = new NeonPreviewDomainService();

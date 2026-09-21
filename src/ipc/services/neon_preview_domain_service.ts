import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { getDyadAppPath } from "@/paths/paths";
import type { AppRunInvocationRef } from "@/app_run/state";
import { getAppPreviewHostname } from "../../../shared/preview_hostname";
import { readEnvVarsOrEmpty } from "../utils/app_env_var_utils";
import { ensureNeonAuthTrustedDomain } from "../utils/neon_utils";
import { abortable } from "../utils/abortable";

export interface NeonPreviewTarget {
  projectId: string;
  branchId: string;
}

/** Capture under runtime-config/provider admission, before spawning the app. */
export async function resolveNeonPreviewTarget(
  appId: number,
): Promise<NeonPreviewTarget | null> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app?.neonProjectId) return null;
  const env = await readEnvVarsOrEmpty({ appPath: getDyadAppPath(app.path) });
  if (!env.some(({ key, value }) => key === "NEON_AUTH_BASE_URL" && value))
    return null;
  const branchId = app.neonActiveBranchId ?? app.neonDevelopmentBranchId;
  if (!branchId) throw new Error("The active Neon Auth branch is unavailable.");
  return { projectId: app.neonProjectId, branchId };
}

export const NEON_PREVIEW_REGISTRATION_TIMEOUT_MS = 10_000;

export class NeonPreviewDomainService {
  private readonly pending = new Map<string, Promise<void>>();

  constructor(
    private readonly register = ensureNeonAuthTrustedDomain,
    private readonly timeoutMs = NEON_PREVIEW_REGISTRATION_TIMEOUT_MS,
  ) {}

  ensure(input: {
    appId: number;
    processId: number;
    invocationRef?: AppRunInvocationRef;
    target: NeonPreviewTarget;
    origin: string;
    signal: AbortSignal;
  }): Promise<void> {
    const url = new URL(input.origin);
    if (
      url.protocol !== "http:" ||
      url.hostname !== getAppPreviewHostname(input.appId) ||
      !url.port ||
      url.origin !== input.origin
    ) {
      return Promise.reject(new Error("Invalid app preview origin"));
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
    const signal = AbortSignal.any([
      input.signal,
      AbortSignal.timeout(this.timeoutMs),
    ]);
    const work = (async () => {
      signal.throwIfAborted();
      await abortable(
        this.register({ ...input.target, origin: input.origin, signal }),
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

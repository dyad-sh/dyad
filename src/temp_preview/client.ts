import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { TempPreviewBundleFile } from "./bundle";

const SessionSchema = z.object({
  sessionId: z.string(),
  tempId: z.string(),
  uploadToken: z.string(),
  uploads: z.array(
    z.object({
      path: z.string(),
      status: z.enum(["expected", "uploaded"]),
      url: z.string().url(),
    }),
  ),
  skipped: z.array(z.string()),
});

const FinalizedPublishSchema = z.object({
  success: z.literal(true),
  tempId: z.string(),
  versionId: z.string(),
  canonicalUrl: z.string().url(),
  expiresAt: z.string().nullable(),
  updateToken: z.string().optional(),
});

const FINALIZE_RETRY_DELAYS_MS = [250, 1_000] as const;

export interface TempPreviewConnection {
  tempId: string;
  canonicalUrl: string;
  updateToken: string;
  expiresAt: string | null;
}

export type TempmdRequestPhase =
  | "session"
  | "upload"
  | "finalize"
  | "revoke"
  | "request";

export class TempmdApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly phase: TempmdRequestPhase = "request",
  ) {
    super(message);
    this.name = "TempmdApiError";
  }
}

export class TempmdClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl = "https://api.temp.md",
    private readonly fetcher: typeof fetch = fetch,
    private readonly delay: (
      milliseconds: number,
    ) => Promise<void> = waitForDelay,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async publish(input: {
    files: TempPreviewBundleFile[];
    title: string;
    previous?: TempPreviewConnection;
  }): Promise<TempPreviewConnection> {
    const session = SessionSchema.parse(
      await this.json(
        "/publish-sessions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": randomUUID(),
            ...(input.previous
              ? { Authorization: `Bearer ${input.previous.updateToken}` }
              : {}),
          },
          body: JSON.stringify({
            files: input.files.map((file) => ({
              path: file.path,
              size: file.size,
              contentType: file.contentType,
              hash: file.hash,
            })),
            title: input.title,
            spaMode: true,
            ...(input.previous ? { tempId: input.previous.tempId } : {}),
          }),
        },
        "session",
      ),
    );

    const outstanding = session.uploads.filter(
      (upload) => upload.status === "expected",
    );
    await uploadConcurrently(outstanding, async (upload) => {
      const file = input.files.find(
        (candidate) => candidate.path === upload.path,
      );
      if (!file) {
        throw new Error(`The local build no longer contains ${upload.path}.`);
      }
      const response = await this.request(
        upload.url,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${session.uploadToken}`,
            "Content-Type": file.contentType,
            "Content-Length": String(file.size),
          },
          body: file.contents,
        },
        120_000,
        `Upload failed for ${file.path}`,
        "upload",
      );
      if (!response.ok) {
        await throwApiError(
          response,
          `Upload failed for ${file.path}`,
          "upload",
        );
      }
    });

    const finalized = await this.finalizeSession(
      session.sessionId,
      session.uploadToken,
      Boolean(input.previous),
    );
    const updateToken = finalized.updateToken ?? input.previous?.updateToken;
    if (!updateToken) {
      throw new Error("temp.md did not return an update capability.");
    }
    return {
      tempId: finalized.tempId,
      canonicalUrl: finalized.canonicalUrl,
      updateToken,
      expiresAt: finalized.expiresAt,
    };
  }

  async revoke(connection: TempPreviewConnection): Promise<void> {
    await this.json(
      `/temps/${encodeURIComponent(connection.tempId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${connection.updateToken}` },
      },
      "revoke",
    );
  }

  private async finalizeSession(
    sessionId: string,
    uploadToken: string,
    canReusePreviousToken: boolean,
  ): Promise<z.infer<typeof FinalizedPublishSchema>> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const finalized = FinalizedPublishSchema.parse(
          await this.json(
            `/publish-sessions/${encodeURIComponent(sessionId)}/finalize`,
            {
              method: "POST",
              headers: { Authorization: `Bearer ${uploadToken}` },
            },
            "finalize",
          ),
        );
        if (!canReusePreviousToken && !finalized.updateToken) {
          throw new TempmdApiError(
            "temp.md returned an invalid response",
            200,
            "invalid_response",
            "finalize",
          );
        }
        return finalized;
      } catch (error) {
        const normalized =
          error instanceof z.ZodError
            ? new TempmdApiError(
                "temp.md returned an invalid response",
                200,
                "invalid_response",
                "finalize",
              )
            : error;
        const retryDelay = FINALIZE_RETRY_DELAYS_MS[attempt];
        if (retryDelay === undefined || !isAmbiguousFinalizeError(normalized)) {
          throw normalized;
        }
        await this.delay(retryDelay);
      }
    }
  }

  private async json(
    path: string,
    init: RequestInit,
    phase: TempmdRequestPhase,
  ): Promise<unknown> {
    const response = await this.request(
      `${this.baseUrl}${path}`,
      init,
      60_000,
      "temp.md request failed",
      phase,
    );
    if (!response.ok) {
      await throwApiError(response, "temp.md request failed", phase);
    }
    return readJsonResponse(
      response,
      "temp.md returned an invalid response",
      phase,
    );
  }

  private async request(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    fallback: string,
    phase: TempmdRequestPhase,
  ): Promise<Response> {
    try {
      return await this.fetcher(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw transportError(error, fallback, phase);
    }
  }
}

function isAmbiguousFinalizeError(error: unknown): boolean {
  return (
    error instanceof TempmdApiError &&
    error.phase === "finalize" &&
    (error.status === 0 ||
      error.status === 408 ||
      error.status >= 500 ||
      error.code === "invalid_response")
  );
}

function waitForDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readJsonResponse(
  response: Response,
  fallback: string,
  phase: TempmdRequestPhase,
): Promise<unknown> {
  let contents: string;
  try {
    contents = await response.text();
  } catch (error) {
    throw transportError(error, fallback, phase);
  }
  if (contents.trim() === "") return null;
  try {
    return JSON.parse(contents);
  } catch {
    throw new TempmdApiError(
      fallback,
      response.status,
      "invalid_response",
      phase,
    );
  }
}

function transportError(
  error: unknown,
  fallback: string,
  phase: TempmdRequestPhase,
): TempmdApiError {
  return new TempmdApiError(
    error instanceof Error ? error.message : fallback,
    0,
    "transport_error",
    phase,
  );
}

async function throwApiError(
  response: Response,
  fallback: string,
  phase: TempmdRequestPhase,
): Promise<never> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const record =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const message =
    typeof record.message === "string"
      ? record.message
      : typeof record.error === "string"
        ? record.error
        : fallback;
  throw new TempmdApiError(
    message,
    response.status,
    typeof record.code === "string" ? record.code : undefined,
    phase,
  );
}

async function uploadConcurrently<T>(
  values: T[],
  worker: (value: T) => Promise<void>,
  concurrency = 4,
): Promise<void> {
  let next = 0;
  const failure: { occurred: boolean; reason?: unknown } = {
    occurred: false,
  };
  const runners = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (next < values.length && !failure.occurred) {
        const index = next++;
        try {
          await worker(values[index]);
        } catch (error) {
          if (!failure.occurred) {
            failure.occurred = true;
            failure.reason = error;
          }
        }
      }
    },
  );
  await Promise.all(runners);
  if (failure.occurred) throw failure.reason;
}

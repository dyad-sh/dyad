import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
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

export interface TempPreviewConnection {
  tempId: string;
  canonicalUrl: string;
  updateToken: string;
  expiresAt: string | null;
}

export class TempmdApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
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
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async publish(input: {
    files: TempPreviewBundleFile[];
    title: string;
    previous?: TempPreviewConnection;
  }): Promise<TempPreviewConnection> {
    const session = SessionSchema.parse(
      await this.json("/publish-sessions", {
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
      }),
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
          body: new Uint8Array(await readFile(file.absolutePath)),
        },
        120_000,
        `Upload failed for ${file.path}`,
      );
      if (!response.ok) {
        await throwApiError(response, `Upload failed for ${file.path}`);
      }
    });

    const finalized = FinalizedPublishSchema.parse(
      await this.json(
        `/publish-sessions/${encodeURIComponent(session.sessionId)}/finalize`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${session.uploadToken}` },
        },
      ),
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
    await this.json(`/temps/${encodeURIComponent(connection.tempId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${connection.updateToken}` },
    });
  }

  private async json(path: string, init: RequestInit): Promise<unknown> {
    const response = await this.request(
      `${this.baseUrl}${path}`,
      init,
      60_000,
      "temp.md request failed",
    );
    if (!response.ok) {
      await throwApiError(response, "temp.md request failed");
    }
    return readJsonResponse(response, "temp.md returned an invalid response");
  }

  private async request(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    fallback: string,
  ): Promise<Response> {
    try {
      return await this.fetcher(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw transportError(error, fallback);
    }
  }
}

async function readJsonResponse(
  response: Response,
  fallback: string,
): Promise<unknown> {
  let contents: string;
  try {
    contents = await response.text();
  } catch (error) {
    throw transportError(error, fallback);
  }
  if (contents.trim() === "") return null;
  try {
    return JSON.parse(contents);
  } catch {
    throw new TempmdApiError(fallback, response.status, "invalid_response");
  }
}

function transportError(error: unknown, fallback: string): TempmdApiError {
  return new TempmdApiError(
    error instanceof Error ? error.message : fallback,
    0,
    "transport_error",
  );
}

async function throwApiError(
  response: Response,
  fallback: string,
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
  );
}

async function uploadConcurrently<T>(
  values: T[],
  worker: (value: T) => Promise<void>,
  concurrency = 4,
): Promise<void> {
  let next = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (next < values.length) {
        const index = next++;
        await worker(values[index]);
      }
    },
  );
  const results = await Promise.allSettled(runners);
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failure) throw failure.reason;
}

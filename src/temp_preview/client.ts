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
      const response = await this.fetcher(upload.url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${session.uploadToken}`,
          "Content-Type": file.contentType,
          "Content-Length": String(file.size),
        },
        body: new Uint8Array(await readFile(file.absolutePath)),
        signal: AbortSignal.timeout(120_000),
      });
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
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw new TempmdApiError(
        error instanceof Error ? error.message : "temp.md request failed",
        0,
      );
    }
    if (!response.ok) {
      await throwApiError(response, "temp.md request failed");
    }
    return response.json();
  }
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
  await Promise.all(runners);
}

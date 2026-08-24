import { describe, expect, it, vi } from "vitest";
import type { TempPreviewBundleFile } from "./bundle";
import { TempmdApiError, TempmdClient } from "./client";

function createBundleFile(path = "index.html"): TempPreviewBundleFile {
  const contents = new TextEncoder().encode("hello");
  return {
    path,
    size: contents.byteLength,
    contentType: "text/html",
    hash: `hash-${path}`,
    contents,
  };
}

describe("TempmdClient", () => {
  it("creates, uploads and finalizes a temporary preview without exposing capabilities", async () => {
    const file = createBundleFile();
    const fetcher = vi.fn<typeof fetch>();
    fetcher
      .mockResolvedValueOnce(
        Response.json({
          sessionId: "session-1",
          tempId: "temp-1",
          uploadToken: "upload-secret",
          uploads: [
            {
              path: "index.html",
              status: "expected",
              url: "https://uploads.temp.md/index.html",
            },
          ],
          skipped: [],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        Response.json({
          success: true,
          tempId: "temp-1",
          versionId: "version-1",
          canonicalUrl: "https://example.temp.md",
          expiresAt: "2026-08-30T00:00:00.000Z",
          updateToken: "update-secret",
        }),
      );

    const result = await new TempmdClient(
      "https://api.temp.md",
      fetcher,
    ).publish({
      title: "Demo",
      files: [file],
    });

    expect(result).toEqual({
      tempId: "temp-1",
      canonicalUrl: "https://example.temp.md",
      expiresAt: "2026-08-30T00:00:00.000Z",
      updateToken: "update-secret",
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://uploads.temp.md/index.html",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          Authorization: "Bearer upload-secret",
        }),
      }),
    );
    const uploadBody = fetcher.mock.calls[1][1]?.body;
    expect(uploadBody).toBe(file.contents);
    expect(new TextDecoder().decode(uploadBody as Uint8Array)).toBe("hello");
  });

  it("normalizes malformed publish-session responses", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        sessionId: "session-1",
        tempId: "temp-1",
        uploadToken: "upload-secret",
        uploads: [],
      }),
    );

    await expect(
      new TempmdClient("https://api.temp.md", fetcher).publish({
        title: "Demo",
        files: [],
      }),
    ).rejects.toMatchObject({
      message: "temp.md returned an invalid response",
      status: 200,
      code: "invalid_response",
      phase: "session",
    });
  });

  it("uses the scoped update capability for update and revoke requests", async () => {
    const fetcher = vi.fn<typeof fetch>();
    fetcher
      .mockResolvedValueOnce(
        Response.json({
          sessionId: "session-2",
          tempId: "temp-1",
          uploadToken: "upload-secret",
          uploads: [],
          skipped: ["index.html"],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          success: true,
          tempId: "temp-1",
          versionId: "version-2",
          canonicalUrl: "https://example.temp.md",
          expiresAt: null,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new TempmdClient("https://api.temp.md", fetcher);
    const previous = {
      tempId: "temp-1",
      canonicalUrl: "https://example.temp.md",
      updateToken: "update-secret",
      expiresAt: null,
    };

    await client.publish({ title: "Demo", files: [], previous });
    await client.revoke(previous);

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "https://api.temp.md/publish-sessions",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer update-secret",
        }),
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      "https://api.temp.md/temps/temp-1",
      expect.objectContaining({
        method: "DELETE",
        headers: { Authorization: "Bearer update-secret" },
      }),
    );
  });

  it("does not reuse a previous capability for a different finalized preview", async () => {
    const retryDelay = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi.fn<typeof fetch>();
    const mismatchedFinalize = () =>
      Response.json({
        success: true,
        tempId: "temp-2",
        versionId: "version-2",
        canonicalUrl: "https://different.temp.md",
        expiresAt: "2026-08-30T00:00:00.000Z",
      });
    fetcher
      .mockResolvedValueOnce(
        Response.json({
          sessionId: "session-2",
          tempId: "temp-2",
          uploadToken: "upload-secret",
          uploads: [],
          skipped: [],
        }),
      )
      .mockResolvedValueOnce(mismatchedFinalize())
      .mockResolvedValueOnce(mismatchedFinalize())
      .mockResolvedValueOnce(mismatchedFinalize());

    await expect(
      new TempmdClient("https://api.temp.md", fetcher, retryDelay).publish({
        title: "Demo",
        files: [],
        previous: {
          tempId: "temp-1",
          canonicalUrl: "https://example.temp.md",
          updateToken: "old-update-secret",
          expiresAt: null,
        },
      }),
    ).rejects.toMatchObject({
      status: 200,
      code: "invalid_response",
      phase: "finalize",
    });

    expect(retryDelay).toHaveBeenNthCalledWith(1, 250);
    expect(retryDelay).toHaveBeenNthCalledWith(2, 1_000);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("retries an ambiguous finalize result with the same publish session", async () => {
    const retryDelay = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi.fn<typeof fetch>();
    fetcher
      .mockResolvedValueOnce(
        Response.json({
          sessionId: "session-1",
          tempId: "temp-1",
          uploadToken: "upload-secret",
          uploads: [],
          skipped: [],
        }),
      )
      .mockRejectedValueOnce(new TypeError("connection closed"))
      .mockResolvedValueOnce(
        Response.json({
          success: true,
          tempId: "temp-1",
          versionId: "version-1",
          canonicalUrl: "https://example.temp.md",
          expiresAt: "2026-08-30T00:00:00.000Z",
          updateToken: "update-secret",
        }),
      );

    await expect(
      new TempmdClient("https://api.temp.md", fetcher, retryDelay).publish({
        title: "Demo",
        files: [],
      }),
    ).resolves.toMatchObject({
      tempId: "temp-1",
      updateToken: "update-secret",
    });

    expect(retryDelay).toHaveBeenCalledWith(250);
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://api.temp.md/publish-sessions/session-1/finalize",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer upload-secret" },
      }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      "https://api.temp.md/publish-sessions/session-1/finalize",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer upload-secret" },
      }),
    );
  });

  it("does not retry a definitive finalize rejection", async () => {
    const retryDelay = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi.fn<typeof fetch>();
    fetcher
      .mockResolvedValueOnce(
        Response.json({
          sessionId: "session-1",
          tempId: "temp-1",
          uploadToken: "upload-secret",
          uploads: [],
          skipped: [],
        }),
      )
      .mockResolvedValueOnce(
        Response.json(
          { error: "Publish session expired", code: "session_expired" },
          { status: 410 },
        ),
      );

    await expect(
      new TempmdClient("https://api.temp.md", fetcher, retryDelay).publish({
        title: "Demo",
        files: [],
      }),
    ).rejects.toMatchObject({
      status: 410,
      code: "session_expired",
      phase: "finalize",
    });

    expect(retryDelay).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 4xx response whose server code is invalid_response", async () => {
    const retryDelay = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi.fn<typeof fetch>();
    fetcher
      .mockResolvedValueOnce(
        Response.json({
          sessionId: "session-1",
          tempId: "temp-1",
          uploadToken: "upload-secret",
          uploads: [],
          skipped: [],
        }),
      )
      .mockResolvedValueOnce(
        Response.json(
          { error: "Invalid request", code: "invalid_response" },
          { status: 400 },
        ),
      );

    await expect(
      new TempmdClient("https://api.temp.md", fetcher, retryDelay).publish({
        title: "Demo",
        files: [],
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "invalid_response",
      phase: "finalize",
    });

    expect(retryDelay).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("classifies upload transport failures", async () => {
    const file = createBundleFile();
    const fetcher = vi.fn<typeof fetch>();
    fetcher
      .mockResolvedValueOnce(
        Response.json({
          sessionId: "session-1",
          tempId: "temp-1",
          uploadToken: "upload-secret",
          uploads: [
            {
              path: "index.html",
              status: "expected",
              url: "https://uploads.temp.md/index.html",
            },
          ],
          skipped: [],
        }),
      )
      .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));

    const result = new TempmdClient("https://api.temp.md", fetcher).publish({
      title: "Demo",
      files: [file],
    });

    await expect(result).rejects.toMatchObject({
      name: "TempmdApiError",
      status: 0,
      code: "transport_error",
      phase: "upload",
    } satisfies Partial<TempmdApiError>);
  });

  it("waits for in-flight uploads but skips queued work after a failure", async () => {
    const files = Array.from({ length: 5 }, (_, index) =>
      createBundleFile(`file-${index + 1}.html`),
    );
    let releaseInFlightUploads!: () => void;
    const inFlightUpload = new Promise<Response>((resolve) => {
      releaseInFlightUploads = () =>
        resolve(new Response(null, { status: 200 }));
    });
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      if (url === "https://api.temp.md/publish-sessions") {
        return Response.json({
          sessionId: "session-1",
          tempId: "temp-1",
          uploadToken: "upload-secret",
          uploads: files.map((file, index) => ({
            path: file.path,
            status: "expected",
            url: `https://uploads.temp.md/${index + 1}`,
          })),
          skipped: [],
        });
      }
      if (url === "https://uploads.temp.md/1") {
        return new Response("failed", { status: 500 });
      }
      if (
        url === "https://uploads.temp.md/2" ||
        url === "https://uploads.temp.md/3" ||
        url === "https://uploads.temp.md/4"
      ) {
        return inFlightUpload;
      }
      if (url === "https://uploads.temp.md/5") {
        return new Response(null, { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    let settled = false;
    const publish = new TempmdClient("https://api.temp.md", fetcher)
      .publish({
        title: "Demo",
        files,
      })
      .finally(() => {
        settled = true;
      });

    await vi.waitFor(() => {
      expect(fetcher).toHaveBeenCalledWith(
        "https://uploads.temp.md/2",
        expect.anything(),
      );
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseInFlightUploads();
    await expect(publish).rejects.toBeInstanceOf(TempmdApiError);
    expect(settled).toBe(true);
    expect(fetcher).not.toHaveBeenCalledWith(
      "https://uploads.temp.md/5",
      expect.anything(),
    );
  });

  it("classifies invalid success response bodies", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("not-json", { status: 200 }));

    const result = new TempmdClient("https://api.temp.md", fetcher).publish({
      title: "Demo",
      files: [],
    });

    await expect(result).rejects.toMatchObject({
      name: "TempmdApiError",
      status: 200,
      code: "invalid_response",
      phase: "session",
    } satisfies Partial<TempmdApiError>);
  });
});

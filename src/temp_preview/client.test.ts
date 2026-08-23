import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TempmdApiError, TempmdClient } from "./client";

const clientRoots: string[] = [];

async function createClientFile(name = "index.html"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dyad-tempmd-client-"));
  clientRoots.push(root);
  const absolutePath = join(root, name);
  await writeFile(absolutePath, "hello");
  return absolutePath;
}

describe("TempmdClient", () => {
  afterEach(async () => {
    await Promise.all(
      clientRoots
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("creates, uploads and finalizes a temporary preview without exposing capabilities", async () => {
    const absolutePath = await createClientFile();
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
      files: [
        {
          absolutePath,
          path: "index.html",
          size: 5,
          contentType: "text/html",
          hash: "hash",
        },
      ],
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

  it("classifies upload transport failures", async () => {
    const absolutePath = await createClientFile();
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
      files: [
        {
          absolutePath,
          path: "index.html",
          size: 5,
          contentType: "text/html",
          hash: "hash",
        },
      ],
    });

    await expect(result).rejects.toMatchObject({
      name: "TempmdApiError",
      status: 0,
      code: "transport_error",
    } satisfies Partial<TempmdApiError>);
  });

  it("waits for sibling uploads to settle before rejecting", async () => {
    const firstPath = await createClientFile("first.html");
    const secondPath = await createClientFile("second.html");
    let releaseSecondUpload!: () => void;
    const secondUpload = new Promise<Response>((resolve) => {
      releaseSecondUpload = () => resolve(new Response(null, { status: 200 }));
    });
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      if (url === "https://api.temp.md/publish-sessions") {
        return Response.json({
          sessionId: "session-1",
          tempId: "temp-1",
          uploadToken: "upload-secret",
          uploads: [
            {
              path: "first.html",
              status: "expected",
              url: "https://uploads.temp.md/first.html",
            },
            {
              path: "second.html",
              status: "expected",
              url: "https://uploads.temp.md/second.html",
            },
          ],
          skipped: [],
        });
      }
      if (url === "https://uploads.temp.md/first.html") {
        return new Response("failed", { status: 500 });
      }
      if (url === "https://uploads.temp.md/second.html") {
        return secondUpload;
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    let settled = false;
    const publish = new TempmdClient("https://api.temp.md", fetcher)
      .publish({
        title: "Demo",
        files: [
          {
            absolutePath: firstPath,
            path: "first.html",
            size: 5,
            contentType: "text/html",
            hash: "hash-1",
          },
          {
            absolutePath: secondPath,
            path: "second.html",
            size: 5,
            contentType: "text/html",
            hash: "hash-2",
          },
        ],
      })
      .finally(() => {
        settled = true;
      });

    await vi.waitFor(() => {
      expect(fetcher).toHaveBeenCalledWith(
        "https://uploads.temp.md/second.html",
        expect.anything(),
      );
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseSecondUpload();
    await expect(publish).rejects.toBeInstanceOf(TempmdApiError);
    expect(settled).toBe(true);
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
    } satisfies Partial<TempmdApiError>);
  });
});

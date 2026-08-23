import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TempmdClient } from "./client";

describe("TempmdClient", () => {
  it("creates, uploads and finalizes a temporary preview without exposing capabilities", async () => {
    const root = await mkdtemp(join(tmpdir(), "dyad-tempmd-client-"));
    const absolutePath = join(root, "index.html");
    await writeFile(absolutePath, "hello");
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
      .mockResolvedValueOnce(Response.json({ ok: true }));
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
});

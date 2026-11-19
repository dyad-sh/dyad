import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectBuildFiles,
  findBuildOutputDir,
  isValidDeedPageSlug,
  publishBuildToDeedPage,
  suggestDeedPageSlug,
} from "./publish";

function makeApp(files: Record<string, string | Buffer>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-deedpage-"));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return root;
}

/** A stand-in for the deed.page upload API that records every request. */
function fakeDeedPage({ alreadyStored = [] as string[] } = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (url.startsWith("https://deed.page/v1/uploads?")) {
      const manifest = JSON.parse(String(init?.body));
      return Response.json({
        ok: true,
        missing: manifest.files
          .filter((f: { path: string }) => !alreadyStored.includes(f.path))
          .map((f: { sha256: string }) => ({
            sha256: f.sha256,
            upload: {
              url: `https://blobs.test/${f.sha256}`,
              headers: { "x-up": "1" },
            },
          })),
        finalize_url: "https://deed.page/v1/uploads/s1/finalize",
      });
    }
    if (url.startsWith("https://blobs.test/")) {
      const body = Buffer.from(init?.body as Uint8Array);
      const sha = createHash("sha256").update(body).digest("hex");
      return new Response(null, {
        status: sha === url.split("/").pop() ? 200 : 400,
      });
    }
    if (url.endsWith("/finalize")) {
      return Response.json({
        ok: true,
        url: "https://my-app-abc.deed.page/",
        slug: "my-app-abc",
        version: headers.Authorization ? "v2" : "v1",
        ...(headers.Authorization ? {} : { token: "deed_tok_new" }),
      });
    }
    return Response.json({ ok: false, message: "unexpected" }, { status: 500 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("suggestDeedPageSlug", () => {
  it("turns an app name into a valid slug", () => {
    expect(suggestDeedPageSlug("My Todo App!", "k3j9x2")).toBe(
      "my-todo-app-k3j9x2",
    );
    expect(isValidDeedPageSlug(suggestDeedPageSlug("---", "ab"))).toBe(true);
    expect(
      suggestDeedPageSlug("x".repeat(100), "abcdef").length,
    ).toBeLessThanOrEqual(63);
  });
});

describe("findBuildOutputDir", () => {
  it("prefers dist, then build, then out, and needs an index.html", async () => {
    expect(
      await findBuildOutputDir(makeApp({ "src/main.tsx": "" })),
    ).toBeNull();
    const app = makeApp({
      "dist/assets/a.js": "",
      "build/index.html": "<h1>b</h1>",
    });
    expect(await findBuildOutputDir(app)).toBe(path.join(app, "build"));
    const vite = makeApp({
      "dist/index.html": "<h1>a</h1>",
      "build/index.html": "",
    });
    expect(await findBuildOutputDir(vite)).toBe(path.join(vite, "dist"));
  });
});

describe("collectBuildFiles", () => {
  it("lists nested files with POSIX paths and content types", async () => {
    const app = makeApp({
      "dist/index.html": "<h1>hi</h1>",
      "dist/assets/logo.png": Buffer.from([0x89, 0x50]),
    });
    const files = await collectBuildFiles(path.join(app, "dist"));
    expect(files.map((f) => [f.path, f.contentType])).toEqual([
      ["assets/logo.png", "image/png"],
      ["index.html", "text/html; charset=utf-8"],
    ]);
  });
});

describe("publishBuildToDeedPage", () => {
  const app = makeApp({
    "dist/index.html": "<h1>hi</h1>",
    "dist/assets/app.js": "console.log(1)",
  });
  const dir = path.join(app, "dist");

  it("uploads only missing files and returns the token from a first publish", async () => {
    const { calls, fetchImpl } = fakeDeedPage({
      alreadyStored: ["assets/app.js"],
    });
    const result = await publishBuildToDeedPage({
      dir,
      slug: "my-app-abc",
      fetchImpl,
    });

    expect(result).toEqual({
      url: "https://my-app-abc.deed.page/",
      slug: "my-app-abc",
      version: "v1",
      token: "deed_tok_new",
    });
    expect(calls.map((c) => c.url)).toEqual([
      "https://deed.page/v1/uploads?ref=partner_dyad",
      expect.stringMatching(/^https:\/\/blobs\.test\//),
      "https://deed.page/v1/uploads/s1/finalize",
    ]);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers["X-Client"]).toBe("dyad");
  });

  it("sends the saved token to update the site", async () => {
    const { calls, fetchImpl } = fakeDeedPage();
    const result = await publishBuildToDeedPage({
      dir,
      slug: "my-app-abc",
      token: "deed_tok_saved",
      fetchImpl,
    });

    expect(result.version).toBe("v2");
    expect(result.token).toBeUndefined();
    expect(
      (calls[0].init.headers as Record<string, string>).Authorization,
    ).toBe("Bearer deed_tok_saved");
    expect(
      (calls.at(-1)!.init.headers as Record<string, string>).Authorization,
    ).toBe("Bearer deed_tok_saved");
  });

  it("surfaces deed.page error messages", async () => {
    const fetchImpl = (async () =>
      Response.json(
        { ok: false, message: "That site name belongs to someone else." },
        { status: 403 },
      )) as typeof fetch;
    await expect(
      publishBuildToDeedPage({ dir, slug: "taken", fetchImpl }),
    ).rejects.toThrow("That site name belongs to someone else.");
  });

  it("rejects an invalid slug before any request", async () => {
    const { calls, fetchImpl } = fakeDeedPage();
    await expect(
      publishBuildToDeedPage({ dir, slug: "Bad Slug", fetchImpl }),
    ).rejects.toThrow(/valid/);
    expect(calls).toHaveLength(0);
  });
});

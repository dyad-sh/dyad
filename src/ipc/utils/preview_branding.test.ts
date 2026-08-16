import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyPreviewBrandingToHtml,
  ensurePreviewBranding,
  PREVIEW_APP_TITLE,
  PREVIEW_FAVICON_PATH,
} from "./preview_branding";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("generated app preview branding", () => {
  it("replaces the browser title and any existing favicon", () => {
    const branded = applyPreviewBrandingToHtml(`<!doctype html>
<html><head><link rel="icon" href="/vite.svg"><title>dyad-generated-app</title></head></html>`);

    expect(branded).toContain(`<title>${PREVIEW_APP_TITLE}</title>`);
    expect(branded).toContain(`href="${PREVIEW_FAVICON_PATH}"`);
    expect(branded).not.toContain("dyad-generated-app");
    expect(branded).not.toContain("vite.svg");
  });

  it("adds metadata when the document has no title", () => {
    const branded = applyPreviewBrandingToHtml(
      "<!doctype html><html><head></head><body></body></html>",
    );
    expect(branded).toContain(`<title>${PREVIEW_APP_TITLE}</title>`);
    expect(branded).toContain(`href="${PREVIEW_FAVICON_PATH}"`);
  });

  it("updates an existing generated app before preview", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "meta-human-preview-branding-"),
    );
    temporaryDirectories.push(directory);
    await fs.writeFile(
      path.join(directory, "index.html"),
      "<html><head><title>Old title</title></head><body></body></html>",
    );

    await expect(ensurePreviewBranding(directory)).resolves.toBe(true);
    await expect(
      fs.readFile(path.join(directory, "index.html"), "utf8"),
    ).resolves.toContain(PREVIEW_APP_TITLE);
    await expect(
      fs.readFile(path.join(directory, "public", "meta-human-os.svg"), "utf8"),
    ).resolves.toContain("metaHumanGradient");
  });
});

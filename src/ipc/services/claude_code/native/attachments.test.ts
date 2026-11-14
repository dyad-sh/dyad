// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendAttachmentManifestEntries,
  getDyadMediaDir,
} from "@/ipc/utils/media_path_utils";
import { nativeAttachmentReminder, readsAttachment } from "./attachments";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

async function appWithAttachment() {
  const appPath = await mkdtemp(path.join(tmpdir(), "dyad-native-attach-"));
  directories.push(appPath);
  await mkdir(getDyadMediaDir(appPath), { recursive: true });
  await writeFile(path.join(getDyadMediaDir(appPath), "stored-1.pdf"), "pdf");
  await appendAttachmentManifestEntries(appPath, [
    {
      logicalName: "spec.pdf",
      originalName: "spec.pdf",
      storedFileName: "stored-1.pdf",
      mimeType: "application/pdf",
      sizeBytes: 3,
      createdAt: new Date().toISOString(),
    },
  ]);
  return appPath;
}

describe("native attachment access", () => {
  it("maps mentioned attachments to their files on disk", async () => {
    const appPath = await appWithAttachment();
    const reminder = await nativeAttachmentReminder(
      appPath,
      "Attachments available on disk:\n- attachments:spec.pdf (3 B, application/pdf)",
    );
    expect(reminder).toContain("attachments:spec.pdf → ");
    expect(reminder).toContain(
      JSON.stringify(path.join(getDyadMediaDir(appPath), "stored-1.pdf")),
    );
  });

  it("adds nothing when the prompt mentions no attachments", async () => {
    const appPath = await appWithAttachment();
    expect(await nativeAttachmentReminder(appPath, "Hello")).toBe("");
    expect(
      await nativeAttachmentReminder(appPath, "see attachments:other.png"),
    ).toBe("");
  });

  it("recognizes reads of stored attachments", () => {
    const appPath = path.resolve("/apps/a");
    const media = getDyadMediaDir(appPath);
    expect(
      readsAttachment(appPath, "Read", {
        file_path: path.join(media, "stored-1.pdf"),
      }),
    ).toBe(true);
    expect(readsAttachment(appPath, "Read", { file_path: "src/App.tsx" })).toBe(
      false,
    );
    expect(
      readsAttachment(appPath, "Bash", {
        command: "cp .dyad/media/stored-1.png public/hero.png",
      }),
    ).toBe(true);
    expect(readsAttachment(appPath, "Bash", { command: "ls" })).toBe(false);
  });
});

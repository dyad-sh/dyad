import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { renameWindowsWerHelper } from "./windows_wer";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

it("preserves the Windows crash helper bytes under the executable's name", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dyad-wer-"));
  directories.push(directory);
  await writeFile(path.join(directory, "electron_wer.dll"), "helper-bytes");
  await renameWindowsWerHelper(directory, "win32", "dyad");
  expect(await readFile(path.join(directory, "dyad_wer.dll"), "utf8")).toBe(
    "helper-bytes",
  );
  await expect(
    readFile(path.join(directory, "electron_wer.dll")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("fails packaging if the required Windows helper is absent", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dyad-wer-"));
  directories.push(directory);
  await expect(
    renameWindowsWerHelper(directory, "win32", "dyad"),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await expect(
    renameWindowsWerHelper(directory, "darwin", "dyad"),
  ).resolves.toBeUndefined();
});

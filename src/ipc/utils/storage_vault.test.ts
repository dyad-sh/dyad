import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  initializeLocalVault,
  isLocalVaultReady,
  saveGeneratedImageToLocalVault,
} from "./storage_vault";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => fs.promises.rm(root, { recursive: true, force: true })),
  );
});

describe("local storage vault", () => {
  it("creates an Obsidian-friendly Markdown and media structure", async () => {
    const root = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "meta-human-vault-test-"),
    );
    temporaryRoots.push(root);

    await initializeLocalVault(root);

    expect(isLocalVaultReady(root)).toBe(true);
    expect(fs.existsSync(path.join(root, ".obsidian"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".obsidian", "app.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".meta-human"))).toBe(true);
    expect(fs.existsSync(path.join(root, "Conversations", "Apps"))).toBe(true);
    expect(fs.existsSync(path.join(root, "Notes", "Apps"))).toBe(true);
    expect(fs.existsSync(path.join(root, "Media", "Images"))).toBe(true);
    // Generated media has a dedicated home so images are never scattered.
    expect(fs.existsSync(path.join(root, "Media", "Images", "Generated"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(root, "Media", "Videos", "Generated"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(root, "Notes", "Generated Media"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(root, "Documents"))).toBe(true);
    expect(fs.existsSync(path.join(root, "Attachments"))).toBe(true);
    expect(fs.existsSync(path.join(root, "Conversations.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, "Notes.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, "Media.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, "Documents.md"))).toBe(true);
    expect(
      await fs.promises.readFile(path.join(root, "Media.md"), "utf8"),
    ).toContain("Media/Images/Generated");
    expect(
      await fs.promises.readFile(path.join(root, "Vault Home.md"), "utf8"),
    ).toContain("# Meta Human Vault");
  });

  it("saves generated images directly into the selected vault", async () => {
    const root = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "meta-human-vault-image-test-"),
    );
    temporaryRoots.push(root);

    const data = Buffer.from("generated-image");
    const savedPath = await saveGeneratedImageToLocalVault({
      vaultPath: root,
      fileName: "generated_test.png",
      data,
      prompt: "A test image",
      model: "test/image-model",
    });

    expect(savedPath).toBe(
      path.join(root, "Media", "Images", "Generated", "generated_test.png"),
    );
    expect(await fs.promises.readFile(savedPath)).toEqual(data);
    const note = await fs.promises.readFile(
      path.join(root, "Notes", "Generated Media", "generated_test.md"),
      "utf8",
    );
    expect(note).toContain("![[Media/Images/Generated/generated_test.png]]");
    expect(note).toContain("A test image");
  });
});

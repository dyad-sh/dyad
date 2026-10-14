// @vitest-environment node
import { expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { savePlanToDisk, readPlanFromDisk } from "./planPersistence";

it("keeps the accepted implementation version immutable while the source draft is revised", async () => {
  const appPath = await mkdtemp(path.join(tmpdir(), "dyad-plan-version-"));
  const draft = {
    appPath,
    chatId: 1,
    title: "Plan",
    content: "Accepted steps",
    status: "draft" as const,
  };
  try {
    await savePlanToDisk(draft);
    const slug = await savePlanToDisk({
      ...draft,
      immutableVersion: "a".repeat(64),
    });
    await savePlanToDisk({ ...draft, content: "Unaccepted revision" });
    expect(await readPlanFromDisk({ appPath, chatId: 1 })).toMatchObject({
      content: "Unaccepted revision",
    });
    expect(
      await readFile(
        path.join(appPath, ".dyad", "plans", `${slug}.md`),
        "utf8",
      ),
    ).toContain("Accepted steps");
    await expect(
      savePlanToDisk({ ...draft, immutableVersion: "a".repeat(64) }),
    ).resolves.toBe(slug);
    await expect(
      savePlanToDisk({
        ...draft,
        content: "Changed",
        immutableVersion: "a".repeat(64),
      }),
    ).rejects.toThrow("conflicts");
  } finally {
    await rm(appPath, { recursive: true, force: true });
  }
});

it("loads the same newest legacy draft for display and acceptance, excluding handoff snapshots", async () => {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { loadPlanForChat } = await import("./planPersistence");
  const appPath = await mkdtemp(path.join(tmpdir(), "dyad-legacy-plan-"));
  const directory = path.join(appPath, ".dyad", "plans");
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "chat-1-20260101.md"),
      "---\ntitle: Legacy\nupdatedAt: 2026-01-01\n---\nLegacy steps",
    );
    expect(await loadPlanForChat(appPath, 1)).toMatchObject({
      slug: "chat-1-20260101",
      content: "Legacy steps",
    });
    expect(await readPlanFromDisk({ appPath, chatId: 1 })).toEqual({
      title: "Legacy",
      content: "Legacy steps",
    });
    await savePlanToDisk({
      appPath,
      chatId: 1,
      title: "Snapshot",
      content: "Not a draft",
      status: "accepted",
      immutableVersion: "a".repeat(64),
    });
    expect(await readPlanFromDisk({ appPath, chatId: 1 })).toMatchObject({
      title: "Legacy",
    });
  } finally {
    await rm(appPath, { recursive: true, force: true });
  }
});

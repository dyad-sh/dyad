import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import * as path from "path";
import { prompts as promptsTable } from "@/db/schema";
import { createInMemoryTestDb, type TestDb } from "@/testing/test_db";
import { PromptExpander } from "./prompt_expander";

describe("PromptExpander", () => {
  let db: TestDb;
  let expander: PromptExpander;
  let tmpDir: string;

  beforeEach(() => {
    db = createInMemoryTestDb();
    expander = new PromptExpander({ db });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-expander-test-"));
  });

  afterEach(() => {
    db.$client.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("expandPromptReferences", () => {
    it("inlines @prompt:<id> references", async () => {
      const inserted = db
        .insert(promptsTable)
        .values({ title: "My Prompt", content: "stored prompt content" })
        .run();
      const id = Number(inserted.lastInsertRowid);

      const result = await expander.expandPromptReferences(
        `Do this: @prompt:${id} please`,
      );

      expect(result).toContain("stored prompt content");
      expect(result).not.toContain(`@prompt:${id}`);
    });

    it("leaves unknown references unchanged", async () => {
      const result = await expander.expandPromptReferences("Use @prompt:999");
      expect(result).toBe("Use @prompt:999");
    });

    it("returns prompt unchanged when there are no references", async () => {
      const result = await expander.expandPromptReferences("plain prompt");
      expect(result).toBe("plain prompt");
    });
  });

  describe("expandSlashSkills", () => {
    it("expands /slug references to stored prompt content by slug", () => {
      db.insert(promptsTable)
        .values({
          title: "Webapp Testing",
          content: "webapp testing skill content",
          slug: "webapp-testing",
        })
        .run();

      const result = expander.expandSlashSkills("/webapp-testing run it");

      expect(result).toContain("webapp testing skill content");
    });

    it("leaves unknown slugs unchanged", () => {
      const result = expander.expandSlashSkills("/unknown-skill hello");
      expect(result).toBe("/unknown-skill hello");
    });
  });

  describe("expandImplementPlan", () => {
    it("expands /implement-plan= into the full plan prompt and keeps the short display form", async () => {
      const plansDir = path.join(tmpDir, ".dyad", "plans");
      fs.mkdirSync(plansDir, { recursive: true });
      fs.writeFileSync(
        path.join(plansDir, "my-plan.md"),
        `---\ntitle: My Plan\n---\nStep one. Step two.`,
      );

      const { userPrompt, displayPrompt } = await expander.expandImplementPlan(
        "/implement-plan=my-plan",
        tmpDir,
      );

      expect(displayPrompt).toBe("/implement-plan=my-plan");
      expect(userPrompt).toContain("Please implement the following plan");
      expect(userPrompt).toContain("Step one. Step two.");
      expect(userPrompt).toContain(".dyad/plans/my-plan.md");
    });

    it("returns the prompt unchanged when no plan reference exists", async () => {
      const { userPrompt, displayPrompt } = await expander.expandImplementPlan(
        "normal prompt",
        tmpDir,
      );
      expect(userPrompt).toBe("normal prompt");
      expect(displayPrompt).toBeUndefined();
    });

    it("returns the prompt unchanged when the plan file is missing", async () => {
      const { userPrompt, displayPrompt } = await expander.expandImplementPlan(
        "/implement-plan=does-not-exist",
        tmpDir,
      );
      expect(userPrompt).toBe("/implement-plan=does-not-exist");
      expect(displayPrompt).toBeUndefined();
    });
  });

  describe("appendSelectedComponents", () => {
    it("appends component snippets with an edit marker", async () => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "src", "Button.tsx"),
        ["line1", "line2", "line3", "line4", "line5"].join("\n"),
      );

      const result = await expander.appendSelectedComponents(
        "fix this",
        tmpDir,
        [{ name: "Button", relativePath: "src/Button.tsx", lineNumber: 3 }],
      );

      expect(result).toContain("Selected components:");
      expect(result).toContain("Component: Button (file: src/Button.tsx)");
      expect(result).toContain("line3 // <-- EDIT HERE");
    });

    it("returns the prompt unchanged with no components", async () => {
      const result = await expander.appendSelectedComponents(
        "fix this",
        tmpDir,
        [],
      );
      expect(result).toBe("fix this");
    });

    it("uses a placeholder when the component file is unreadable", async () => {
      const result = await expander.appendSelectedComponents(
        "fix this",
        tmpDir,
        [{ name: "Gone", relativePath: "missing.tsx", lineNumber: 1 }],
      );
      expect(result).toContain("[component snippet not available]");
    });
  });
});

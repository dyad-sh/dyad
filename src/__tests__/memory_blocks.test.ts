import { describe, expect, it } from "vitest";

import {
  activeBlockIds,
  hasBlock,
  listBlockIds,
  readBlockField,
  removeBlock,
  renderBlock,
  stableItemId,
  supersedeBlock,
  upsertBlock,
  type ManagedItem,
} from "@/ipc/utils/memory_blocks";
import {
  canonicalName,
  isSamePerson,
  matchRecord,
  withAlias,
  type NamedRecord,
} from "@/ipc/utils/memory_naming";

const item = (over: Partial<ManagedItem> = {}): ManagedItem => ({
  id: "preference-abc123",
  title: "Prefers local models",
  content: "I prefer running LLMs on my own Mac",
  sourceConversation: "conv-1",
  sourceMessage: "msg-3",
  created: "2026-08-05T00:00:00.000Z",
  lastConfirmed: "2026-08-05T00:00:00.000Z",
  confidence: 0.75,
  authority: "direct-user",
  status: "active",
  ...over,
});

const HAND_WRITTEN = [
  "# Preferences",
  "",
  "My own notes, written by hand.",
  "",
  "## Things I care about",
  "",
  "- Keep everything local where possible.",
  "",
].join("\n");

describe("managed blocks", () => {
  it("records every field a claim can be traced by", () => {
    const block = renderBlock(item());
    for (const field of [
      "- ID: preference-abc123",
      "- Source conversation: conv-1",
      "- Source message: msg-3",
      "- Created: 2026-08-05",
      "- Confidence: 0.75",
      "- Authority: direct-user",
      "- Status: active",
    ]) {
      expect(block).toContain(field);
    }
  });

  it("inserts a block without disturbing hand-written text", () => {
    // The file belongs to the user; we only ever append our own region.
    const updated = upsertBlock(HAND_WRITTEN, item());
    expect(updated).toContain("My own notes, written by hand.");
    expect(updated).toContain("## Things I care about");
    expect(updated).toContain("- Keep everything local where possible.");
    expect(updated).toContain("Prefers local models");
  });

  it("updates a block in place rather than appending a duplicate", () => {
    const once = upsertBlock(HAND_WRITTEN, item());
    const twice = upsertBlock(once, item({ confidence: 0.95 }));

    expect(listBlockIds(twice)).toEqual(["preference-abc123"]);
    expect(readBlockField(twice, "preference-abc123", "Confidence")).toBe(
      "0.95",
    );
  });

  it("leaves surrounding text untouched when updating", () => {
    const once = upsertBlock(HAND_WRITTEN, item());
    const edited = once.replace(
      "My own notes, written by hand.",
      "My own notes, which I edited.",
    );
    const updated = upsertBlock(edited, item({ confidence: 0.9 }));
    expect(updated).toContain("My own notes, which I edited.");
  });

  it("keeps several blocks side by side", () => {
    let document = upsertBlock(HAND_WRITTEN, item());
    document = upsertBlock(document, item({ id: "goal-xyz", title: "Ship" }));
    expect(listBlockIds(document)).toEqual(["preference-abc123", "goal-xyz"]);
  });

  it("removes a block and the content with it", () => {
    // Forgetting must take the words out of the file, not merely flag them.
    const document = upsertBlock(HAND_WRITTEN, item());
    const removed = removeBlock(document, "preference-abc123");

    expect(hasBlock(removed, "preference-abc123")).toBe(false);
    expect(removed).not.toContain("I prefer running LLMs on my own Mac");
    expect(removed).toContain("My own notes, written by hand.");
  });

  it("does not leave a growing gap where a block was", () => {
    const document = upsertBlock(HAND_WRITTEN, item());
    expect(removeBlock(document, "preference-abc123")).not.toMatch(/\n{3,}/);
  });

  it("ignores removal of something that is not there", () => {
    expect(removeBlock(HAND_WRITTEN, "nope")).toBe(HAND_WRITTEN);
  });

  it("supersedes an old item and points at its replacement", () => {
    const document = upsertBlock(HAND_WRITTEN, item());
    const updated = supersedeBlock(
      document,
      "preference-abc123",
      "preference-new",
    );

    expect(readBlockField(updated, "preference-abc123", "Status")).toBe(
      "superseded",
    );
    expect(readBlockField(updated, "preference-abc123", "Superseded by")).toBe(
      "preference-new",
    );
  });

  it("counts only active items", () => {
    let document = upsertBlock(HAND_WRITTEN, item());
    document = upsertBlock(document, item({ id: "b", title: "Other" }));
    document = supersedeBlock(document, "b", "c");

    expect(activeBlockIds(document)).toEqual(["preference-abc123"]);
  });

  it("gives the same statement the same id every run", () => {
    const hash = (value: string) =>
      value
        .split("")
        .reduce((a, c) => a + c.charCodeAt(0), 0)
        .toString(16)
        .padEnd(12, "0");
    expect(stableItemId("preference", "I prefer pnpm", hash)).toBe(
      stableItemId("preference", "  I PREFER PNPM  ", hash),
    );
  });
});

describe("canonical naming", () => {
  it("treats spacing, case and punctuation as presentation", () => {
    const forms = [
      "MetaHuman OS",
      "Meta Human OS",
      "Meta-Human OS",
      "metahuman os",
    ];
    const canonical = forms.map(canonicalName);
    expect(new Set(canonical).size).toBe(1);
  });

  it("matches a project through any of its written forms", () => {
    const records = [{ name: "MetaHuman OS" }];
    for (const form of ["Meta Human OS", "meta-human os", "METAHUMAN OS"]) {
      expect(matchRecord(records, form)).toBe(records[0]);
    }
  });

  it("matches through a recorded alias", () => {
    const records = [{ name: "MetaHuman OS", aliases: ["MHOS"] }];
    expect(matchRecord(records, "mhos")).toBe(records[0]);
  });

  it("does not merge two genuinely different projects", () => {
    // One character apart, and not the same thing.
    expect(matchRecord([{ name: "Helix" }], "Helios")).toBeNull();
    expect(matchRecord([{ name: "Atlas" }], "Atlas Two")).toBeNull();
  });

  it("adds an alias only once", () => {
    let record = withAlias<NamedRecord>({ name: "MetaHuman OS" }, "MHOS");
    record = withAlias(record, "m-h-o-s");
    expect(record.aliases).toHaveLength(1);
  });

  it("does not record an alias that is just the name respaced", () => {
    // "Meta Human OS" and "MetaHuman OS" are already the same canonical name.
    expect(
      withAlias<NamedRecord>({ name: "MetaHuman OS" }, "Meta Human OS").aliases,
    ).toBeUndefined();
  });

  it("does not record an alias identical to the name", () => {
    expect(
      withAlias<NamedRecord>({ name: "Atlas" }, "atlas").aliases,
    ).toBeUndefined();
  });
});

describe("people identity", () => {
  it("matches the same person written differently", () => {
    expect(isSamePerson({ name: "Tiffany" }, { name: "tiffany" })).toBe(true);
  });

  it("does not merge two people who share a first name", () => {
    // Merging would attribute one person's commitments to the other.
    expect(isSamePerson({ name: "Sam Taylor" }, { name: "Sam Rivera" })).toBe(
      false,
    );
  });

  it("does not assume a bare first name is a known full name", () => {
    expect(isSamePerson({ name: "Sam" }, { name: "Sam Taylor" })).toBe(false);
  });

  it("matches a full name through an alias", () => {
    expect(
      isSamePerson(
        { name: "Samantha Taylor", aliases: ["Sam Taylor"] },
        {
          name: "Sam Taylor",
        },
      ),
    ).toBe(true);
  });
});

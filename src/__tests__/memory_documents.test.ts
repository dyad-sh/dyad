import { describe, expect, it } from "vitest";

import {
  conversationFileName,
  conversationHeader,
  mayIndex,
  maySendToCloud,
  parseMemoryDocument,
  readPrivacyFlags,
  renderTurn,
  serialiseMemoryDocument,
  slugify,
  turnsToAppend,
  type ConversationTurn,
} from "@/ipc/utils/memory_documents";

describe("parseMemoryDocument", () => {
  it("separates front matter from prose", () => {
    const { frontMatter, body } = parseMemoryDocument(
      "---\nid: abc\ntype: conversation\n---\n# Title\n\nText.\n",
    );
    expect(frontMatter.id).toBe("abc");
    expect(frontMatter.type).toBe("conversation");
    expect(body).toBe("# Title\n\nText.\n");
  });

  it("reads a block list", () => {
    const { frontMatter } = parseMemoryDocument(
      "---\nparticipants:\n  - user\n  - assistant\n---\nBody\n",
    );
    expect(frontMatter.participants).toEqual(["user", "assistant"]);
  });

  it("reads an inline list and an empty one", () => {
    expect(
      parseMemoryDocument("---\ntags: [ai, memory]\n---\n").frontMatter.tags,
    ).toEqual(["ai", "memory"]);
    expect(
      parseMemoryDocument("---\ntags: []\n---\n").frontMatter.tags,
    ).toEqual([]);
  });

  it("reads booleans as booleans", () => {
    const { frontMatter } = parseMemoryDocument(
      "---\nlocal_only: true\ndo_not_index: false\n---\n",
    );
    expect(frontMatter.local_only).toBe(true);
    expect(frontMatter.do_not_index).toBe(false);
  });

  it("treats a file with no front matter as all body", () => {
    const { frontMatter, body } = parseMemoryDocument("# Just notes\n");
    expect(frontMatter).toEqual({});
    expect(body).toBe("# Just notes\n");
  });

  it("survives a hand-edited file with a malformed line", () => {
    // A user editing their own memory must not be able to break retrieval.
    const { frontMatter, body } = parseMemoryDocument(
      "---\nid: abc\nthis line is not yaml\ntype: person\n---\nBody\n",
    );
    expect(frontMatter.id).toBe("abc");
    expect(frontMatter.type).toBe("person");
    expect(body).toBe("Body\n");
  });

  it("strips quotes from values", () => {
    expect(
      parseMemoryDocument('---\ntitle: "My Chat"\n---\n').frontMatter.title,
    ).toBe("My Chat");
  });
});

describe("serialiseMemoryDocument", () => {
  it("round-trips a document without losing fields", () => {
    const original = {
      frontMatter: {
        id: "abc",
        type: "project-memory",
        tags: ["ai", "electron"],
        local_only: true,
      },
      body: "# Project\n\nNotes.\n",
    };
    const parsed = parseMemoryDocument(serialiseMemoryDocument(original));
    expect(parsed.frontMatter).toEqual(original.frontMatter);
    expect(parsed.body).toBe(original.body);
  });

  it("writes an empty list inline", () => {
    const text = serialiseMemoryDocument({
      frontMatter: { tags: [] },
      body: "x",
    });
    expect(text).toContain("tags: []");
  });
});

describe("privacy flags", () => {
  it("keeps a do-not-index file out of the index", () => {
    expect(mayIndex({ do_not_index: true })).toBe(false);
    expect(mayIndex({})).toBe(true);
  });

  it("keeps a do-not-send file away from cloud models", () => {
    expect(maySendToCloud({ do_not_send_to_cloud: true })).toBe(false);
    expect(maySendToCloud({})).toBe(true);
  });

  it("treats local-only as implying no cloud", () => {
    // Marking something local-only should not require also remembering to
    // mark it do-not-send.
    const flags = readPrivacyFlags({ local_only: true });
    expect(flags.doNotSendToCloud).toBe(true);
    expect(maySendToCloud({ local_only: true })).toBe(false);
  });

  it("still allows local indexing of a local-only file", () => {
    // It never leaves the machine, but local search is the point of it.
    expect(mayIndex({ local_only: true })).toBe(true);
  });
});

describe("conversationFileName", () => {
  it("sorts chronologically and stays readable", () => {
    const name = conversationFileName(
      new Date(2026, 7, 4, 15, 20),
      "Memory system design",
    );
    expect(name).toBe("2026-08-04_15-20_memory-system-design.md");
  });

  it("pads single digits so names sort correctly", () => {
    expect(conversationFileName(new Date(2026, 0, 2, 3, 4), "x")).toBe(
      "2026-01-02_03-04_x.md",
    );
  });

  it("falls back when a title has nothing usable", () => {
    expect(slugify("!!!")).toBe("conversation");
    expect(slugify("")).toBe("conversation");
  });

  it("keeps a long title to a sane length", () => {
    expect(slugify("a".repeat(200)).length).toBeLessThanOrEqual(60);
  });
});

describe("conversationHeader", () => {
  it("carries the metadata retrieval needs", () => {
    const header = conversationHeader({
      id: "conv-1",
      title: "Memory",
      created: "2026-08-04T10:00:00.000Z",
      updated: "2026-08-04T10:00:00.000Z",
      project: "MetaHuman OS",
    });
    const { frontMatter, body } = parseMemoryDocument(header);
    expect(frontMatter.id).toBe("conv-1");
    expect(frontMatter.type).toBe("conversation");
    expect(frontMatter.project).toBe("MetaHuman OS");
    expect(frontMatter.participants).toEqual(["user", "assistant"]);
    expect(body).toContain("# Memory");
  });
});

describe("turnsToAppend", () => {
  const turns: ConversationTurn[] = [
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi there" },
  ];

  it("returns everything for an empty file", () => {
    expect(turnsToAppend("", turns)).toEqual(turns);
  });

  it("returns nothing when every turn is already written", () => {
    const written = turns.map(renderTurn).join("");
    expect(turnsToAppend(written, turns)).toEqual([]);
  });

  it("returns only the new turns", () => {
    const written = renderTurn(turns[0]!);
    expect(turnsToAppend(written, turns)).toEqual([turns[1]]);
  });

  it("does not duplicate when saving twice in a row", () => {
    // The same save running twice — a retry, or a crash-and-resume — must not
    // write the conversation out again.
    const header = conversationHeader({
      id: "c",
      title: "T",
      created: "x",
      updated: "x",
    });
    const file = header + turns.map(renderTurn).join("");
    expect(turnsToAppend(file, turns)).toEqual([]);
  });

  it("handles a message repeated verbatim", () => {
    // "ok" twice is two turns, not one written twice.
    const repeated: ConversationTurn[] = [
      { role: "user", content: "ok" },
      { role: "assistant", content: "Sure" },
      { role: "user", content: "ok" },
    ];
    const written = repeated.slice(0, 2).map(renderTurn).join("");
    expect(turnsToAppend(written, repeated)).toEqual([repeated[2]]);
  });

  it("appends the rest when the file was truncated mid-write", () => {
    // A crash can leave a partial turn; the unmatched turns are rewritten.
    const partial = renderTurn(turns[0]!) + "\n## Assist";
    expect(turnsToAppend(partial, turns)).toEqual([turns[1]]);
  });
});

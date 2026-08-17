import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let vault: string;

vi.mock("electron-log", () => ({
  default: { scope: () => ({ warn: vi.fn(), log: vi.fn(), error: vi.fn() }) },
}));
vi.mock("@/main/settings", () => ({
  readSettings: () => ({ storage: { localVaultPath: vault } }),
}));

const {
  saveConversation,
  forgetConversationFile,
  deleteStoredConversation,
  listStoredConversations,
} = await import("@/ipc/utils/conversation_store");

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "conversation-store-"));
});

afterEach(() => {
  fs.rmSync(vault, { recursive: true, force: true });
});

function conversationFiles(): string[] {
  const directory = path.join(vault, "Memory/Conversations");
  return fs.existsSync(directory) ? fs.readdirSync(directory) : [];
}

function readOnly(): string {
  const [file] = conversationFiles();
  return fs.readFileSync(
    path.join(vault, "Memory/Conversations", file!),
    "utf8",
  );
}

const turns = [
  { role: "user" as const, content: "How does memory work?" },
  { role: "assistant" as const, content: "It is stored as Markdown." },
];

describe("saveConversation", () => {
  it("writes a conversation with front matter and both turns", async () => {
    const saved = await saveConversation("session-1", turns);

    expect(saved).toMatch(/^Memory\/Conversations\/.*\.md$/);
    const text = readOnly();
    expect(text).toContain("type: conversation");
    expect(text).toContain("id: session-1");
    expect(text).toContain("## User");
    expect(text).toContain("How does memory work?");
    expect(text).toContain("## Assistant");
    expect(text).toContain("It is stored as Markdown.");
  });

  it("appends only the new turn on the next save", async () => {
    await saveConversation("session-1", turns);
    await saveConversation("session-1", [
      ...turns,
      { role: "user", content: "Where is it kept?" },
    ]);

    const text = readOnly();
    expect(conversationFiles()).toHaveLength(1);
    expect(text).toContain("Where is it kept?");
    // The turn itself must appear exactly once. The same words also occur in
    // the front matter title and the heading, so count the turn block.
    expect(text.match(/## User\n\nHow does memory work\?/g)).toHaveLength(1);
  });

  it("writes nothing the second time when nothing has changed", async () => {
    await saveConversation("session-1", turns);
    const before = readOnly();
    await saveConversation("session-1", turns);
    expect(readOnly()).toBe(before);
  });

  it("keeps separate conversations in separate files", async () => {
    await saveConversation("session-1", turns);
    await saveConversation("session-2", [
      { role: "user", content: "A different conversation." },
    ]);
    expect(conversationFiles()).toHaveLength(2);
  });

  it("deletes the durable conversation file by session id", async () => {
    await saveConversation("session-1", turns);
    expect(conversationFiles()).toHaveLength(1);

    await expect(deleteStoredConversation("session-1")).resolves.toBe(2);
    expect(conversationFiles()).toHaveLength(0);
  });

  it("loads structured records back from the selected vault", async () => {
    await saveConversation("session-1", turns);

    await expect(listStoredConversations()).resolves.toMatchObject([
      {
        id: "session-1",
        title: "How does memory work?",
        messages: turns,
      },
    ]);
  });

  it("starts a new file once a session is forgotten", async () => {
    await saveConversation("session-1", turns);
    forgetConversationFile("session-1");
    await saveConversation("session-1", [
      { role: "user", content: "Fresh start." },
    ]);
    expect(conversationFiles()).toHaveLength(2);
  });

  it("saves nothing when there are no turns", async () => {
    expect(await saveConversation("session-1", [])).toBeNull();
    expect(conversationFiles()).toHaveLength(0);
  });

  it("creates the conversations folder when it is missing", async () => {
    // A vault that predates the memory tree must still be able to save.
    expect(fs.existsSync(path.join(vault, "Memory"))).toBe(false);
    await saveConversation("session-1", turns);
    expect(conversationFiles()).toHaveLength(1);
  });

  it("reports failure instead of throwing", async () => {
    // Losing a saved turn is a nuisance; taking down the conversation is not
    // acceptable, so a broken vault path must return null quietly.
    fs.rmSync(vault, { recursive: true, force: true });
    fs.writeFileSync(vault, "not a directory");
    await expect(saveConversation("session-x", turns)).resolves.toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { parseDyadCommitTrailers } from "./dyad_commit_trailers";

describe("parseDyadCommitTrailers", () => {
  it("reads the worktree, chat, and every turn a squash holds", () => {
    expect(
      parseDyadCommitTrailers(
        [
          "Add a pricing page",
          "",
          "Squashed 2 commits from dyad/chat-12 into one after the combined code passed its checks.",
          "",
          "Dyad-Chat: 12",
          "Dyad-Workspace: dyad/chat-12",
          "Dyad-Turn: 40",
          "Dyad-Turn: 44",
          "",
        ].join("\n"),
      ),
    ).toEqual({
      chatId: 12,
      workspaceBranch: "dyad/chat-12",
      turnMessageIds: [40, 44],
    });
  });

  it("reads Windows line endings", () => {
    expect(
      parseDyadCommitTrailers(
        "Fix\r\n\r\nDyad-Chat: 3\r\nDyad-Workspace: dyad/chat-3-2\r\nDyad-Turn: 9\r\n",
      ),
    ).toEqual({
      chatId: 3,
      workspaceBranch: "dyad/chat-3-2",
      turnMessageIds: [9],
    });
  });

  it("finds nothing in commits made outside a worktree", () => {
    expect(parseDyadCommitTrailers("Init Dyad app")).toEqual({
      chatId: null,
      workspaceBranch: null,
      turnMessageIds: [],
    });
    // Prose that mentions a trailer is not one.
    expect(
      parseDyadCommitTrailers("Explain what Dyad-Chat: 5 means").chatId,
    ).toBeNull();
  });

  it("never reads a trailer from the subject", () => {
    // A chat summary is the subject; it must not claim another chat.
    expect(parseDyadCommitTrailers("Dyad-Chat: 5").chatId).toBeNull();
    expect(
      parseDyadCommitTrailers(
        [
          "Dyad-Chat: 5",
          "",
          "Requested: add a page",
          "",
          "Dyad-Chat: 12",
          "Dyad-Turn: 40",
          "Dyad-Workspace: dyad/chat-12",
        ].join("\n"),
      ),
    ).toEqual({
      chatId: 12,
      workspaceBranch: "dyad/chat-12",
      turnMessageIds: [40],
    });
    expect(
      parseDyadCommitTrailers(
        "Dyad-Chat: 5\nDyad-Turn: 7\n\nA body without trailers",
      ),
    ).toEqual({ chatId: null, workspaceBranch: null, turnMessageIds: [] });
  });

  it("ignores a last paragraph that mixes prose with trailer lines", () => {
    // Git treats such a paragraph as body text, not trailers.
    expect(
      parseDyadCommitTrailers(
        "Fix\n\nThis was reported in another chat.\nDyad-Chat: 5\nDyad-Turn: 7",
      ),
    ).toEqual({ chatId: null, workspaceBranch: null, turnMessageIds: [] });
  });

  it("keeps trailers alongside other trailers and folded values", () => {
    expect(
      parseDyadCommitTrailers(
        "Fix\n\nSigned-off-by: Someone <someone@example.com>\nDyad-Chat: 5\nNote: a long value\n  continued here\nDyad-Turn: 7",
      ),
    ).toEqual({ chatId: 5, workspaceBranch: null, turnMessageIds: [7] });
  });

  it("rejects a chat id that is not a positive safe integer", () => {
    expect(parseDyadCommitTrailers("Fix\n\nDyad-Chat: 0").chatId).toBeNull();
    expect(
      parseDyadCommitTrailers("Fix\n\nDyad-Chat: 99999999999999999999").chatId,
    ).toBeNull();
  });
});

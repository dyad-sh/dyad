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
});

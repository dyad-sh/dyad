import { describe, expect, it } from "vitest";
import {
  assertAppChatCreationOpen,
  beginAppChatDeletion,
} from "./app_chat_creation_fence";

describe("app chat creation fence", () => {
  it("stays closed until every nested deletion lease is released", () => {
    const releaseFirst = beginAppChatDeletion(7);
    const releaseSecond = beginAppChatDeletion(7);

    expect(() => assertAppChatCreationOpen(7)).toThrowError(
      expect.objectContaining({ kind: "precondition" }),
    );
    releaseFirst();
    expect(() => assertAppChatCreationOpen(7)).toThrowError(
      expect.objectContaining({ kind: "precondition" }),
    );
    releaseSecond();
    expect(() => assertAppChatCreationOpen(7)).not.toThrow();
  });
});

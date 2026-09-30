import { describe, expect, it } from "vitest";
import { defineFrameworkCoveredRemoteMachine } from "./definition";

describe("framework-covered remote machine definitions", () => {
  it("runtime-rejects tracked protocol-v1 definitions without an operation adapter", () => {
    expect(() =>
      defineFrameworkCoveredRemoteMachine({
        id: "widened-protocol-v1-definition",
        remoteIntentDeclaration: {
          intents: {
            start: {
              completion: "tracked-completion",
            },
          },
        },
      } as never),
    ).toThrow(
      "Framework-covered machine widened-protocol-v1-definition declares tracked completion without remoteOperation",
    );
  });
});

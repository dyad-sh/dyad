import { describe, expect, it } from "vitest";
import { sshFailureOf } from "./ssh_failure";

describe("reading a failure off an error", () => {
  it("agrees with the error the client actually throws", async () => {
    // Matched by name so that asking costs no load-time dependency, which
    // means the name is a contract between two files that do not import one
    // another. Renaming it there would quietly stop every check here.
    const { SshError } = await import("@/ipc/utils/ssh_client");
    const { DyadErrorKind } = await import("@/errors/dyad_error");

    expect(
      sshFailureOf(
        new SshError("unreachable", "nothing answered", DyadErrorKind.External),
      ),
    ).toBe("unreachable");
    expect(
      sshFailureOf(
        new SshError("command-timeout", "too slow", DyadErrorKind.External),
      ),
    ).toBe("command-timeout");
  });

  it("says nothing about errors that are not the client's", () => {
    expect(sshFailureOf(new Error("plain"))).toBeNull();
    expect(sshFailureOf(null)).toBeNull();
    expect(sshFailureOf(undefined)).toBeNull();
    expect(
      sshFailureOf({ name: "SshError", failure: "unreachable" }),
    ).toBeNull();
  });

  it("does not answer for one of ours carrying no failure", () => {
    // A shape that passes the name check but has nothing to read.
    const odd = Object.assign(new Error("odd"), { name: "SshError" });
    expect(sshFailureOf(odd)).toBeNull();
  });
});

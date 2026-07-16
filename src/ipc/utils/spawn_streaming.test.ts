import { describe, expect, it } from "vitest";
import { buildSpawnStreamingInvocation } from "./spawn_streaming";

describe("buildSpawnStreamingInvocation", () => {
  it("wraps Windows command shims and preserves grep regex metacharacters", () => {
    expect(
      buildSpawnStreamingInvocation(
        "npx",
        ["playwright", "test", "-g", "user can (sign up|log in)"],
        "win32",
        "cmd.exe",
      ),
    ).toEqual({
      command: "cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        'npx.cmd playwright test -g "user can (sign up|log in)"',
      ],
    });
  });

  it("keeps Unix invocations as direct argv calls", () => {
    expect(
      buildSpawnStreamingInvocation("npx", ["playwright", "test"], "linux"),
    ).toEqual({
      command: "npx",
      args: ["playwright", "test"],
    });
  });
});

/**
 * Self-check for the newline probe.
 *
 * The probe's job is to flag search_replace calls where the current
 * serialization writes a stray blank line. If the probe itself were broken, a
 * clean eval run would be indistinguishable from "the defect never fired" —
 * so these tests pin both directions: it flags known-corrupting args, and
 * stays silent on clean ones.
 *
 * Runs in the normal unit suite; needs no API key.
 */

import { describe, it, expect } from "vitest";
import { applySearchReplace } from "@/pro/main/ipc/processors/search_replace_processor";
import {
  serializeCurrent,
  serializeFixed,
  serializeFixedFull,
} from "./newline_probe";

const FILE_NO_BLANK = "const a = 1;\nconst b = 2;\nconst c = 3;\n";
const FILE_WITH_BLANK = "const a = 1;\nconst b = 2;\n\nconst c = 3;\n";

function apply(
  serialize: (o: string, n: string) => string,
  file: string,
  oldString: string,
  newString: string,
): string {
  const result = applySearchReplace(file, serialize(oldString, newString));
  expect(result.success).toBe(true);
  return result.content!;
}

function detects(file: string, oldString: string, newString: string): boolean {
  return (
    apply(serializeCurrent, file, oldString, newString) !==
    apply(serializeFixed, file, oldString, newString)
  );
}

describe("newline probe detector", () => {
  it("flags a trailing newline on new_string as corrupting", () => {
    expect(detects(FILE_NO_BLANK, "const b = 2;", "const b = 22;\n")).toBe(
      true,
    );

    // And the corruption is specifically a stray blank line.
    expect(
      apply(serializeCurrent, FILE_NO_BLANK, "const b = 2;", "const b = 22;\n"),
    ).toBe("const a = 1;\nconst b = 22;\n\nconst c = 3;\n");
    expect(
      apply(serializeFixed, FILE_NO_BLANK, "const b = 2;", "const b = 22;\n"),
    ).toBe("const a = 1;\nconst b = 22;\nconst c = 3;\n");
  });

  it("flags a multi-line replacement carrying a terminator", () => {
    expect(
      detects(FILE_NO_BLANK, "const b = 2;", "const b = 22;\nconst b2 = 3;\n"),
    ).toBe(true);
  });

  it("stays silent when neither arg has a trailing newline", () => {
    expect(detects(FILE_NO_BLANK, "const b = 2;", "const b = 22;")).toBe(false);
  });

  it("stays silent when both args are newline-terminated", () => {
    // The trailing blank is load-bearing here: it consumes and re-emits the
    // real blank line in the file, so the fix must leave it alone.
    expect(detects(FILE_WITH_BLANK, "const b = 2;\n", "const b = 22;\n")).toBe(
      false,
    );
    expect(
      apply(
        serializeFixed,
        FILE_WITH_BLANK,
        "const b = 2;\n",
        "const b = 22;\n",
      ),
    ).toBe("const a = 1;\nconst b = 22;\n\nconst c = 3;\n");
  });

  it("flags an explicit blank-line request as over-applied", () => {
    // A model asking for ONE blank line (new_string ending "\n\n") currently
    // gets TWO. The off-by-one is unconditional: whenever the replace block is
    // newline-terminated, the current serialization adds exactly one blank line
    // more than the model asked for. There is no input where a terminated
    // new_string produces what was requested.
    expect(detects(FILE_NO_BLANK, "const b = 2;", "const b = 22;\n\n")).toBe(
      true,
    );
    expect(
      apply(
        serializeCurrent,
        FILE_NO_BLANK,
        "const b = 2;",
        "const b = 22;\n\n",
      ),
    ).toBe("const a = 1;\nconst b = 22;\n\n\nconst c = 3;\n");
    expect(
      apply(serializeFixed, FILE_NO_BLANK, "const b = 2;", "const b = 22;\n\n"),
    ).toBe("const a = 1;\nconst b = 22;\n\nconst c = 3;\n");
  });

  // The symmetric case is the one that fired on real model output: GPT 5.6 Sol
  // terminates both args together because it copies a contiguous region, and
  // corruption followed whenever the file had no real blank line at that
  // boundary. The processor fix (mirroring the trimEmptyLines fallback onto the
  // replace side) closes it, so these are now regression guards: if the probe
  // starts reporting divergence here again, the fix has been undone.
  describe("symmetric case (the shape observed in production traffic)", () => {
    it("no longer corrupts when the file has no blank line there", () => {
      const cur = apply(
        serializeCurrent,
        FILE_NO_BLANK,
        "const b = 2;\n",
        "const b = 22;\n",
      );
      const full = apply(
        serializeFixedFull,
        FILE_NO_BLANK,
        "const b = 2;\n",
        "const b = 22;\n",
      );
      expect(cur).toBe("const a = 1;\nconst b = 22;\nconst c = 3;\n");
      expect(cur).toBe(full);
    });

    it("stays silent when the blank line is real", () => {
      const cur = apply(
        serializeCurrent,
        FILE_WITH_BLANK,
        "const b = 2;\n",
        "const b = 22;\n",
      );
      const full = apply(
        serializeFixedFull,
        FILE_WITH_BLANK,
        "const b = 2;\n",
        "const b = 22;\n",
      );
      expect(cur).toBe(full);
      expect(full).toBe("const a = 1;\nconst b = 22;\n\nconst c = 3;\n");
    });

    it("is invisible to the asymmetric-only counterfactual", () => {
      // Documents the blind spot that hid this defect during measurement:
      // serializeFixed leaves symmetric calls untouched, so it reported clean
      // on genuinely corrupted calls. serializeFixedFull is the detector.
      expect(detects(FILE_NO_BLANK, "const b = 2;\n", "const b = 22;\n")).toBe(
        false,
      );
    });
  });

  it("still flags the asymmetric shape, which the processor fix does not cover", () => {
    // Part A only runs inside the trimEmptyLines fallback, and an
    // unterminated old_string matches as-is so the fallback never fires. This
    // shape was never observed in 82 recorded GPT 5.6 Sol calls, but the probe
    // stays live for it.
    expect(detects(FILE_NO_BLANK, "const b = 2;", "const b = 22;\n")).toBe(
      true,
    );
    expect(
      apply(serializeCurrent, FILE_NO_BLANK, "const b = 2;", "const b = 22;\n"),
    ).toBe("const a = 1;\nconst b = 22;\n\nconst c = 3;\n");
  });

  it("never alters old_string, so matching behavior cannot move", () => {
    // Two identical candidates; only the trailing blank line disambiguates.
    const ambiguous =
      "const b = 2;\nconst x = 0;\nconst b = 2;\n\nconst c = 3;\n";
    const current = applySearchReplace(
      ambiguous,
      serializeCurrent("const b = 2;\n", "const b = 22;\n"),
    );
    const fixed = applySearchReplace(
      ambiguous,
      serializeFixed("const b = 2;\n", "const b = 22;\n"),
    );
    expect(current.success).toBe(true);
    expect(fixed.success).toBe(true);
    expect(fixed.content).toBe(current.content);
  });
});

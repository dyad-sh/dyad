import { describe, expect, it } from "vitest";
import { createTestOutputRedactor } from "./test_output_redaction";

describe("test runner output redaction", () => {
  const secret = "sb_secret_fixture-test-key";

  it("redacts credentials at every possible chunk boundary", () => {
    for (let split = 0; split <= secret.length; split++) {
      const chunks: string[] = [];
      const stream = createTestOutputRedactor([secret]).stream((chunk) =>
        chunks.push(chunk),
      );
      stream.push(`stdout: ${secret.slice(0, split)}`);
      stream.push(`${secret.slice(split)}\nstderr: ${secret}\n`);
      stream.flush();
      expect(chunks.join("")).toBe("stdout: [redacted]\nstderr: [redacted]\n");
    }
  });

  it("withholds partial credentials when a run ends early", () => {
    const chunks: string[] = [];
    const stream = createTestOutputRedactor([secret]).stream((chunk) =>
      chunks.push(chunk),
    );
    stream.push("error: sb_secret_fixture");
    stream.flush();
    expect(chunks.join("")).toBe("error: [redacted]");
  });

  it("redacts secrets interrupted by ANSI highlighting and split escape codes", () => {
    const colored = `sb_secret_\x1b[7mfixture-test\x1b[27m-key`;
    const redactor = createTestOutputRedactor([secret]);
    expect(redactor.result({ error: colored })).toEqual({
      error: "[redacted]",
    });
    const chunks: string[] = [];
    const stream = redactor.stream((chunk) => chunks.push(chunk));
    for (const character of colored) stream.push(character);
    stream.flush();
    expect(chunks.join("")).toBe("[redacted]");
  });

  it("sanitizes nested failures with escaped credentials and preserves values", () => {
    const password = 'password"with\nnewlines';
    const redactor = createTestOutputRedactor([secret, password, ""]);
    expect(
      redactor.result({
        results: [{ error: `Received: ${secret}`, attempts: 2 }],
        infraError: { message: password },
        installed: false,
      }),
    ).toEqual({
      results: [{ error: "Received: [redacted]", attempts: 2 }],
      infraError: { message: "[redacted]" },
      installed: false,
    });
  });
});

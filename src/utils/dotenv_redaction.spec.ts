import { describe, expect, it } from "vitest";
import { isDotenvFilePath, redactDotenvValues } from "./dotenv_redaction";

describe("dotenv redaction", () => {
  it("recognizes dotenv file names without matching similarly named files", () => {
    expect(isDotenvFilePath(".env")).toBe(true);
    expect(isDotenvFilePath("config/.env.local")).toBe(true);
    expect(isDotenvFilePath("attachments:.ENV.production")).toBe(true);
    expect(isDotenvFilePath(".environment-setup.md")).toBe(false);
    expect(isDotenvFilePath(".envoy/config.yaml")).toBe(false);
  });

  it("redacts unrecognized content to cover multiline dotenv values", () => {
    expect(
      redactDotenvValues(
        'MULTILINE="first\n# still part of the value\nsecond"\nNEXT=value',
      ),
    ).toBe("MULTILINE=[redacted]\n[redacted]\n[redacted]\nNEXT=[redacted]");
  });

  it("preserves comments outside multiline values", () => {
    expect(redactDotenvValues("# configuration\nKEY=value")).toBe(
      "# configuration\nKEY=[redacted]",
    );
  });

  it("preserves CRLF line endings", () => {
    expect(redactDotenvValues("KEY=value\r\nEMPTY=\r\n")).toBe(
      "KEY=[redacted]\r\nEMPTY=\r\n",
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  isDotenvFilePath,
  redactDotenvValues,
  selectTextLineRange,
} from "./dotenv_redaction";

describe("dotenv redaction", () => {
  it("recognizes dotenv file names without matching similarly named files", () => {
    expect(isDotenvFilePath(".env")).toBe(true);
    expect(isDotenvFilePath("config/.env.local")).toBe(true);
    expect(isDotenvFilePath(".envrc")).toBe(true);
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

  it("redacts backtick and escaped-quote multiline values", () => {
    expect(
      redactDotenvValues(
        "BACKTICK=`first\n# sk-backtick\nlast`\n" +
          "SINGLE='first\\'\n# sk-single\nlast'",
      ),
    ).toBe(
      "BACKTICK=[redacted]\n[redacted]\n[redacted]\n" +
        "SINGLE=[redacted]\n[redacted]\n[redacted]",
    );
  });

  it("preserves supported key syntax while redacting values", () => {
    expect(
      redactDotenvValues(
        "SENTRY.DSN=secret\napi-key=secret\nDATABASE_URL: postgres://secret",
      ),
    ).toBe(
      "SENTRY.DSN=[redacted]\napi-key=[redacted]\nDATABASE_URL: [redacted]",
    );
  });

  it("preserves semantically empty values with comments and empty quotes", () => {
    const content = [
      "EMPTY= # optional",
      "SPACED=   # optional",
      'DOUBLE="" # optional',
      "SINGLE='' # optional",
      "BACKTICK=`` # optional",
    ].join("\n");
    expect(redactDotenvValues(content)).toBe(content);
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

  it("selects line ranges after multiline values are sanitized", () => {
    const sanitized = redactDotenvValues(
      'SECRET="top\nc2VjcmV0=\nbottom"\nEMPTY=',
    );
    expect(selectTextLineRange(sanitized, 2, 2)).toBe("[redacted]");
    expect(selectTextLineRange(sanitized, 4, 4)).toBe("EMPTY=");
  });
});

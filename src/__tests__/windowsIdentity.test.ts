import { describe, expect, it } from "vitest";
import {
  SQUIRREL_MAKER_NAME,
  WINDOWS_AUMID,
  computeSquirrelAumid,
} from "../shared/windowsIdentity";

describe("Windows Identity Constants", () => {
  it("SQUIRREL_MAKER_NAME should be lowercase with underscores", () => {
    expect(SQUIRREL_MAKER_NAME).toBe("abba_ai");
    // Verify format: no spaces, no special chars except underscore
    expect(SQUIRREL_MAKER_NAME).toMatch(/^[a-z0-9_]+$/);
  });

  it("WINDOWS_AUMID should match Squirrel pattern", () => {
    const expectedPattern = `com.squirrel.${SQUIRREL_MAKER_NAME}.${SQUIRREL_MAKER_NAME}`;
    expect(WINDOWS_AUMID).toBe(expectedPattern);
    expect(WINDOWS_AUMID).toBe("com.squirrel.abba_ai.abba_ai");
  });

  it("computeSquirrelAumid should generate correct pattern", () => {
    expect(computeSquirrelAumid("test_app")).toBe(
      "com.squirrel.test_app.test_app",
    );
    expect(computeSquirrelAumid("abba_ai")).toBe(
      "com.squirrel.abba_ai.abba_ai",
    );
  });

  it("WINDOWS_AUMID should equal computed value from SQUIRREL_MAKER_NAME", () => {
    expect(WINDOWS_AUMID).toBe(computeSquirrelAumid(SQUIRREL_MAKER_NAME));
  });
});

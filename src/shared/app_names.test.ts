import { describe, expect, it } from "vitest";

import {
  FALLBACK_DISPLAY_NAME,
  FALLBACK_FOLDER_NAME,
  MAX_APP_FOLDER_NAME_LENGTH,
  appFolderNameWithSuffix,
  sanitizeAppDisplayName,
  sanitizeAppFolderNameInput,
  slugifyAppFolderName,
  validateAppFolderName,
} from "@/shared/app_names";

describe("sanitizeAppDisplayName", () => {
  it("keeps expressive names, collapsing whitespace", () => {
    expect(sanitizeAppDisplayName("Food/Drink Planner")).toBe(
      "Food/Drink Planner",
    );
    expect(sanitizeAppDisplayName("foo    bar\t\tbaz")).toBe("foo bar baz");
  });

  it("strips control characters", () => {
    expect(sanitizeAppDisplayName("name\x00with\x1fcontrol")).toBe(
      "namewithcontrol",
    );
  });

  it("falls back for empty or control-only names", () => {
    expect(sanitizeAppDisplayName("")).toBe(FALLBACK_DISPLAY_NAME);
    expect(sanitizeAppDisplayName("   ")).toBe(FALLBACK_DISPLAY_NAME);
    expect(sanitizeAppDisplayName("\x00\x1f")).toBe(FALLBACK_DISPLAY_NAME);
  });
});

describe("slugifyAppFolderName", () => {
  it("lowercases and dashes invalid characters and punctuation runs", () => {
    expect(slugifyAppFolderName("My Awesome App")).toBe("my-awesome-app");
    expect(slugifyAppFolderName('weird<>:"|?*/\\name')).toBe("weird-name");
    expect(slugifyAppFolderName("Food/Drink Planner")).toBe(
      "food-drink-planner",
    );
    expect(slugifyAppFolderName("My App!")).toBe("my-app");
    expect(slugifyAppFolderName("my app")).toBe("my-app");
    expect(slugifyAppFolderName("My-App")).toBe("my-app");
  });

  it("splits camelCase and acronym boundaries like slugifyAppPath", () => {
    expect(slugifyAppFolderName("DraftName")).toBe("draft-name");
    expect(slugifyAppFolderName("TaskMaster Pro")).toBe("task-master-pro");
  });

  it("strips control characters", () => {
    expect(slugifyAppFolderName("name\x00with\x1fcontrol")).toBe(
      "name-with-control",
    );
  });

  it("transliterates accented Latin characters", () => {
    expect(slugifyAppFolderName("Café Planner")).toBe("cafe-planner");
    expect(slugifyAppFolderName("Über Résumé")).toBe("uber-resume");
  });

  it("preserves CJK characters", () => {
    expect(slugifyAppFolderName("日本語アプリ")).toBe("日本語アプリ");
    // Kana with combining voiced marks must survive NFD round-tripping.
    expect(slugifyAppFolderName("ガギグゲゴ")).toBe("ガギグゲゴ");
  });

  it("falls back for `.`, `..`, empty, whitespace-only, and symbol-only names", () => {
    expect(slugifyAppFolderName(".")).toBe(FALLBACK_FOLDER_NAME);
    expect(slugifyAppFolderName("..")).toBe(FALLBACK_FOLDER_NAME);
    expect(slugifyAppFolderName("")).toBe(FALLBACK_FOLDER_NAME);
    expect(slugifyAppFolderName("   ")).toBe(FALLBACK_FOLDER_NAME);
    expect(slugifyAppFolderName("///")).toBe(FALLBACK_FOLDER_NAME);
    expect(slugifyAppFolderName("🍕🍔")).toBe(FALLBACK_FOLDER_NAME);
  });

  it("avoids Windows reserved device names", () => {
    expect(slugifyAppFolderName("CON")).toBe("con-app");
    expect(slugifyAppFolderName("lpt9")).toBe("lpt9-app");
    // The extension dot slugs to a dash, so this is no longer reserved.
    expect(slugifyAppFolderName("CON.txt")).toBe("con-txt");
  });

  it("drops trailing periods and spaces", () => {
    expect(slugifyAppFolderName("name.")).toBe("name");
    expect(slugifyAppFolderName("name ")).toBe("name");
  });

  it("truncates to the maximum length on code points", () => {
    expect(slugifyAppFolderName("a".repeat(200))).toHaveLength(
      MAX_APP_FOLDER_NAME_LENGTH,
    );
    // An emoji at the boundary becomes a dash separator; the truncated result
    // must not end with a dangling dash or half a surrogate pair.
    const result = slugifyAppFolderName("a".repeat(79) + "🍕" + "b");
    expect(result).toBe("a".repeat(79));
  });
});

describe("sanitizeAppFolderNameInput", () => {
  it("preserves case and inner formatting", () => {
    expect(sanitizeAppFolderNameInput("My Folder")).toBe("My Folder");
    expect(sanitizeAppFolderNameInput("MyApp")).toBe("MyApp");
  });

  it("replaces invalid characters and strips control characters", () => {
    expect(sanitizeAppFolderNameInput("My Folder?")).toBe("My Folder");
    expect(sanitizeAppFolderNameInput('weird<>:"|?*/\\name')).toBe(
      "weird-name",
    );
    expect(sanitizeAppFolderNameInput("name\x00with\x1fcontrol")).toBe(
      "namewithcontrol",
    );
  });

  it("trims leading/trailing dashes, periods, and whitespace", () => {
    expect(sanitizeAppFolderNameInput("   --foo--   ")).toBe("foo");
    expect(sanitizeAppFolderNameInput("name.")).toBe("name");
    expect(sanitizeAppFolderNameInput(".hidden")).toBe("hidden");
  });

  it("falls back for `.`, `..`, and empty names", () => {
    expect(sanitizeAppFolderNameInput(".")).toBe(FALLBACK_FOLDER_NAME);
    expect(sanitizeAppFolderNameInput("..")).toBe(FALLBACK_FOLDER_NAME);
    expect(sanitizeAppFolderNameInput("")).toBe(FALLBACK_FOLDER_NAME);
    expect(sanitizeAppFolderNameInput("   ")).toBe(FALLBACK_FOLDER_NAME);
  });

  it("avoids Windows reserved device names including extension variants", () => {
    expect(sanitizeAppFolderNameInput("CON")).toBe("CON-app");
    expect(sanitizeAppFolderNameInput("CON.txt")).toBe("CON-app.txt");
    expect(validateAppFolderName(sanitizeAppFolderNameInput("CON.txt"))).toBe(
      null,
    );
  });

  it("truncates to the maximum length", () => {
    expect(sanitizeAppFolderNameInput("a".repeat(200))).toHaveLength(
      MAX_APP_FOLDER_NAME_LENGTH,
    );
  });
});

describe("validateAppFolderName", () => {
  it("accepts legacy mixed-case and spaced folders", () => {
    expect(validateAppFolderName("My Awesome App")).toBeNull();
    expect(validateAppFolderName("my-app")).toBeNull();
    expect(validateAppFolderName("MyApp_2")).toBeNull();
  });

  it("rejects invalid and control characters", () => {
    expect(validateAppFolderName("bad|name")).not.toBeNull();
    expect(validateAppFolderName("foo/bar")).not.toBeNull();
    expect(validateAppFolderName("foo\\bar")).not.toBeNull();
    expect(validateAppFolderName("bad\x01name")).not.toBeNull();
  });

  it("rejects `.`, `..`, and empty names", () => {
    expect(validateAppFolderName(".")).not.toBeNull();
    expect(validateAppFolderName("..")).not.toBeNull();
    expect(validateAppFolderName("")).not.toBeNull();
    expect(validateAppFolderName("   ")).not.toBeNull();
  });

  it("rejects reserved Windows names and extension variants", () => {
    expect(validateAppFolderName("CON")).not.toBeNull();
    expect(validateAppFolderName("con")).not.toBeNull();
    expect(validateAppFolderName("CON.txt")).not.toBeNull();
    expect(validateAppFolderName("COM1")).not.toBeNull();
  });

  it("rejects trailing period or space", () => {
    expect(validateAppFolderName("name.")).not.toBeNull();
    expect(validateAppFolderName("name ")).not.toBeNull();
    expect(validateAppFolderName(" name")).not.toBeNull();
  });

  it("rejects names over the maximum length", () => {
    expect(
      validateAppFolderName("a".repeat(MAX_APP_FOLDER_NAME_LENGTH)),
    ).toBeNull();
    expect(
      validateAppFolderName("a".repeat(MAX_APP_FOLDER_NAME_LENGTH + 1)),
    ).not.toBeNull();
  });
});

describe("appFolderNameWithSuffix", () => {
  it("returns the base for suffix 1 and appends -N otherwise", () => {
    expect(appFolderNameWithSuffix("my-app", 1)).toBe("my-app");
    expect(appFolderNameWithSuffix("my-app", 2)).toBe("my-app-2");
    expect(appFolderNameWithSuffix("my-app", 10)).toBe("my-app-10");
  });

  it("shortens the base so the suffix fits within the length limit", () => {
    const base = "a".repeat(MAX_APP_FOLDER_NAME_LENGTH);
    const suffixed = appFolderNameWithSuffix(base, 12);
    expect(suffixed).toHaveLength(MAX_APP_FOLDER_NAME_LENGTH);
    expect(suffixed.endsWith("-12")).toBe(true);
  });
});

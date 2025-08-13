import { parseAppMentions } from "@/shared/parse_mention_apps";
import { describe, it, expect } from "vitest";

describe("parseAppMentions", () => {
  it("should parse basic app mentions", () => {
    const prompt = "Can you help me with @app:MyApp and @app:AnotherApp?";
    const result = parseAppMentions(prompt);
    expect(result).toEqual(["MyApp", "AnotherApp"]);
  });

  it("should parse app mentions with underscores", () => {
    const prompt = "I need help with @app:my_app and @app:another_app_name";
    const result = parseAppMentions(prompt);
    expect(result).toEqual(["my_app", "another_app_name"]);
  });

  it("should parse app mentions with hyphens", () => {
    const prompt = "Check @app:my-app and @app:another-app-name";
    const result = parseAppMentions(prompt);
    expect(result).toEqual(["my-app", "another-app-name"]);
  });

  it("should parse app mentions with numbers", () => {
    const prompt = "Update @app:app1 and @app:app2023 please";
    const result = parseAppMentions(prompt);
    expect(result).toEqual(["app1", "app2023"]);
  });

  it("should not parse mentions without app: prefix", () => {
    const prompt = "Can you work on @MyApp and @AnotherApp?";
    const result = parseAppMentions(prompt);
    expect(result).toEqual([]);
  });

  it("should require exact 'app:' prefix (case sensitive)", () => {
    const prompt = "Check @App:MyApp and @APP:AnotherApp vs @app:ValidApp";
    const result = parseAppMentions(prompt);
    expect(result).toEqual(["ValidApp"]);
  });

  it("should parse mixed case app mentions", () => {
    const prompt = "Help with @app:MyApp, @app:myapp, and @app:MYAPP";
    const result = parseAppMentions(prompt);
    expect(result).toEqual(["MyApp", "myapp", "MYAPP"]);
  });

  it("should parse app mentions with mixed characters (no spaces)", () => {
    const prompt = "Check @app:My_App-2023 and @app:Another_App_Name-v2";
    const result = parseAppMentions(prompt);
    expect(result).toEqual(["My_App-2023", "Another_App_Name-v2"]);
  });

  it("should not handle spaces in app names (spaces break app names)", () => {
    const prompt = "Work on @app:My_App_Name with underscores";
    const result = parseAppMentions(prompt);
    expect(result).toEqual(["My_App_Name"]);
  });

  it("should handle empty string", () => {
    const result = parseAppMentions("");
    expect(result).toEqual([]);
  });

  it("should handle string with no mentions", () => {
    const prompt = "This is just a regular message without any mentions";
    const result = parseAppMentions(prompt);
    expect(result).toEqual([]);
  });

  it("should handle standalone @ symbol", () => {
    const prompt = "This has @ symbol but no valid mention";
    const result = parseAppMentions(prompt);
    expect(result).toEqual([]);
  });

  it("should ignore @ followed by special characters", () => {
    const prompt = "Check @# and @! and @$ symbols";
    const result = parseAppMentions(prompt);
    expect(result).toEqual([]);
  });

  it("should ignore @ at the end of string", () => {
    const prompt = "This ends with @";
    const result = parseAppMentions(prompt);
    expect(result).toEqual([]);
  });

  it("should parse mentions at different positions", () => {
    const prompt =
      "@app:StartApp in the beginning, @app:MiddleApp in middle, and @app:EndApp at end";
    const result = parseAppMentions(prompt);
    expect(result).toEqual(["StartApp", "MiddleApp", "EndApp"]);
  });

  it("should handle mentions with punctuation around them", () => {
    const prompt = "Check (@app:MyApp), @app:AnotherApp! and @app:ThirdApp?";
    const result = parseAppMentions(prompt);
    expect(result).toEqual(["MyApp", "AnotherApp", "ThirdApp"]);
  });

  it("should parse mentions in different sentence structures", () => {
    const prompt = `
      Can you help me with @app:WebApp?
      I also need @app:MobileApp updated.
      Don't forget about @app:DesktopApp.
    `;
    const result = parseAppMentions(prompt);
    expect(result).toEqual(["WebApp", "MobileApp", "DesktopApp"]);
  });

  it("should handle duplicate mentions", () => {
    const prompt = "Update @app:MyApp and also check @app:MyApp again";
    const result = parseAppMentions(prompt);
    expect(result).toEqual(["MyApp", "MyApp"]);
  });

  it("should parse mentions in multiline text", () => {
    const prompt = `Line 1 has @app:App1
Line 2 has @app:App2
Line 3 has @app:App3`;
    const result = parseAppMentions(prompt);
    expect(result).toEqual(["App1", "App2", "App3"]);
  });

  it("should handle mentions with tabs and other whitespace", () => {
    const prompt = "Check\t@app:TabApp\nand\r@app:NewlineApp";
    const result = parseAppMentions(prompt);
    expect(result).toEqual(["TabApp", "NewlineApp"]);
  });

  it("should parse single character app names", () => {
    const prompt = "Check @app:A and @app:B and @app:1";
    const result = parseAppMentions(prompt);
    expect(result).toEqual(["A", "B", "1"]);
  });

  it("should handle very long app names", () => {
    const longAppName = "VeryLongAppNameWithManyCharacters123_test-app";
    const prompt = `Check @app:${longAppName}`;
    const result = parseAppMentions(prompt);
    expect(result).toEqual([longAppName]);
  });

  it("should stop parsing at invalid characters", () => {
    const prompt =
      "Check @app:MyApp@InvalidPart and @app:AnotherApp.InvalidPart";
    const result = parseAppMentions(prompt);
    expect(result).toEqual(["MyApp", "AnotherApp"]);
  });

  it("should handle mentions with numbers and underscores mixed", () => {
    const prompt = "Update @app:app_v1_2023 and @app:test_app_123";
    const result = parseAppMentions(prompt);
    expect(result).toEqual(["app_v1_2023", "test_app_123"]);
  });

  it("should handle mentions with hyphens and numbers mixed", () => {
    const prompt = "Check @app:app-v1-2023 and @app:test-app-123";
    const result = parseAppMentions(prompt);
    expect(result).toEqual(["app-v1-2023", "test-app-123"]);
  });

  it("should parse mentions in URLs and complex text", () => {
    const prompt =
      "Visit https://example.com and check @app:WebApp for updates. Email admin@company.com about @app:MobileApp";
    const result = parseAppMentions(prompt);
    expect(result).toEqual(["WebApp", "MobileApp"]);
  });

  it("should not handle spaces in app names (spaces break app names)", () => {
    const prompt = "Check @app:My_App_Name with underscores";
    const result = parseAppMentions(prompt);
    expect(result).toEqual(["My_App_Name"]);
  });

  it("should parse mentions in JSON-like strings", () => {
    const prompt = '{"app": "@app:MyApp", "another": "@app:SecondApp"}';
    const result = parseAppMentions(prompt);
    expect(result).toEqual(["MyApp", "SecondApp"]);
  });

  it("should handle complex real-world scenarios (no spaces in app names)", () => {
    const prompt = `
      Hi there! I need help with @app:My_Web_App and @app:Mobile_App_v2.
      Could you also check the status of @app:backend-service-2023?
      Don't forget about @app:legacy_app and @app:NEW_PROJECT.
      
      Thanks!
      @app:user_mention should not be confused with @app:ActualApp.
    `;
    const result = parseAppMentions(prompt);
    expect(result).toEqual([
      "My_Web_App",
      "Mobile_App_v2",
      "backend-service-2023",
      "legacy_app",
      "NEW_PROJECT",
      "user_mention",
      "ActualApp",
    ]);
  });

  it("should preserve order of mentions", () => {
    const prompt = "@app:Third @app:First @app:Second @app:Third @app:First";
    const result = parseAppMentions(prompt);
    expect(result).toEqual(["Third", "First", "Second", "Third", "First"]);
  });

  it("should handle edge case with @ followed by space", () => {
    const prompt = "This has @ space but @app:ValidApp is here";
    const result = parseAppMentions(prompt);
    expect(result).toEqual(["ValidApp"]);
  });

  it("should handle unicode characters after @", () => {
    const prompt = "Check @app:AppName and @app:测试 and @app:café-app";
    const result = parseAppMentions(prompt);
    // Based on the regex, unicode characters like 测试 and é should not match
    expect(result).toEqual(["AppName", "caf"]);
  });

  it("should handle nested mentions pattern", () => {
    const prompt = "Check @app:App1 @app:App2 @app:App3 test";
    const result = parseAppMentions(prompt);
    expect(result).toEqual(["App1", "App2", "App3"]);
  });
});

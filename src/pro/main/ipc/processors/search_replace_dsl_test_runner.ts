/**
 * DSL Test Runner for Search/Replace Processor
 *
 * Parses test cases from .txt files with the following format:
 *
 * --- Test case name: descriptive name ---
 * <original_file>
 * ... original content ...
 * </original_file>
 * <<<<<<< SEARCH
 * ... search content ...
 * =======
 * ... replace content ...
 * >>>>>>> REPLACE
 * <output_file>
 * ... expected output ...
 * </output_file>
 *
 * For failing tests, use <error_pattern> instead of <output_file>:
 * <error_pattern>
 * regex pattern to match error message
 * </error_pattern>
 */

export interface PassingTestCase {
  name: string;
  original: string;
  diff: string;
  expectedOutput: string;
}

export interface FailingTestCase {
  name: string;
  original: string;
  diff: string;
  errorPattern: RegExp;
}

export type TestCase = PassingTestCase | FailingTestCase;

export function isPassingTestCase(tc: TestCase): tc is PassingTestCase {
  return "expectedOutput" in tc;
}

export function isFailingTestCase(tc: TestCase): tc is FailingTestCase {
  return "errorPattern" in tc;
}

/**
 * Parse a DSL test file into test cases.
 * Handles both passing tests (with <output_file>) and failing tests (with <error_pattern>).
 */
export function parseDslTestCases(content: string): TestCase[] {
  const testCases: TestCase[] = [];

  // Split by test case delimiter
  const testCasePattern = /---\s*Test case name:\s*(.+?)\s*---/g;
  const matches = [...content.matchAll(testCasePattern)];

  if (matches.length === 0) {
    return testCases;
  }

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const testName = match[1].trim();
    const startIndex = match.index! + match[0].length;
    const endIndex =
      i + 1 < matches.length ? matches[i + 1].index! : content.length;
    const testContent = content.slice(startIndex, endIndex);

    const testCase = parseTestCase(testName, testContent);
    if (testCase) {
      testCases.push(testCase);
    }
  }

  return testCases;
}

function parseTestCase(name: string, content: string): TestCase | null {
  // Extract original file content
  const originalMatch = content.match(
    /<original_file>\r?\n([\s\S]*?)<\/original_file>/,
  );
  if (!originalMatch) {
    console.warn(`Test case "${name}": missing <original_file> tag`);
    return null;
  }
  const original = originalMatch[1];

  // Extract diff content (everything between </original_file> and <output_file> or <error_pattern>)
  const afterOriginal = content.slice(
    content.indexOf("</original_file>") + "</original_file>".length,
  );

  // Find the diff block - it should contain the search/replace markers
  let diff: string;
  const outputFileIndex = afterOriginal.indexOf("<output_file>");
  const errorPatternIndex = afterOriginal.indexOf("<error_pattern>");

  if (outputFileIndex !== -1 && errorPatternIndex !== -1) {
    // Both present - use whichever comes first
    diff = afterOriginal.slice(0, Math.min(outputFileIndex, errorPatternIndex));
  } else if (outputFileIndex !== -1) {
    diff = afterOriginal.slice(0, outputFileIndex);
  } else if (errorPatternIndex !== -1) {
    diff = afterOriginal.slice(0, errorPatternIndex);
  } else {
    console.warn(
      `Test case "${name}": missing <output_file> or <error_pattern> tag`,
    );
    return null;
  }

  // Trim leading/trailing whitespace but preserve internal structure
  diff = diff.trim();

  // Check for output_file (passing test)
  const outputMatch = content.match(
    /<output_file>\r?\n([\s\S]*?)<\/output_file>/,
  );
  if (outputMatch) {
    return {
      name,
      original,
      diff,
      expectedOutput: outputMatch[1],
    };
  }

  // Check for error_pattern (failing test)
  const errorMatch = content.match(
    /<error_pattern>\r?\n([\s\S]*?)<\/error_pattern>/,
  );
  if (errorMatch) {
    const patternStr = errorMatch[1].trim();
    try {
      return {
        name,
        original,
        diff,
        errorPattern: new RegExp(patternStr, "i"),
      };
    } catch {
      console.warn(
        `Test case "${name}": invalid regex pattern "${patternStr}"`,
      );
      return null;
    }
  }

  console.warn(
    `Test case "${name}": missing <output_file> or <error_pattern> tag`,
  );
  return null;
}

import { parseEnvFile, serializeEnvFile } from "@/ipc/utils/app_env_var_utils";
import { describe, it, expect } from "vitest";

describe("parseEnvFile", () => {
  it("should parse basic key=value pairs", () => {
    const content = `API_KEY=abc123
DATABASE_URL=postgres://localhost:5432/mydb
PORT=3000`;

    const result = parseEnvFile(content);
    expect(result).toEqual([
      { key: "API_KEY", value: "abc123" },
      { key: "DATABASE_URL", value: "postgres://localhost:5432/mydb" },
      { key: "PORT", value: "3000" },
    ]);
  });

  it("should handle quoted values and remove quotes", () => {
    const content = `API_KEY="abc123"
DATABASE_URL='postgres://localhost:5432/mydb'
MESSAGE="Hello World"`;

    const result = parseEnvFile(content);
    expect(result).toEqual([
      { key: "API_KEY", value: "abc123" },
      { key: "DATABASE_URL", value: "postgres://localhost:5432/mydb" },
      { key: "MESSAGE", value: "Hello World" },
    ]);
  });

  it("should skip empty lines", () => {
    const content = `API_KEY=abc123

DATABASE_URL=postgres://localhost:5432/mydb


PORT=3000`;

    const result = parseEnvFile(content);
    expect(result).toEqual([
      { key: "API_KEY", value: "abc123" },
      { key: "DATABASE_URL", value: "postgres://localhost:5432/mydb" },
      { key: "PORT", value: "3000" },
    ]);
  });

  it("should skip comment lines", () => {
    const content = `# This is a comment
API_KEY=abc123
# Another comment
DATABASE_URL=postgres://localhost:5432/mydb
# PORT=3000 (commented out)
DEBUG=true`;

    const result = parseEnvFile(content);
    expect(result).toEqual([
      { key: "API_KEY", value: "abc123" },
      { key: "DATABASE_URL", value: "postgres://localhost:5432/mydb" },
      { key: "DEBUG", value: "true" },
    ]);
  });

  it("should handle values with spaces", () => {
    const content = `MESSAGE="Hello World"
DESCRIPTION='This is a long description'
TITLE=My App Title`;

    const result = parseEnvFile(content);
    expect(result).toEqual([
      { key: "MESSAGE", value: "Hello World" },
      { key: "DESCRIPTION", value: "This is a long description" },
      { key: "TITLE", value: "My App Title" },
    ]);
  });

  it("should handle values with special characters", () => {
    const content = `PASSWORD="p@ssw0rd!#$%"
URL="https://example.com/api?key=123&secret=456"
REGEX="^[a-zA-Z0-9]+$"`;

    const result = parseEnvFile(content);
    expect(result).toEqual([
      { key: "PASSWORD", value: "p@ssw0rd!#$%" },
      { key: "URL", value: "https://example.com/api?key=123&secret=456" },
      { key: "REGEX", value: "^[a-zA-Z0-9]+$" },
    ]);
  });

  it("should handle empty values", () => {
    const content = `EMPTY_VAR=
QUOTED_EMPTY=""
ANOTHER_VAR=value`;

    const result = parseEnvFile(content);
    expect(result).toEqual([
      { key: "EMPTY_VAR", value: "" },
      { key: "QUOTED_EMPTY", value: "" },
      { key: "ANOTHER_VAR", value: "value" },
    ]);
  });

  it("should handle values with equals signs", () => {
    const content = `EQUATION="2+2=4"
CONNECTION_STRING="server=localhost;user=admin;password=secret"`;

    const result = parseEnvFile(content);
    expect(result).toEqual([
      { key: "EQUATION", value: "2+2=4" },
      {
        key: "CONNECTION_STRING",
        value: "server=localhost;user=admin;password=secret",
      },
    ]);
  });

  it("should trim whitespace around keys and values", () => {
    const content = `  API_KEY  =  abc123  
  DATABASE_URL  =  "postgres://localhost:5432/mydb"  
  PORT  =  3000  `;

    const result = parseEnvFile(content);
    expect(result).toEqual([
      { key: "API_KEY", value: "abc123" },
      { key: "DATABASE_URL", value: "postgres://localhost:5432/mydb" },
      { key: "PORT", value: "3000" },
    ]);
  });

  it("should skip malformed lines without equals sign", () => {
    const content = `API_KEY=abc123
MALFORMED_LINE
DATABASE_URL=postgres://localhost:5432/mydb
ANOTHER_MALFORMED
PORT=3000`;

    const result = parseEnvFile(content);
    expect(result).toEqual([
      { key: "API_KEY", value: "abc123" },
      { key: "DATABASE_URL", value: "postgres://localhost:5432/mydb" },
      { key: "PORT", value: "3000" },
    ]);
  });

  it("should skip lines with equals sign at the beginning", () => {
    const content = `API_KEY=abc123
=invalid_line
DATABASE_URL=postgres://localhost:5432/mydb`;

    const result = parseEnvFile(content);
    expect(result).toEqual([
      { key: "API_KEY", value: "abc123" },
      { key: "DATABASE_URL", value: "postgres://localhost:5432/mydb" },
    ]);
  });

  it("should handle mixed quote types in values", () => {
    const content = `MESSAGE="He said 'Hello World'"
COMMAND='echo "Hello World"'`;

    const result = parseEnvFile(content);
    expect(result).toEqual([
      { key: "MESSAGE", value: "He said 'Hello World'" },
      { key: "COMMAND", value: 'echo "Hello World"' },
    ]);
  });

  it("should handle empty content", () => {
    const result = parseEnvFile("");
    expect(result).toEqual([]);
  });

  it("should handle content with only comments and empty lines", () => {
    const content = `# Comment 1

# Comment 2

# Comment 3`;

    const result = parseEnvFile(content);
    expect(result).toEqual([]);
  });

  it("should handle values that start with hash symbol when quoted", () => {
    const content = `HASH_VALUE="#hashtag"
COMMENT_LIKE="# This looks like a comment but it's a value"
ACTUAL_COMMENT=value
# This is an actual comment`;

    const result = parseEnvFile(content);
    expect(result).toEqual([
      { key: "HASH_VALUE", value: "#hashtag" },
      {
        key: "COMMENT_LIKE",
        value: "# This looks like a comment but it's a value",
      },
      { key: "ACTUAL_COMMENT", value: "value" },
    ]);
  });

  it("should skip comments that look like key=value pairs", () => {
    const content = `API_KEY=abc123
# SECRET_KEY=should_be_ignored
DATABASE_URL=postgres://localhost:5432/mydb
# PORT=3000
DEBUG=true`;

    const result = parseEnvFile(content);
    expect(result).toEqual([
      { key: "API_KEY", value: "abc123" },
      { key: "DATABASE_URL", value: "postgres://localhost:5432/mydb" },
      { key: "DEBUG", value: "true" },
    ]);
  });

  it("should handle values containing comment symbols", () => {
    const content = `GIT_COMMIT_MSG="feat: add new feature # closes #123"
SQL_QUERY="SELECT * FROM users WHERE id = 1 # Get user by ID"
MARKDOWN_HEADING="# Main Title"
SHELL_COMMENT="echo 'hello' # prints hello"`;

    const result = parseEnvFile(content);
    expect(result).toEqual([
      { key: "GIT_COMMIT_MSG", value: "feat: add new feature # closes #123" },
      {
        key: "SQL_QUERY",
        value: "SELECT * FROM users WHERE id = 1 # Get user by ID",
      },
      { key: "MARKDOWN_HEADING", value: "# Main Title" },
      { key: "SHELL_COMMENT", value: "echo 'hello' # prints hello" },
    ]);
  });

  it("should handle inline comments after key=value pairs", () => {
    const content = `API_KEY=abc123 # This is the API key
DATABASE_URL=postgres://localhost:5432/mydb # Database connection
PORT=3000 # Server port
DEBUG=true # Enable debug mode`;

    const result = parseEnvFile(content);
    expect(result).toEqual([
      { key: "API_KEY", value: "abc123 # This is the API key" },
      {
        key: "DATABASE_URL",
        value: "postgres://localhost:5432/mydb # Database connection",
      },
      { key: "PORT", value: "3000 # Server port" },
      { key: "DEBUG", value: "true # Enable debug mode" },
    ]);
  });

  it("should handle quoted values with inline comments", () => {
    const content = `MESSAGE="Hello World" # Greeting message
PASSWORD="secret#123" # Password with hash
URL="https://example.com#section" # URL with fragment`;

    const result = parseEnvFile(content);
    expect(result).toEqual([
      { key: "MESSAGE", value: "Hello World" },
      { key: "PASSWORD", value: "secret#123" },
      { key: "URL", value: "https://example.com#section" },
    ]);
  });

  it("should handle complex mixed comment scenarios", () => {
    const content = `# Configuration file
API_KEY=abc123
# Database settings
DATABASE_URL="postgres://localhost:5432/mydb"
# PORT=5432 (commented out)
DATABASE_NAME=myapp

# Feature flags
FEATURE_A=true # Enable feature A
FEATURE_B="false" # Disable feature B
# FEATURE_C=true (disabled)

# URLs with fragments
HOMEPAGE="https://example.com#home"
DOCS_URL=https://docs.example.com#getting-started # Documentation link`;

    const result = parseEnvFile(content);
    expect(result).toEqual([
      { key: "API_KEY", value: "abc123" },
      { key: "DATABASE_URL", value: "postgres://localhost:5432/mydb" },
      { key: "DATABASE_NAME", value: "myapp" },
      { key: "FEATURE_A", value: "true # Enable feature A" },
      { key: "FEATURE_B", value: "false" },
      { key: "HOMEPAGE", value: "https://example.com#home" },
      {
        key: "DOCS_URL",
        value: "https://docs.example.com#getting-started # Documentation link",
      },
    ]);
  });
});

describe("serializeEnvFile", () => {
  it("should serialize basic key=value pairs", () => {
    const envVars = [
      { key: "API_KEY", value: "abc123" },
      { key: "DATABASE_URL", value: "postgres://localhost:5432/mydb" },
      { key: "PORT", value: "3000" },
    ];

    const result = serializeEnvFile(envVars);
    expect(result).toBe(`API_KEY=abc123
DATABASE_URL=postgres://localhost:5432/mydb
PORT=3000`);
  });

  it("should quote values with spaces", () => {
    const envVars = [
      { key: "MESSAGE", value: "Hello World" },
      { key: "DESCRIPTION", value: "This is a long description" },
      { key: "SIMPLE", value: "no_spaces" },
    ];

    const result = serializeEnvFile(envVars);
    expect(result).toBe(`MESSAGE="Hello World"
DESCRIPTION="This is a long description"
SIMPLE=no_spaces`);
  });

  it("should quote values with special characters", () => {
    const envVars = [
      { key: "PASSWORD", value: "p@ssw0rd!#$%" },
      { key: "URL", value: "https://example.com/api?key=123&secret=456" },
      { key: "SIMPLE", value: "simple123" },
    ];

    const result = serializeEnvFile(envVars);
    expect(result).toBe(`PASSWORD="p@ssw0rd!#$%"
URL="https://example.com/api?key=123&secret=456"
SIMPLE=simple123`);
  });

  it("should escape quotes in values", () => {
    const envVars = [
      { key: "MESSAGE", value: 'He said "Hello World"' },
      { key: "COMMAND", value: 'echo "test"' },
    ];

    const result = serializeEnvFile(envVars);
    expect(result).toBe(`MESSAGE="He said \\"Hello World\\""
COMMAND="echo \\"test\\""`);
  });

  it("should handle empty values", () => {
    const envVars = [
      { key: "EMPTY_VAR", value: "" },
      { key: "ANOTHER_VAR", value: "value" },
      { key: "ALSO_EMPTY", value: "" },
    ];

    const result = serializeEnvFile(envVars);
    expect(result).toBe(`EMPTY_VAR=
ANOTHER_VAR=value
ALSO_EMPTY=`);
  });

  it("should quote values with hash symbols", () => {
    const envVars = [
      { key: "PASSWORD", value: "secret#123" },
      { key: "COMMENT", value: "This has # in it" },
    ];

    const result = serializeEnvFile(envVars);
    expect(result).toBe(`PASSWORD="secret#123"
COMMENT="This has # in it"`);
  });

  it("should quote values with single quotes", () => {
    const envVars = [
      { key: "MESSAGE", value: "Don't worry" },
      { key: "SQL", value: "SELECT * FROM 'users'" },
    ];

    const result = serializeEnvFile(envVars);
    expect(result).toBe(`MESSAGE="Don't worry"
SQL="SELECT * FROM 'users'"`);
  });

  it("should handle values with equals signs", () => {
    const envVars = [
      { key: "EQUATION", value: "2+2=4" },
      {
        key: "CONNECTION_STRING",
        value: "server=localhost;user=admin;password=secret",
      },
    ];

    const result = serializeEnvFile(envVars);
    expect(result).toBe(`EQUATION="2+2=4"
CONNECTION_STRING="server=localhost;user=admin;password=secret"`);
  });

  it("should handle mixed scenarios", () => {
    const envVars = [
      { key: "SIMPLE", value: "value" },
      { key: "WITH_SPACES", value: "hello world" },
      { key: "WITH_QUOTES", value: 'say "hello"' },
      { key: "EMPTY", value: "" },
      { key: "SPECIAL_CHARS", value: "p@ssw0rd!#$%" },
    ];

    const result = serializeEnvFile(envVars);
    expect(result).toBe(`SIMPLE=value
WITH_SPACES="hello world"
WITH_QUOTES="say \\"hello\\""
EMPTY=
SPECIAL_CHARS="p@ssw0rd!#$%"`);
  });

  it("should handle empty array", () => {
    const result = serializeEnvFile([]);
    expect(result).toBe("");
  });

  it("should handle complex escaped quotes", () => {
    const envVars = [
      { key: "COMPLEX", value: "This is \"complex\" with 'mixed' quotes" },
    ];

    const result = serializeEnvFile(envVars);
    expect(result).toBe(`COMPLEX="This is \\"complex\\" with 'mixed' quotes"`);
  });

  it("should handle values that start with hash symbol", () => {
    const envVars = [
      { key: "HASHTAG", value: "#trending" },
      { key: "COMMENT_LIKE", value: "# This looks like a comment" },
      { key: "MARKDOWN_HEADING", value: "# Main Title" },
      { key: "NORMAL_VALUE", value: "no_hash_here" },
    ];

    const result = serializeEnvFile(envVars);
    expect(result).toBe(`HASHTAG="#trending"
COMMENT_LIKE="# This looks like a comment"
MARKDOWN_HEADING="# Main Title"
NORMAL_VALUE=no_hash_here`);
  });

  it("should handle values containing comment symbols", () => {
    const envVars = [
      { key: "GIT_COMMIT", value: "feat: add feature # closes #123" },
      { key: "SQL_QUERY", value: "SELECT * FROM users # Get all users" },
      { key: "SHELL_CMD", value: "echo 'hello' # prints hello" },
    ];

    const result = serializeEnvFile(envVars);
    expect(result).toBe(`GIT_COMMIT="feat: add feature # closes #123"
SQL_QUERY="SELECT * FROM users # Get all users"
SHELL_CMD="echo 'hello' # prints hello"`);
  });

  it("should handle URLs with fragments that contain hash symbols", () => {
    const envVars = [
      { key: "HOMEPAGE", value: "https://example.com#home" },
      { key: "DOCS_URL", value: "https://docs.example.com#getting-started" },
      { key: "API_ENDPOINT", value: "https://api.example.com/v1#section" },
    ];

    const result = serializeEnvFile(envVars);
    expect(result).toBe(`HOMEPAGE="https://example.com#home"
DOCS_URL="https://docs.example.com#getting-started"
API_ENDPOINT="https://api.example.com/v1#section"`);
  });

  it("should handle values with hash symbols and other special characters", () => {
    const envVars = [
      { key: "COMPLEX_PASSWORD", value: "p@ssw0rd#123!&" },
      { key: "REGEX_PATTERN", value: "^[a-zA-Z0-9#]+$" },
      {
        key: "MARKDOWN_CONTENT",
        value: "# Title\n\nSome content with = and & symbols",
      },
    ];

    const result = serializeEnvFile(envVars);
    expect(result).toBe(`COMPLEX_PASSWORD="p@ssw0rd#123!&"
REGEX_PATTERN="^[a-zA-Z0-9#]+$"
MARKDOWN_CONTENT="# Title\n\nSome content with = and & symbols"`);
  });
});

describe("parseEnvFile and serializeEnvFile integration", () => {
  it("should be able to parse what it serializes", () => {
    const originalEnvVars = [
      { key: "API_KEY", value: "abc123" },
      { key: "MESSAGE", value: "Hello World" },
      { key: "PASSWORD", value: 'secret"123' },
      { key: "EMPTY", value: "" },
      { key: "SPECIAL", value: "p@ssw0rd!#$%" },
    ];

    const serialized = serializeEnvFile(originalEnvVars);
    const parsed = parseEnvFile(serialized);

    expect(parsed).toEqual(originalEnvVars);
  });

  it("should handle round-trip with complex values", () => {
    const originalEnvVars = [
      { key: "URL", value: "https://example.com/api?key=123&secret=456" },
      { key: "REGEX", value: "^[a-zA-Z0-9]+$" },
      { key: "COMMAND", value: 'echo "Hello World"' },
      { key: "EQUATION", value: "2+2=4" },
    ];

    const serialized = serializeEnvFile(originalEnvVars);
    const parsed = parseEnvFile(serialized);

    expect(parsed).toEqual(originalEnvVars);
  });

  it("should handle round-trip with comment-like values", () => {
    const originalEnvVars = [
      { key: "HASHTAG", value: "#trending" },
      {
        key: "COMMENT_LIKE",
        value: "# This looks like a comment but it's a value",
      },
      { key: "GIT_COMMIT", value: "feat: add feature # closes #123" },
      { key: "URL_WITH_FRAGMENT", value: "https://example.com#section" },
      { key: "MARKDOWN_HEADING", value: "# Main Title" },
      { key: "COMPLEX_VALUE", value: "password#123=secret&token=abc" },
    ];

    const serialized = serializeEnvFile(originalEnvVars);
    const parsed = parseEnvFile(serialized);

    expect(parsed).toEqual(originalEnvVars);
  });
});

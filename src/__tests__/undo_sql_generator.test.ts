import { describe, it, expect } from "vitest";
import {
  generateUndoSql,
  splitStatements,
  summarizeUndoSql,
} from "@/supabase_admin/undo_sql_generator";

describe("splitStatements", () => {
  it("splits simple statements", () => {
    const result = splitStatements(
      "CREATE TABLE foo (id int); CREATE TABLE bar (id int);",
    );
    expect(result).toEqual([
      "CREATE TABLE foo (id int)",
      "CREATE TABLE bar (id int)",
    ]);
  });

  it("handles dollar-quoted strings", () => {
    const sql = `CREATE FUNCTION hello() RETURNS void AS $$ BEGIN NULL; END; $$ LANGUAGE plpgsql;`;
    const result = splitStatements(sql);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("$$");
  });

  it("handles single-quoted strings with semicolons", () => {
    const sql = `INSERT INTO foo VALUES ('hello; world');`;
    const result = splitStatements(sql);
    expect(result).toHaveLength(1);
  });

  it("ignores line comments", () => {
    const sql = `-- this is a comment\nCREATE TABLE foo (id int);`;
    const result = splitStatements(sql);
    expect(result).toEqual(["CREATE TABLE foo (id int)"]);
  });

  it("ignores block comments", () => {
    const sql = `/* this is a comment */ CREATE TABLE foo (id int);`;
    const result = splitStatements(sql);
    expect(result).toEqual(["CREATE TABLE foo (id int)"]);
  });

  it("handles empty input", () => {
    expect(splitStatements("")).toEqual([]);
    expect(splitStatements("  ")).toEqual([]);
    expect(splitStatements("-- just a comment")).toEqual([]);
  });

  it("handles tagged dollar-quotes", () => {
    const sql = `CREATE FUNCTION test() RETURNS void AS $fn$ BEGIN NULL; END; $fn$ LANGUAGE plpgsql;`;
    const result = splitStatements(sql);
    expect(result).toHaveLength(1);
  });
});

describe("generateUndoSql", () => {
  describe("CREATE TABLE", () => {
    it("generates DROP TABLE for CREATE TABLE", () => {
      const result = generateUndoSql(
        "CREATE TABLE users (id serial PRIMARY KEY, name text);",
      );
      expect(result).toBe("DROP TABLE IF EXISTS users;");
    });

    it("handles IF NOT EXISTS", () => {
      const result = generateUndoSql(
        "CREATE TABLE IF NOT EXISTS users (id int);",
      );
      expect(result).toBe("DROP TABLE IF EXISTS users;");
    });

    it("handles schema-qualified public table", () => {
      const result = generateUndoSql("CREATE TABLE public.users (id int);");
      expect(result).toBe("DROP TABLE IF EXISTS users;");
    });

    it("handles quoted identifiers", () => {
      const result = generateUndoSql('CREATE TABLE "MyTable" (id int);');
      expect(result).toBe('DROP TABLE IF EXISTS "MyTable";');
    });
  });

  describe("ALTER TABLE ADD COLUMN", () => {
    it("generates DROP COLUMN for ADD COLUMN", () => {
      const result = generateUndoSql(
        "ALTER TABLE users ADD COLUMN email text NOT NULL;",
      );
      expect(result).toBe("ALTER TABLE users DROP COLUMN IF EXISTS email;");
    });

    it("handles ADD without COLUMN keyword", () => {
      const result = generateUndoSql("ALTER TABLE users ADD email text;");
      expect(result).toBe("ALTER TABLE users DROP COLUMN IF EXISTS email;");
    });
  });

  describe("CREATE INDEX", () => {
    it("generates DROP INDEX", () => {
      const result = generateUndoSql(
        "CREATE INDEX idx_users_email ON users (email);",
      );
      expect(result).toBe("DROP INDEX IF EXISTS idx_users_email;");
    });

    it("handles UNIQUE INDEX", () => {
      const result = generateUndoSql(
        "CREATE UNIQUE INDEX idx_email ON users (email);",
      );
      expect(result).toBe("DROP INDEX IF EXISTS idx_email;");
    });

    it("handles IF NOT EXISTS", () => {
      const result = generateUndoSql(
        "CREATE INDEX IF NOT EXISTS idx_email ON users (email);",
      );
      expect(result).toBe("DROP INDEX IF EXISTS idx_email;");
    });

    it("handles CONCURRENTLY", () => {
      const result = generateUndoSql(
        "CREATE INDEX CONCURRENTLY idx_email ON users (email);",
      );
      expect(result).toBe("DROP INDEX IF EXISTS idx_email;");
    });
  });

  describe("CREATE POLICY", () => {
    it("generates DROP POLICY", () => {
      const result = generateUndoSql(
        'CREATE POLICY "users_select" ON users FOR SELECT USING (true);',
      );
      expect(result).toBe('DROP POLICY IF EXISTS "users_select" ON users;');
    });
  });

  describe("ROW LEVEL SECURITY", () => {
    it("generates DISABLE RLS for ENABLE RLS", () => {
      const result = generateUndoSql(
        "ALTER TABLE users ENABLE ROW LEVEL SECURITY",
      );
      expect(result).toBe("ALTER TABLE users DISABLE ROW LEVEL SECURITY;");
    });

    it("generates ENABLE RLS for DISABLE RLS", () => {
      const result = generateUndoSql(
        "ALTER TABLE users DISABLE ROW LEVEL SECURITY",
      );
      expect(result).toBe("ALTER TABLE users ENABLE ROW LEVEL SECURITY;");
    });
  });

  describe("CREATE FUNCTION", () => {
    it("generates DROP FUNCTION", () => {
      const result = generateUndoSql(
        "CREATE OR REPLACE FUNCTION hello() RETURNS void AS $$ BEGIN NULL; END; $$ LANGUAGE plpgsql;",
      );
      expect(result).toBe("DROP FUNCTION IF EXISTS hello;");
    });

    it("handles function without OR REPLACE", () => {
      const result = generateUndoSql(
        "CREATE FUNCTION my_func() RETURNS void AS $$ BEGIN NULL; END; $$ LANGUAGE plpgsql;",
      );
      expect(result).toBe("DROP FUNCTION IF EXISTS my_func;");
    });
  });

  describe("CREATE TRIGGER", () => {
    it("generates DROP TRIGGER", () => {
      const result = generateUndoSql(
        "CREATE TRIGGER update_timestamp BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_modified();",
      );
      expect(result).toBe("DROP TRIGGER IF EXISTS update_timestamp ON users;");
    });
  });

  describe("CREATE TYPE", () => {
    it("generates DROP TYPE", () => {
      const result = generateUndoSql(
        "CREATE TYPE mood AS ENUM ('happy', 'sad');",
      );
      expect(result).toBe("DROP TYPE IF EXISTS mood;");
    });
  });

  describe("CREATE EXTENSION", () => {
    it("generates DROP EXTENSION", () => {
      const result = generateUndoSql(
        'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";',
      );
      expect(result).toBe('DROP EXTENSION IF EXISTS "uuid-ossp";');
    });
  });

  describe("non-reversible operations", () => {
    it("returns null for DROP TABLE", () => {
      expect(generateUndoSql("DROP TABLE users;")).toBeNull();
    });

    it("returns null for ALTER TABLE DROP COLUMN", () => {
      expect(
        generateUndoSql("ALTER TABLE users DROP COLUMN email;"),
      ).toBeNull();
    });

    it("returns null for ALTER COLUMN", () => {
      expect(
        generateUndoSql("ALTER TABLE users ALTER COLUMN name SET NOT NULL;"),
      ).toBeNull();
    });

    it("returns null for unrecognized SQL", () => {
      expect(generateUndoSql("GRANT ALL ON users TO admin;")).toBeNull();
    });
  });

  describe("non-public schema", () => {
    it("returns null for auth schema", () => {
      expect(generateUndoSql("CREATE TABLE auth.users (id int);")).toBeNull();
    });

    it("returns null for storage schema", () => {
      expect(
        generateUndoSql("CREATE TABLE storage.objects (id int);"),
      ).toBeNull();
    });

    it("allows FK references to auth schema in public table", () => {
      const sql = `CREATE TABLE public.profiles (
        id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        name TEXT
      );`;
      expect(generateUndoSql(sql)).toBe("DROP TABLE IF EXISTS profiles;");
    });

    it("allows FK references to auth schema without ON DELETE", () => {
      const sql = `CREATE TABLE profiles (
        user_id UUID REFERENCES auth.users(id),
        bio TEXT
      );`;
      expect(generateUndoSql(sql)).toBe("DROP TABLE IF EXISTS profiles;");
    });
  });

  describe("multi-statement SQL", () => {
    it("generates undo for multiple statements in reverse order", () => {
      const sql = `
        CREATE TABLE users (id serial PRIMARY KEY);
        ALTER TABLE users ADD COLUMN name text;
        CREATE INDEX idx_users_name ON users (name);
      `;
      const result = generateUndoSql(sql);
      expect(result).toBe(
        "DROP INDEX IF EXISTS idx_users_name;\n" +
          "ALTER TABLE users DROP COLUMN IF EXISTS name;\n" +
          "DROP TABLE IF EXISTS users;",
      );
    });

    it("returns null if any statement is non-reversible", () => {
      const sql = `
        CREATE TABLE users (id serial PRIMARY KEY);
        DROP TABLE old_users;
      `;
      expect(generateUndoSql(sql)).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("returns null for empty SQL", () => {
      expect(generateUndoSql("")).toBeNull();
      expect(generateUndoSql("   ")).toBeNull();
    });

    it("handles SQL with comments interspersed", () => {
      const sql = `
        -- Create the users table
        CREATE TABLE users (id int);
        /* Add email column */
        ALTER TABLE users ADD COLUMN email text;
      `;
      const result = generateUndoSql(sql);
      expect(result).toBe(
        "ALTER TABLE users DROP COLUMN IF EXISTS email;\nDROP TABLE IF EXISTS users;",
      );
    });

    it("handles table with RLS and policy together", () => {
      const sql = `
        CREATE TABLE posts (id serial PRIMARY KEY, user_id int);
        ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
        CREATE POLICY "posts_select" ON posts FOR SELECT USING (true);
      `;
      const result = generateUndoSql(sql);
      expect(result).not.toBeNull();
      // Undo should reverse: drop policy, disable RLS, drop table
      expect(result).toBe(
        'DROP POLICY IF EXISTS "posts_select" ON posts;\n' +
          "ALTER TABLE posts DISABLE ROW LEVEL SECURITY;\n" +
          "DROP TABLE IF EXISTS posts;",
      );
    });
  });
});

describe("summarizeUndoSql", () => {
  it("generates human-readable summaries", () => {
    const undoSql =
      'DROP POLICY IF EXISTS "users_select" ON users;\n' +
      "ALTER TABLE users DISABLE ROW LEVEL SECURITY;\n" +
      "ALTER TABLE users DROP COLUMN IF EXISTS email;\n" +
      "DROP TABLE IF EXISTS users;";
    const summaries = summarizeUndoSql(undoSql);
    expect(summaries).toEqual([
      'Remove policy "users_select" from users',
      "Disable RLS on users",
      "Remove column email from users",
      "Drop table users",
    ]);
  });

  it("handles DROP INDEX", () => {
    const summaries = summarizeUndoSql("DROP INDEX IF EXISTS idx_email;");
    expect(summaries).toEqual(["Drop index idx_email"]);
  });

  it("handles DROP FUNCTION", () => {
    const summaries = summarizeUndoSql("DROP FUNCTION IF EXISTS hello;");
    expect(summaries).toEqual(["Drop function hello"]);
  });

  it("handles DROP TRIGGER", () => {
    const summaries = summarizeUndoSql(
      "DROP TRIGGER IF EXISTS update_ts ON users;",
    );
    expect(summaries).toEqual(["Remove trigger update_ts from users"]);
  });
});

import Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { expect, it } from "vitest";
import { createInMemoryTestDb } from "@/testing/test_db";
import { apps, testUserCleanup } from "./schema";

it("adds test-account cleanup without resource history or changing existing apps", () => {
  const sqlite = new Database(":memory:");
  try {
    sqlite.pragma("foreign_keys = ON");
    const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
    const creation = migrations.findIndex((migration) =>
      migration.sql.some((sql) =>
        sql.includes("CREATE TABLE `test_user_cleanup`"),
      ),
    );
    expect(creation).toBeGreaterThan(0);
    for (const migration of migrations.slice(0, creation)) {
      for (const sql of migration.sql) sqlite.exec(sql);
    }
    sqlite.exec("INSERT INTO apps (id, name, path) VALUES (1, 'one', 'one')");
    for (const migration of migrations.slice(creation)) {
      for (const sql of migration.sql) sqlite.exec(sql);
    }
    expect(sqlite.prepare("SELECT id, name FROM apps").all()).toEqual([
      { id: 1, name: "one" },
    ]);
    expect(
      sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE name = 'test_resource_profiles'",
        )
        .all(),
    ).toEqual([]);
    sqlite.exec(
      "INSERT INTO test_user_cleanup VALUES ('user', 1, 'owner', 'project', 'org')",
    );
    // Recovery records must survive deletion of the local app.
    sqlite.exec("DELETE FROM apps WHERE id = 1");
    expect(sqlite.prepare("SELECT * FROM test_user_cleanup").all()).toEqual([
      {
        user_id: "user",
        app_id: 1,
        owner_id: "owner",
        project_id: "project",
        organization_slug: "org",
      },
    ]);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
  } finally {
    sqlite.close();
  }
});

it("migrates fresh installs and preserves cleanup records on another startup", () => {
  const db = createInMemoryTestDb();
  try {
    db.insert(apps).values({ id: 1, name: "one", path: "one" }).run();
    const record = {
      userId: "user",
      appId: 1,
      ownerId: "owner",
      projectId: "project",
      organizationSlug: "org",
    };
    db.insert(testUserCleanup).values(record).run();
    migrate(db, { migrationsFolder: "drizzle" });
    expect(db.select().from(testUserCleanup).all()).toEqual([record]);
    expect(
      db.$client
        .prepare(
          "SELECT name FROM sqlite_master WHERE name = 'test_resource_profiles'",
        )
        .all(),
    ).toEqual([]);
  } finally {
    db.$client.close();
  }
});

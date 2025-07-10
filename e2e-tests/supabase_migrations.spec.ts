import { expect } from "@playwright/test";
import { test, testSkipIfWindows } from "./helpers/test_helper";
import fs from "fs-extra";
import path from "path";
import { execSync } from "child_process";

test("supabase migrations", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("tc=add-supabase");

  // Connect to Supabase
  await po.page.getByText("Set up supabase").click();
  await po.clickConnectSupabaseButton();
  await po.clickBackButton();

  const appPath = await po.getCurrentAppPath();
  const migrationsDir = path.join(appPath, "supabase", "migrations");

  // --- SCENARIO 1: OFF BY DEFAULT ---
  await po.sendPrompt("tc=execute-sql-1");
  await po.waitForChatCompletion();

  expect(fs.existsSync(migrationsDir)).toBe(false);

  // --- SCENARIO 2: TOGGLE ON ---
  // Go to settings to find the Supabase integration
  await po.goToSettingsTab();
  const migrationsSwitch = po.page.locator("#supabase-migrations");
  await migrationsSwitch.click();
  await po.goToChatTab();

  // Send a prompt that triggers a migration
  await po.sendPrompt("tc=execute-sql-1");
  await po.waitForChatCompletion();

  let files: string[] = [];
  await expect(async () => {
    // Check that one migration file was created
    files = await fs.readdir(migrationsDir);
    expect(files).toHaveLength(1);
  }).toPass();

  expect(files[0]).toMatch(/0000_create_users_table\.sql/);
  expect(await fs.readFile(path.join(migrationsDir, files[0]), "utf8")).toEqual(
    "CREATE TABLE users (id serial primary key);",
  );

  // Send a prompt that triggers a migration
  await po.sendPrompt("tc=execute-sql-no-description");
  await po.waitForChatCompletion();

  await expect(async () => {
    // Check that one migration file was created
    files = await fs.readdir(migrationsDir);
    expect(files).toHaveLength(2);
  }).toPass();

  expect(files[1]).toMatch(/0001_\w+_\w+_\w+\.sql/);
  expect(await fs.readFile(path.join(migrationsDir, files[1]), "utf8")).toEqual(
    "DROP TABLE users;",
  );
});

// Skip this test on Windows because git isn't configured and
// the mac test will catch this regression.
testSkipIfWindows("supabase migrations with native git", async ({ po }) => {
  // Turning on native Git to catch this edge case:
  // https://github.com/dyad-sh/dyad/issues/608
  await po.setUp({ autoApprove: true, nativeGit: true });
  await po.sendPrompt("tc=add-supabase");

  // Connect to Supabase
  await po.page.getByText("Set up supabase").click();
  await po.clickConnectSupabaseButton();
  await po.clickBackButton();

  const appPath = await po.getCurrentAppPath();
  const migrationsDir = path.join(appPath, "supabase", "migrations");

  // --- SCENARIO 1: OFF BY DEFAULT ---
  await po.sendPrompt("tc=execute-sql-1");
  await po.waitForChatCompletion();

  expect(fs.existsSync(migrationsDir)).toBe(false);

  // --- SCENARIO 2: TOGGLE ON ---
  // Go to settings to find the Supabase integration
  await po.goToSettingsTab();
  const migrationsSwitch = po.page.locator("#supabase-migrations");
  await migrationsSwitch.click();
  await po.goToChatTab();

  // Send a prompt that triggers a migration
  await po.sendPrompt("tc=execute-sql-1");
  await po.waitForChatCompletion();

  let files: string[] = [];
  await expect(async () => {
    // Check that one migration file was created
    files = await fs.readdir(migrationsDir);
    expect(files).toHaveLength(1);
  }).toPass();

  expect(files[0]).toMatch(/0000_create_users_table\.sql/);
  expect(await fs.readFile(path.join(migrationsDir, files[0]), "utf8")).toEqual(
    "CREATE TABLE users (id serial primary key);",
  );

  // Make sure git is clean.
  const gitStatus = execSync("git status --porcelain", {
    cwd: appPath,
    encoding: "utf8",
  }).trim();
  expect(gitStatus).toBe("");

  // Send a prompt that triggers a migration
  await po.sendPrompt("tc=execute-sql-no-description");
  await po.waitForChatCompletion();

  await expect(async () => {
    // Check that one migration file was created
    files = await fs.readdir(migrationsDir);
    expect(files).toHaveLength(2);
  }).toPass();

  expect(files[1]).toMatch(/0001_\w+_\w+_\w+\.sql/);
  expect(await fs.readFile(path.join(migrationsDir, files[1]), "utf8")).toEqual(
    "DROP TABLE users;",
  );
});

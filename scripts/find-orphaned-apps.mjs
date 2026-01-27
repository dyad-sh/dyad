#!/usr/bin/env node
/**
 * Script to find and optionally delete orphaned app records from the JoyCreate database.
 * Orphaned apps are records in the database whose directories no longer exist on disk.
 * 
 * Usage: 
 *   node scripts/find-orphaned-apps.mjs          # List orphaned apps
 *   node scripts/find-orphaned-apps.mjs --delete # Delete orphaned apps
 */

import initSqlJs from "sql.js";
import { homedir } from "os";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";

const shouldDelete = process.argv.includes("--delete");

// Check dev mode first, then production location
let dbPath = join(process.cwd(), "userData", "sqlite.db");

if (!existsSync(dbPath)) {
  dbPath = join(
    process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
    "JoyCreate",
    "sqlite.db"
  );
}

console.log(`Opening database at: ${dbPath}`);

if (!existsSync(dbPath)) {
  console.error(`Database not found at: ${dbPath}`);
  process.exit(1);
}

// Initialize SQL.js
const SQL = await initSqlJs();

// Read the database file
const fileBuffer = readFileSync(dbPath);
const db = new SQL.Database(fileBuffer);

// Get all apps
const apps = db.exec("SELECT id, name, path FROM apps");

if (apps.length === 0 || apps[0].values.length === 0) {
  console.log("No apps found in database.");
  db.close();
  process.exit(0);
}

console.log(`\nFound ${apps[0].values.length} app(s) in database:\n`);

const joyAppsDir = join(homedir(), "joy-apps");
const orphanedApps = [];
const validApps = [];

for (const [id, name, appPath] of apps[0].values) {
  const fullPath = join(joyAppsDir, appPath);
  const exists = existsSync(fullPath);
  
  if (exists) {
    validApps.push({ id, name, path: appPath });
    console.log(`✓ App ${id}: "${name}" (${appPath}) - OK`);
  } else {
    orphanedApps.push({ id, name, path: appPath });
    console.log(`✗ App ${id}: "${name}" (${appPath}) - ORPHANED (directory missing)`);
  }
}

console.log(`\n${"─".repeat(60)}`);
console.log(`Summary: ${validApps.length} valid, ${orphanedApps.length} orphaned`);

if (orphanedApps.length === 0) {
  console.log("\nNo orphaned apps found. Database is clean!");
  db.close();
  process.exit(0);
}

if (!shouldDelete) {
  console.log(`\nTo delete orphaned apps, run:`);
  console.log(`  node scripts/find-orphaned-apps.mjs --delete`);
  db.close();
  process.exit(0);
}

console.log(`\nDeleting ${orphanedApps.length} orphaned app(s)...`);

for (const app of orphanedApps) {
  console.log(`  Deleting app ${app.id}: "${app.name}"...`);
  
  // Delete associated messages first
  db.run("DELETE FROM messages WHERE chat_id IN (SELECT id FROM chats WHERE app_id = ?)", [app.id]);
  
  // Delete associated chats
  db.run("DELETE FROM chats WHERE app_id = ?", [app.id]);
  
  // Delete the app
  db.run("DELETE FROM apps WHERE id = ?", [app.id]);
  
  console.log(`    ✓ Deleted app ${app.id} and associated data`);
}

// Save the modified database back to file
const data = db.export();
const buffer = Buffer.from(data);
writeFileSync(dbPath, buffer);

console.log(`\n✓ Database saved. ${orphanedApps.length} orphaned app(s) removed.`);
console.log(`\nPlease restart JoyCreate for changes to take effect.`);

db.close();

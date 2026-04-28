/**
 * activate-all-agents.js
 *
 * Connects to the JoyCreate SQLite DB, lists all agents,
 * activates all draft agents, and prints a summary report.
 *
 * Usage:
 *   node scripts/activate-all-agents.js [--dry-run]
 *
 * Options:
 *   --dry-run   Show what would be changed without writing to the DB
 *
 * Requirements:
 *   - Run from within the JoyCreate Electron context OR use the Electron
 *     bundled Node (which has native better-sqlite3 compiled for Electron).
 *   - Alternatively, run via the JoyCreate API endpoint (if the app is open):
 *       curl -X POST http://127.0.0.1:18793/api/agents/activate-all \
 *            -H "Authorization: Bearer 7515c668531c06e2fd0be30e021a71e2a10b0a8f7d235cf5"
 *
 * NOTE: If you get "NODE_MODULE_VERSION mismatch", this script must be run
 * with the Electron binary, not the system Node. The JoyCreate Electron binary
 * compiled better-sqlite3 for its own Node version (MODULE_VERSION 139).
 * Use: npx electron scripts/activate-all-agents.js
 */

const path = require("path");
const fs = require("fs");

const DRY_RUN = process.argv.includes("--dry-run");

// ─── DB Path ────────────────────────────────────────────────────────────────
const appDataDir =
  process.env.APPDATA ||
  (process.platform === "darwin"
    ? path.join(process.env.HOME, "Library", "Application Support")
    : path.join(process.env.HOME, ".config"));

const DB_PATH = path.join(appDataDir, "JoyCreate", "sqlite.db");

if (!fs.existsSync(DB_PATH)) {
  console.error(`❌ Database not found at: ${DB_PATH}`);
  console.error("   Make sure JoyCreate has been run at least once.");
  process.exit(1);
}

console.log(`\n🗃️  JoyCreate Agent Activation Script`);
console.log(`   DB: ${DB_PATH}`);
if (DRY_RUN) {
  console.log(`   Mode: DRY RUN — no changes will be written\n`);
} else {
  console.log(`   Mode: LIVE — changes WILL be written\n`);
}

// ─── Load better-sqlite3 ────────────────────────────────────────────────────
let Database;
try {
  Database = require("better-sqlite3");
} catch (err) {
  console.error("❌ Failed to load better-sqlite3:", err.message);
  console.error("");
  console.error("   If you see a NODE_MODULE_VERSION mismatch, run with Electron:");
  console.error("   npx electron scripts/activate-all-agents.js");
  console.error("");
  console.error("   Or use the JoyCreate API (while the app is open):");
  console.error(
    '   curl -X POST http://127.0.0.1:18793/api/agents/activate-all \\\n' +
    '        -H "Authorization: Bearer 7515c668531c06e2fd0be30e021a71e2a10b0a8f7d235cf5"'
  );
  process.exit(1);
}

// ─── Open DB ────────────────────────────────────────────────────────────────
const db = new Database(DB_PATH, { readonly: DRY_RUN });

const now = new Date().toISOString();
const report = {
  timestamp: now,
  totalAgents: 0,
  alreadyActive: [],
  activated: [],
  failed: [],
};

try {
  // ── 1. Read all agents ────────────────────────────────────────────────────
  const allAgents = db
    .prepare("SELECT id, name, description, status, type, model_id FROM agents ORDER BY id ASC")
    .all();

  report.totalAgents = allAgents.length;

  console.log(`📊 Found ${allAgents.length} agent(s):`);
  console.log("─".repeat(70));
  console.log(
    `  ${"ID".padEnd(5)} ${"Status".padEnd(10)} ${"Type".padEnd(12)} Name`
  );
  console.log("─".repeat(70));
  for (const agent of allAgents) {
    const statusIcon = agent.status === "active" ? "✅" : agent.status === "draft" ? "📝" : "⚠️";
    console.log(
      `  ${String(agent.id).padEnd(5)} ${(statusIcon + " " + (agent.status ?? "unknown")).padEnd(12)} ${(agent.type ?? "chatbot").padEnd(12)} ${agent.name}`
    );
  }
  console.log("─".repeat(70) + "\n");

  // ── 2. Activate all draft agents ─────────────────────────────────────────
  const drafts = allAgents.filter((a) => a.status !== "active");
  const alreadyActive = allAgents.filter((a) => a.status === "active");

  report.alreadyActive = alreadyActive.map((a) => ({ id: a.id, name: a.name }));

  if (drafts.length === 0) {
    console.log("🎉 All agents are already active! Nothing to do.\n");
  } else {
    console.log(`🚀 Activating ${drafts.length} draft agent(s)...\n`);

    const updateStmt = DRY_RUN
      ? null
      : db.prepare(
          "UPDATE agents SET status = 'active', updated_at = ? WHERE id = ?"
        );

    for (const agent of drafts) {
      try {
        if (!DRY_RUN) {
          updateStmt.run(now, agent.id);
        }
        const verb = DRY_RUN ? "Would activate" : "Activated";
        console.log(`  ✅ ${verb}: [${agent.id}] ${agent.name}`);
        report.activated.push({ id: agent.id, name: agent.name, previousStatus: agent.status });
      } catch (err) {
        console.error(`  ❌ Failed to activate [${agent.id}] ${agent.name}: ${err.message}`);
        report.failed.push({ id: agent.id, name: agent.name, error: err.message });
      }
    }
  }

  // ── 3. Verify (if not dry run) ────────────────────────────────────────────
  if (!DRY_RUN && report.activated.length > 0) {
    const verifiedActive = db
      .prepare("SELECT COUNT(*) as n FROM agents WHERE status = 'active'")
      .get();
    console.log(`\n✅ Verified: ${verifiedActive.n} agent(s) now active in DB`);
  }

  // ── 4. Print report ───────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(70));
  console.log("📋 ACTIVATION REPORT");
  console.log("═".repeat(70));
  console.log(`  Timestamp:       ${report.timestamp}`);
  console.log(`  Total agents:    ${report.totalAgents}`);
  console.log(`  Already active:  ${report.alreadyActive.length}`);
  console.log(`  Newly activated: ${report.activated.length}`);
  console.log(`  Failures:        ${report.failed.length}`);

  if (report.alreadyActive.length > 0) {
    console.log(
      `\n  Pre-existing active agents:\n    ${report.alreadyActive.map((a) => `[${a.id}] ${a.name}`).join("\n    ")}`
    );
  }
  if (report.activated.length > 0) {
    console.log(
      `\n  Newly activated:\n    ${report.activated.map((a) => `[${a.id}] ${a.name} (was: ${a.previousStatus})`).join("\n    ")}`
    );
  }
  if (report.failed.length > 0) {
    console.log(
      `\n  ❌ Failures:\n    ${report.failed.map((a) => `[${a.id}] ${a.name}: ${a.error}`).join("\n    ")}`
    );
  }

  console.log("\n" + "═".repeat(70));

  if (DRY_RUN) {
    console.log("ℹ️  DRY RUN complete. Run without --dry-run to apply changes.");
  } else {
    console.log("🎉 Done! All JoyCreate agents are now active.");
  }
  console.log("═".repeat(70) + "\n");

  // Save JSON report
  const reportPath = path.join(__dirname, "activation-report.json");
  if (!DRY_RUN) {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`📄 Report saved to: ${reportPath}`);
  }
} finally {
  db.close();
}

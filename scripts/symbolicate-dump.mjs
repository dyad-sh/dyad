// Symbolicate Dyad crash dumps with minidump-stackwalk and Electron's
// public symbol server. Turns a .dmp file into a stack trace with function
// names, source files, and line numbers.
//
// Usage:
//   node scripts/symbolicate-dump.mjs                   # newest dev dump
//   node scripts/symbolicate-dump.mjs --prod            # newest dump of the installed Dyad
//   node scripts/symbolicate-dump.mjs path/to/crash.dmp [more.dmp ...]
//   node scripts/symbolicate-dump.mjs --json crash.dmp  # machine readable
//
// Other flags are passed through to minidump-stackwalk.
//
// Requires the minidump-stackwalk binary (from rust-minidump). Two ways to
// install it: prebuilt binaries from the project's GitHub releases, or
// building from source with cargo. Prebuilt is recommended: it is instant
// and needs no Rust toolchain.
//
// Option 1: prebuilt, macOS / Linux (installs to ~/.cargo/bin and adds it
// to PATH by updating your shell profile; open a new terminal afterwards):
//
//   curl -LsSf https://github.com/rust-minidump/rust-minidump/releases/latest/download/minidump-stackwalk-installer.sh | sh
//
// Option 1: prebuilt, Windows (PowerShell; open a new terminal afterwards):
//
//   $dir = "$env:LOCALAPPDATA\Programs\minidump-stackwalk"
//   Invoke-WebRequest https://github.com/rust-minidump/rust-minidump/releases/latest/download/minidump-stackwalk-x86_64-pc-windows-msvc.zip -OutFile "$env:TEMP\mdsw.zip"
//   Expand-Archive "$env:TEMP\mdsw.zip" -DestinationPath $dir -Force
//   $p = [Environment]::GetEnvironmentVariable("Path", "User")
//   [Environment]::SetEnvironmentVariable("Path", "$p;$dir", "User")
//
// Option 2: cargo (needs a Rust toolchain and compiles for a few minutes):
//
//   cargo install minidump-stackwalk
//
// Cargo does not update PATH. If the command is not found afterwards, add
// cargo's bin dir and open a new terminal:
//
//   echo 'export PATH="$HOME/.cargo/bin:$PATH"' >> ~/.bashrc   # Linux
//   echo 'export PATH="$HOME/.cargo/bin:$PATH"' >> ~/.zshrc    # macOS
//
// Alternatively, skip PATH entirely and set MINIDUMP_STACKWALK to the
// binary's full location.
//
// Frames in Electron's own binaries resolve to full names via
// symbols.electronjs.org. Frames in system libraries (libc, OS frameworks)
// stay as module+offset; Electron's server has no symbols for those.
//
// Installed builds rename the Electron binary to "dyad", while the symbol
// server hosts it under its original name. The script handles this by
// fetching symbols by debug id, which renaming does not change, and
// staging them locally under the renamed name.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const SYMBOL_URL = "https://symbols.electronjs.org";

// The dev build keeps its userData in the repo; the installed app keeps it
// in the platform's config directory.
function dumpDir(prod) {
  if (!prod) {
    return path.join(process.cwd(), "userData", "dyad-crash-reports");
  }
  const configDir =
    process.platform === "win32"
      ? (process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"))
      : process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Application Support")
        : (process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"));
  return path.join(configDir, "dyad", "dyad-crash-reports");
}

function newestDump(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir).filter((f) => f.endsWith(".dmp"));
  } catch {
    return null;
  }
  const byMtime = entries
    .map((f) => path.join(dir, f))
    .map((p) => {
      // A dump can vanish between readdir and stat; Crashpad manages these
      // files actively. Drop entries that cannot be statted.
      try {
        return { p, mtime: fs.statSync(p).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
  return byMtime[0]?.p ?? null;
}

const args = process.argv.slice(2);
const prod = args.includes("--prod");
const dumps = args.filter((a) => a.endsWith(".dmp"));
const flags = args.filter((a) => !a.endsWith(".dmp") && a !== "--prod");

const missing = dumps.filter((d) => !fs.existsSync(d));
if (missing.length > 0) {
  console.error(`No such dump file: ${missing.join(", ")}`);
  process.exit(1);
}

if (dumps.length === 0) {
  const dir = dumpDir(prod);
  const newest = newestDump(dir);
  if (!newest) {
    console.error(
      `No dump given and none found in ${dir}.\n` +
        "Usage: node scripts/symbolicate-dump.mjs [--prod] [flags] <dump.dmp> ...",
    );
    process.exit(1);
  }
  console.error(`No dump given; using newest dump: ${newest}\n`);
  dumps.push(newest);
}

const binary = process.env.MINIDUMP_STACKWALK ?? "minidump-stackwalk";
if (spawnSync(binary, ["--version"]).error?.code === "ENOENT") {
  console.error(
    "minidump-stackwalk not found. Install a prebuilt binary from\n" +
      "https://github.com/rust-minidump/rust-minidump/releases\n" +
      "(or: cargo install minidump-stackwalk), then put it on PATH or\n" +
      "set MINIDUMP_STACKWALK to its location. Full instructions are in\n" +
      "this script's doc comment.",
  );
  process.exit(1);
}

// Symbol files are large, so cache them somewhere that survives reboots:
// the platform's user cache directory rather than the temp directory.
function userCacheDir() {
  if (process.platform === "win32") {
    return process.env.LOCALAPPDATA ?? os.tmpdir();
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Caches");
  }
  return process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache");
}
const cacheDir = path.join(userCacheDir(), "dyad-symbol-cache");
const aliasedDir = path.join(cacheDir, "aliased");

// The modules a dump loaded, from a quick unsymbolicated pass.
function listModules(dump) {
  const result = spawnSync(binary, ["--json", dump], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0 || !result.stdout) {
    return [];
  }
  try {
    const modules = JSON.parse(result.stdout).modules ?? [];
    return modules.filter((m) => m.debug_file && m.debug_id);
  } catch {
    return [];
  }
}

// Both values come from the dump, which may be untrusted, and both are
// used as path segments. Only allow plain file names.
function safePathSegment(segment) {
  return (
    /^[A-Za-z0-9()., _-]+$/.test(segment) && segment !== "." && segment !== ".."
  );
}

// Installed builds rename Electron's binaries, which breaks by-name
// symbol lookup. Debug ids survive renaming and are unique per build,
// so fetching the Electron name by id is either right or a miss.
async function stageAliasedSymbols(dump) {
  for (const { debug_file, debug_id } of listModules(dump)) {
    if (!/dyad/i.test(debug_file)) {
      continue;
    }
    if (!safePathSegment(debug_file) || !safePathSegment(debug_id)) {
      continue;
    }
    const staged = path.join(
      aliasedDir,
      debug_file,
      debug_id,
      `${debug_file}.sym`,
    );
    if (fs.existsSync(staged)) {
      continue;
    }
    const candidates = [
      ...new Set([
        debug_file.replace(/dyad/i, "electron"),
        debug_file.replace(/dyad/i, "Electron"),
      ]),
    ];
    // Symbolication is optional: on any failure, warn and move on, and the
    // module's frames stay as module+offset.
    // Suffixed with the pid so concurrent runs cannot interleave writes
    // into the same partial file.
    const partial = `${staged}.${process.pid}.part`;
    try {
      for (const original of candidates) {
        const url = `${SYMBOL_URL}/${encodeURIComponent(original)}/${encodeURIComponent(debug_id)}/${encodeURIComponent(original)}.sym`;
        const response = await fetch(url);
        if (!response.ok) {
          continue;
        }
        console.error(
          `Fetching symbols for renamed binary "${debug_file}" (large; cached after the first run)...`,
        );
        fs.mkdirSync(path.dirname(staged), { recursive: true });
        // Download to a partial file and rename after success, so an
        // interrupted download is never cached as complete.
        await pipeline(
          Readable.fromWeb(response.body),
          fs.createWriteStream(partial),
        );
        fs.renameSync(partial, staged);
        break;
      }
    } catch (error) {
      fs.rmSync(partial, { force: true });
      console.error(
        `Symbol fetch for "${debug_file}" failed (${error?.message ?? error}); its frames will stay as module+offset.`,
      );
    }
  }
}

fs.mkdirSync(aliasedDir, { recursive: true });
let exitCode = 0;
for (const dump of dumps) {
  if (dumps.length > 1) {
    console.log(`\n===== ${dump} =====`);
  }
  await stageAliasedSymbols(dump);
  const result = spawnSync(
    binary,
    [
      "--symbols-url",
      SYMBOL_URL,
      "--symbols-cache",
      cacheDir,
      "--symbols-path",
      aliasedDir,
      ...flags,
      dump,
    ],
    { stdio: "inherit" },
  );
  // A failed dump should not prevent the remaining dumps from processing.
  if (result.status !== 0) {
    exitCode = result.status ?? 1;
    if (dumps.length > 1) {
      console.error(`minidump-stackwalk failed for ${dump}; continuing.`);
    }
  }
}
process.exit(exitCode);

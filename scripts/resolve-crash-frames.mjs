// Resolve crash telemetry frames to function names using Electron's
// public Breakpad symbol server. Crash events carry a faulting module's
// debug file, debug id, and module offset; this script turns those
// tuples into named functions without needing the original minidump.
//
// Usage:
//   node scripts/resolve-crash-frames.mjs <debugFile>/<debugId>/<hexOffset> [more ...]
//   node scripts/resolve-crash-frames.mjs --csv frames.csv
//   node scripts/resolve-crash-frames.mjs --bundle session.json [--all]
//   node scripts/resolve-crash-frames.mjs --help
//
// --bundle takes an uploaded chat session (or just its crashDumps
// object) and prints the scanned stacks of every crash dump in it. Those
// frames come from scanning each stack for code addresses, so they
// include false candidates; frames that do not resolve as return
// addresses are dropped unless --all is given.
//
// Example:
//   node scripts/resolve-crash-frames.mjs dyad/DF23C4907A7C231BEA2D1962BED725290/0x6ed35df
//
// The CSV file must have a header row with faulting_debug_file,
// faulting_debug_id, and faulting_offset columns. Values may be double
// quoted. Rows are split on plain commas, so values must not contain
// commas. Rows without a valid frame, such as rows from non-native
// crashes, are skipped with a warning.
//
// Prints one line per input frame: the module+offset and the resolved
// function name, or <unresolved> when no symbol covers the offset.
// Unresolved frames do not make the script exit nonzero; only usage
// errors do.
//
// Symbol files come from symbols.electronjs.org and can be hundreds of
// megabytes, so they are cached in the platform's user cache directory
// and reused across runs.
//
// Installed builds rename Electron's binaries to "dyad", while the
// symbol server hosts them under their original names. When a lookup
// by the reported name misses, the script retries with the Electron
// names for the same debug id, which renaming does not change, and
// caches the result under the reported name.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const SYMBOL_URL = "https://symbols.electronjs.org";

const USAGE = `Resolve crash telemetry frames to function names.

Usage:
  node scripts/resolve-crash-frames.mjs <debugFile>/<debugId>/<hexOffset> [more ...]
  node scripts/resolve-crash-frames.mjs --csv frames.csv
  node scripts/resolve-crash-frames.mjs --bundle session.json [--all]

--bundle resolves the crash dump stacks in an uploaded chat session JSON
file (or its crashDumps object). Scanned candidates that are not return
addresses are dropped unless --all is given.

Example:
  node scripts/resolve-crash-frames.mjs dyad/DF23C4907A7C231BEA2D1962BED725290/0x6ed35df

The CSV file needs a header row with faulting_debug_file,
faulting_debug_id, and faulting_offset columns. Rows are split on plain
commas, so values must not contain commas. Rows without a valid frame
are skipped with a warning.`;

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}

function usageError(message) {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(1);
}

// Frame fields come from CLI args or a CSV export and are used as URL
// and cache path segments. Only allow plain file names.
function safePathSegment(segment) {
  return (
    /^[A-Za-z0-9()., _-]+$/.test(segment) && segment !== "." && segment !== ".."
  );
}

// Returns why the frame cannot be used, or null when it is valid.
function frameProblem(frame) {
  const { debugFile, debugId, offsetText } = frame;
  if (!safePathSegment(debugFile) || !safePathSegment(debugId)) {
    return "bad debug file or debug id";
  }
  if (!/^(0x)?[0-9a-fA-F]+$/.test(offsetText)) {
    return `bad hex offset "${offsetText}"`;
  }
  return null;
}

function validateFrame(frame, source) {
  const problem = frameProblem(frame);
  if (problem !== null) {
    usageError(`In ${source}: ${problem}.`);
  }
  return frame;
}

function parseFrameArg(arg) {
  const parts = arg.split("/");
  if (parts.length !== 3 || parts.some((p) => p === "")) {
    usageError(`Expected <debugFile>/<debugId>/<hexOffset>, got "${arg}".`);
  }
  return validateFrame(
    { debugFile: parts[0], debugId: parts[1], offsetText: parts[2] },
    `"${arg}"`,
  );
}

function parseCsv(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    usageError(`Cannot read CSV file ${file} (${error?.message ?? error}).`);
  }
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    usageError(`CSV file ${file} is empty.`);
  }
  // PostHog exports wrap values in double quotes; unwrap them.
  const cell = (c) => c.trim().replace(/^"(.*)"$/, "$1");
  const header = lines[0].split(",").map(cell);
  const fileCol = header.indexOf("faulting_debug_file");
  const idCol = header.indexOf("faulting_debug_id");
  const offsetCol = header.indexOf("faulting_offset");
  if (fileCol < 0 || idCol < 0 || offsetCol < 0) {
    usageError(
      `CSV file ${file} must have faulting_debug_file, faulting_debug_id, and faulting_offset columns.`,
    );
  }
  // Exports can mix in rows from non-native crashes, whose faulting
  // fields are empty. Skip rows without a valid frame so the rest
  // still resolve.
  const frames = [];
  lines.slice(1).forEach((line, i) => {
    const cells = line.split(",").map(cell);
    if (cells.length !== header.length) {
      console.error(
        `Skipping ${file} row ${i + 2}: expected ${header.length} columns, got ${cells.length}; values with commas are not supported.`,
      );
      return;
    }
    const frame = {
      debugFile: cells[fileCol] ?? "",
      debugId: cells[idCol] ?? "",
      offsetText: cells[offsetCol] ?? "",
    };
    const problem = frameProblem(frame);
    if (problem !== null) {
      console.error(`Skipping ${file} row ${i + 2}: ${problem}.`);
      return;
    }
    frames.push(frame);
  });
  return frames;
}

// The crashDumps section of an uploaded session: { dumps, triggeringDump? }.
// Accepts the whole session or the section alone.
function readCrashDumps(file) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    usageError(
      `Cannot read session file ${file} (${error?.message ?? error}).`,
    );
  }
  const section = Array.isArray(parsed?.dumps) ? parsed : parsed?.crashDumps;
  if (!section || !Array.isArray(section.dumps)) {
    usageError(
      `${file} has no crash dumps (the reporter left them out, or Dyad predates them).`,
    );
  }
  return section;
}

const frames = [];
const bundles = [];
const showAll = args.includes("--all");
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--csv") {
    const file = args[i + 1];
    if (!file) {
      usageError("--csv needs a file path.");
    }
    frames.push(...parseCsv(file));
    i++;
  } else if (args[i] === "--bundle") {
    const file = args[i + 1];
    if (!file) {
      usageError("--bundle needs a file path.");
    }
    bundles.push(readCrashDumps(file));
    i++;
  } else if (args[i] === "--all") {
    continue;
  } else if (args[i].startsWith("-")) {
    usageError(`Unknown flag "${args[i]}".`);
  } else {
    frames.push(parseFrameArg(args[i]));
  }
}
if (frames.length === 0 && bundles.length === 0) {
  usageError("No frames given.");
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
const symDir = path.join(userCacheDir(), "dyad-symbol-cache", "sym");

// Fetch the module's .sym file into the cache and return its path, or
// null when no candidate name resolves. Renamed binaries miss under
// their reported name, so /dyad/i names retry as the Electron names for
// the same debug id; a hit is cached under the reported name.
async function ensureSymbols(debugFile, debugId) {
  const cached = path.join(symDir, debugFile, debugId, `${debugFile}.sym`);
  if (fs.existsSync(cached)) {
    return cached;
  }
  const candidates = [debugFile];
  if (/dyad/i.test(debugFile)) {
    candidates.push(
      debugFile.replace(/dyad/gi, "electron"),
      debugFile.replace(/dyad/gi, "Electron"),
    );
  }
  // Resolution is best effort: on any failure, warn and move on, and the
  // module's frames stay unresolved.
  // Suffixed with the pid so concurrent runs cannot interleave writes
  // into the same partial file.
  const partial = `${cached}.${process.pid}.part`;
  try {
    for (const name of candidates) {
      const url = `${SYMBOL_URL}/${encodeURIComponent(name)}/${encodeURIComponent(debugId)}/${encodeURIComponent(name)}.sym`;
      // Generous bound: symbol files are large and slow links are fine,
      // but a stalled connection must not hang the script forever.
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10 * 60 * 1000),
      });
      if (!response.ok) {
        continue;
      }
      console.error(
        `Downloading symbols for "${debugFile}" ${debugId} (large; cached after the first run)...`,
      );
      fs.mkdirSync(path.dirname(cached), { recursive: true });
      // Download to a partial file and rename after success, so an
      // interrupted download is never cached as complete.
      await pipeline(
        Readable.fromWeb(response.body),
        fs.createWriteStream(partial),
      );
      fs.renameSync(partial, cached);
      return cached;
    }
    console.error(
      `No symbols on ${SYMBOL_URL} for "${debugFile}" ${debugId}; its frames will stay unresolved.`,
    );
  } catch (error) {
    fs.rmSync(partial, { force: true });
    console.error(
      `Symbol fetch for "${debugFile}" ${debugId} failed (${error?.message ?? error}); its frames will stay unresolved.`,
    );
  }
  return null;
}

// Read the Breakpad .sym text format, keeping only what lookup needs.
// FUNC lines are "FUNC [m] <hexAddr> <hexSize> <paramSize> <name>" and
// PUBLIC lines are "PUBLIC [m] <hexAddr> <paramSize> <name>", where the
// name may contain spaces. The files can run to hundreds of megabytes,
// so parse line by line and drop everything else (line records, INLINE,
// FILE, STACK).
async function loadSymbols(symFile) {
  const funcs = [];
  const publics = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(symFile),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (line.startsWith("FUNC ")) {
      let rest = line.slice(5);
      if (rest.startsWith("m ")) {
        rest = rest.slice(2);
      }
      const a = rest.indexOf(" ");
      const b = rest.indexOf(" ", a + 1);
      const c = rest.indexOf(" ", b + 1);
      if (a < 0 || b < 0 || c < 0) {
        continue;
      }
      funcs.push({
        addr: parseInt(rest.slice(0, a), 16),
        size: parseInt(rest.slice(a + 1, b), 16),
        name: rest.slice(c + 1),
      });
    } else if (line.startsWith("PUBLIC ")) {
      let rest = line.slice(7);
      if (rest.startsWith("m ")) {
        rest = rest.slice(2);
      }
      const a = rest.indexOf(" ");
      const b = rest.indexOf(" ", a + 1);
      if (a < 0 || b < 0) {
        continue;
      }
      publics.push({
        addr: parseInt(rest.slice(0, a), 16),
        name: rest.slice(b + 1),
      });
    }
  }
  funcs.sort((x, y) => x.addr - y.addr);
  publics.sort((x, y) => x.addr - y.addr);
  // Upper bound of the addresses the file covers, used to keep the
  // PUBLIC fallback from matching offsets far past the module's code.
  let maxEnd = 0;
  for (const f of funcs) {
    maxEnd = Math.max(maxEnd, f.addr + f.size);
  }
  for (const p of publics) {
    maxEnd = Math.max(maxEnd, p.addr + 1);
  }
  return { funcs, publics, maxEnd };
}

// Last entry with addr at or below offset, by binary search.
function atOrBelow(entries, offset) {
  let lo = 0;
  let hi = entries.length - 1;
  let found = null;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (entries[mid].addr <= offset) {
      found = entries[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

// The FUNC whose [addr, addr+size) contains the offset wins; otherwise
// fall back to the nearest PUBLIC symbol at or below it. PUBLIC entries
// have no size, so the fallback only applies inside the address range
// the file covers; offsets past every known symbol stay unresolved.
function resolveOffset(table, offset) {
  const func = atOrBelow(table.funcs, offset);
  if (func && offset < func.addr + func.size) {
    return func.name;
  }
  if (offset >= table.maxEnd) {
    return null;
  }
  return atOrBelow(table.publics, offset)?.name ?? null;
}

// Each unique module is fetched and parsed once, then serves all of its
// frames.
const tables = new Map();
async function tableFor(debugFile, debugId) {
  const key = `${debugFile}\n${debugId}`;
  if (!tables.has(key)) {
    const symFile = await ensureSymbols(debugFile, debugId);
    tables.set(key, symFile ? await loadSymbols(symFile) : null);
  }
  return tables.get(key);
}

for (const { debugFile, debugId, offsetText } of frames) {
  const table = await tableFor(debugFile, debugId);
  const name = table ? resolveOffset(table, parseInt(offsetText, 16)) : null;
  console.log(`${debugFile}+${offsetText}  ${name ?? "<unresolved>"}`);
}

// Name for a scanned candidate, or null when it is not a plausible
// return address. A return address points just past a call, so the
// lookup uses offset - 1 to land on the call itself. Candidates that
// fall outside every function (data such as vtables and globals) or
// sit exactly on a function's first byte (a function pointer held in a
// local, which no call returns to) are rejected. The PUBLIC fallback is
// too loose to tell code from data, so it is used only when the module
// has no FUNC records at all.
function resolveReturnAddress(table, offset) {
  if (table.funcs.length === 0) {
    return resolveOffset(table, offset - 1);
  }
  // offset - 1 finds the function before one that starts at offset, so
  // the entry check looks up offset itself.
  if (atOrBelow(table.funcs, offset)?.addr === offset) return null;
  const func = atOrBelow(table.funcs, offset - 1);
  if (!func || offset - 1 >= func.addr + func.size) return null;
  return func.name;
}

// Module names come from the reporter's machine, so only plain names are
// looked up on the symbol server; the rest print unresolved.
async function moduleTable(module) {
  if (
    !module?.debugId ||
    !safePathSegment(module.debugFile) ||
    !safePathSegment(module.debugId)
  ) {
    return null;
  }
  return tableFor(module.debugFile, module.debugId);
}

async function printThread(stack, thread) {
  let shown = 0;
  let dropped = 0;
  for (const [i, frame] of thread.frames.entries()) {
    if (frame === "unknown") {
      console.log(
        `  #${shown++}  <no module>  (outside every module, e.g. JIT code)`,
      );
      continue;
    }
    const module = stack.modules[frame.module];
    const label = `${module?.name ?? "<bad module index>"}+${frame.offset}`;
    const table = await moduleTable(module);
    const offset = parseInt(frame.offset, 16);
    // Frame 0 is the instruction pointer itself, not a return address.
    let name = !table
      ? "<unresolved>"
      : i === 0
        ? (resolveOffset(table, offset) ?? "<unresolved>")
        : resolveReturnAddress(table, offset);
    if (name === null) {
      dropped++;
      if (!showAll) continue;
      name = "<dropped: not a return address>";
    }
    console.log(`  #${shown++}  ${label}  ${name}`);
  }
  if (dropped > 0 && !showAll) {
    console.log(
      `  (${dropped} scanned candidates were not return addresses; --all shows them)`,
    );
  }
}

for (const { dumps, triggeringDump } of bundles) {
  if (triggeringDump === null) {
    console.log(
      "Report started from the crash dialog; no readable dump was tied to that crash.\n",
    );
  } else if (
    triggeringDump !== undefined &&
    !dumps.some((dump) => dump.file === triggeringDump)
  ) {
    console.log(
      `Report is about ${triggeringDump}, but its dump was not included in this upload.\n`,
    );
  }
  for (const dump of dumps) {
    const facts = [dump.crashedAt, dump.ptype, dump.crashReason].filter(
      Boolean,
    );
    // A dump with no process label was matched only because the app did not
    // quit cleanly; a child that ran out of memory looks the same.
    const labeled = dump.ptype || dump.annotations?.process_type;
    const marker =
      dump.file !== triggeringDump
        ? ""
        : labeled
          ? "  <- the crash this report is about"
          : "  <- probably the crash this report is about (the dump has no process label)";
    console.log(`${dump.file}  (${facts.join(", ")})${marker}`);
    if (!dump.readable) {
      console.log("  <not a readable minidump>\n");
      continue;
    }
    if (!dump.stack) {
      console.log("  <no stack>\n");
      continue;
    }
    for (const thread of dump.stack.threads) {
      const role = thread.crashing
        ? thread.main
          ? "Crashing thread (main)"
          : "Crashing thread"
        : "Main thread";
      console.log(` ${role}:`);
      await printThread(dump.stack, thread);
    }
    console.log("");
  }
}

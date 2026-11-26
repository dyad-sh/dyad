"use strict";
// Loads MustardScript the way Dyad does and reports how it went (#5079).
// Usage: node probe.cjs fail|load
// Exit 0: the expectation held. 1: it did not. 2: inconclusive, because
// System32 already has vcruntime140.dll, so the "missing" state cannot occur.
const fs = require("node:fs");
const path = require("node:path");

const expectation = process.argv[2];
const systemDll = path.join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32",
  "vcruntime140.dll",
);
const bindingDir = path.join(
  __dirname,
  "node_modules",
  "@mustardscript",
  "binding-win32-x64-msvc",
);
console.log(
  JSON.stringify({
    expectation,
    node: process.version,
    system32HasVcruntime: fs.existsSync(systemDll),
    addonPresent: fs.existsSync(
      path.join(bindingDir, "index.win32-x64-msvc.node"),
    ),
    bindingHasVcruntime: fs.existsSync(
      path.join(bindingDir, "vcruntime140.dll"),
    ),
  }),
);
if (fs.existsSync(systemDll)) {
  console.log("INCONCLUSIVE: System32 already has vcruntime140.dll");
  process.exit(2);
}

try {
  const mustard = require("mustardscript");
  console.log(`LOADED: Mustard is a ${typeof mustard.Mustard}`);
  process.exit(expectation === "load" ? 0 : 1);
} catch (error) {
  console.log(`THREW ${error?.constructor?.name}: ${error?.message}`);
  const inner = Array.isArray(error?.errors) ? error.errors : [];
  for (const cause of inner) {
    console.log(`  inner ${cause?.code ?? ""}: ${cause?.message}`);
  }
  const matches =
    expectation === "fail" &&
    error instanceof AggregateError &&
    error.message.includes(
      "Unable to locate a MustardScript native addon for win32-x64-msvc",
    ) &&
    // The addon is present, so a "module not found" cause is the loader
    // failing to resolve one of its DLL imports.
    inner.some((cause) =>
      String(cause?.message).includes(
        "The specified module could not be found",
      ),
    );
  process.exit(matches ? 0 : 1);
}

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { patchSetup } = require("./prepare-vendor.cjs");

for (const newline of ["\n", "\r\n"]) {
  test(`patches the pinned extraction call with ${JSON.stringify(newline)} line endings`, () => {
    const source = [
      '#include "MachineInstaller.h"',
      "\texitCode = CUpdateRunner::ExtractUpdaterAndRun(lpCmdLine, false);",
    ].join(newline);
    const patched = patchSetup(source);
    assert.ok(patched.includes('#include "DyadInstallGuard.h"'));
    assert.ok(patched.includes('std::wstring(localAppData) + L"\\\\dyad"'));
    assert.ok(
      patched.indexOf("installGuard.Acquire") <
        patched.indexOf("ExtractUpdaterAndRun"),
    );
    assert.ok(patched.includes("if (!isQuiet)"));
    assert.throws(
      () => patchSetup(patched),
      /Unexpected Squirrel Setup source/,
    );
  });
}

test("refuses changed or ambiguous upstream entry points", () => {
  assert.throws(
    () => patchSetup("different source"),
    /Unexpected Squirrel Setup source/,
  );
  const call =
    "\texitCode = CUpdateRunner::ExtractUpdaterAndRun(lpCmdLine, false);";
  assert.throws(
    () => patchSetup('#include "MachineInstaller.h"\n' + call + call),
    /Unexpected Squirrel Setup source/,
  );
});

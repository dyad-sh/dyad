import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(
  new URL("./pnpm-install-retry.sh", import.meta.url),
);

for (const failures of [0, 2, 3]) {
  test(`pnpm warmup handles ${failures} failed registry attempts`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "dyad-pnpm-retry-"));
    try {
      const bin = path.join(root, "bin");
      const project = path.join(root, "template with spaces");
      const attempts = path.join(root, "attempts");
      await mkdir(bin);
      await mkdir(project);
      await writeFile(
        path.join(bin, "pnpm"),
        `#!/bin/bash
set -eu
test "$1" = install
test "$PWD" = "$(cd "$TEST_PROJECT" && pwd)"
echo attempt >> "$TEST_ATTEMPTS"
count=$(wc -l < "$TEST_ATTEMPTS")
if [ "$count" -le "$TEST_FAILURES" ]; then
  echo 'ETIMEDOUT: simulated registry failure' >&2
  exit 1
fi
`,
        { mode: 0o755 },
      );
      // Exercise the production backoff path without delaying the test.
      await writeFile(path.join(bin, "sleep"), "#!/bin/bash\nexit 0\n", {
        mode: 0o755,
      });
      const result = spawnSync("bash", [script, project], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}${path.delimiter}${process.env.PATH}`,
          TEST_PROJECT: project,
          TEST_ATTEMPTS: attempts,
          TEST_FAILURES: String(failures),
        },
      });
      assert.equal(result.status, failures === 3 ? 1 : 0, result.stderr);
      assert.equal(
        (await readFile(attempts, "utf8")).trim().split("\n").length,
        Math.min(failures + 1, 3),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

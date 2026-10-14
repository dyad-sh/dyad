import { stripVTControlCharacters } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import type { PwReport } from "./playwright_report";

const REMOVED_SCREENSHOT_MESSAGE =
  "Failure screenshot removed to protect credentials supplied to the test runner.";

/** Repair report references only after all opaque artifacts have been removed. */
async function removeDeletedAttachments(report: PwReport) {
  const visit = async (suites: PwReport["suites"]) => {
    for (const suite of suites ?? []) {
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests ?? []) {
          for (const result of test.results ?? []) {
            let removedScreenshot = false;
            const retained = [];
            for (const attachment of result.attachments ?? []) {
              if (attachment.path) {
                try {
                  await fs.access(attachment.path);
                } catch {
                  if (attachment.name === "screenshot")
                    removedScreenshot = true;
                  continue;
                }
              }
              retained.push(attachment);
            }
            result.attachments = retained;
            if (removedScreenshot) {
              if (result.error?.message) {
                result.error.message += `\n\n${REMOVED_SCREENSHOT_MESSAGE}`;
              } else {
                result.errors = [
                  ...(result.errors ?? []),
                  { message: REMOVED_SCREENSHOT_MESSAGE },
                ];
              }
            }
          }
        }
      }
      await visit(suite.suites);
    }
  };
  await visit(report.suites);
}

/** Sanitize owned reports after the runner exits, including failed/stopped runs. */
export async function redactTestRunArtifacts(
  directory: string,
  values: string[],
) {
  if (!values.some(Boolean)) return;
  const redactor = createTestOutputRedactor(values);
  const reports: string[] = [];
  const visit = async (current: string): Promise<void> => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (
        entry.isSymbolicLink() ||
        redactor.redact(entry.name) !== entry.name
      ) {
        await fs.rm(target, { recursive: true, force: true });
      } else if (entry.isDirectory()) {
        await visit(target);
      } else if (entry.isFile()) {
        // Traces, screenshots and arbitrary attachments may contain credentials
        // in compressed/encoded or visual form. Retain only sanitizable text.
        if (
          !/\.(json|md|txt|log)$/.test(entry.name) &&
          entry.name !== ".dyad-test-run"
        ) {
          await fs.rm(target, { force: true });
          continue;
        }
        const raw = await fs.readFile(target, "utf8");
        let clean = redactor.redact(raw);
        if (entry.name.endsWith(".json")) {
          try {
            const parsed = redactor.result(JSON.parse(raw));
            clean = JSON.stringify(parsed);
            if (parsed?.suites) reports.push(target);
          } catch {
            // A killed runner can leave incomplete JSON. Also redact escaped
            // credentials without requiring a complete report.
          }
          clean = redactor.redact(clean);
          for (const value of values.filter(Boolean)) {
            clean = clean
              .split(JSON.stringify(value).slice(1, -1))
              .join("[redacted]");
          }
        }
        await fs.writeFile(target, clean);
      }
    }
  };
  try {
    await visit(directory);
    for (const target of reports) {
      const report = JSON.parse(await fs.readFile(target, "utf8"));
      await removeDeletedAttachments(report);
      await fs.writeFile(target, JSON.stringify(report));
    }
  } catch {
    // Fail closed rather than retaining partially sanitized artifacts. Avoid
    // propagating filesystem errors whose paths may themselves contain secrets.
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {
      throw new Error("Could not remove unsanitized test artifacts.");
    });
    throw new Error(
      "Could not sanitize test artifacts; removed the run artifacts.",
    );
  }
}

/** Redact runner-only credentials before output or results leave the runner. */
export function createTestOutputRedactor(values: string[]) {
  const secrets = [...new Set(values.filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  const redact = (text: string) => {
    if (secrets.length) text = stripVTControlCharacters(text);
    for (const secret of secrets) text = text.split(secret).join("[redacted]");
    return text;
  };

  return {
    redact,
    result<T>(value: T): T {
      return JSON.parse(JSON.stringify(value), (_key, item) =>
        typeof item === "string" ? redact(item) : item,
      );
    },
    stream(emit: (chunk: string) => void) {
      let pending = "";
      let pendingControl = "";
      return {
        push(chunk: string) {
          if (secrets.length) {
            chunk = pendingControl + chunk;
            pendingControl = "";
            // Playwright inserts ANSI highlighting inside assertion values.
            // Keep incomplete CSI sequences until the next pipe chunk.
            const escapeIndex = chunk.lastIndexOf("\x1b");
            if (
              escapeIndex >= 0 &&
              /^\x1b(?:\[[0-?]*[ -/]*)?$/.test(chunk.slice(escapeIndex))
            ) {
              pendingControl = chunk.slice(escapeIndex);
              chunk = chunk.slice(0, escapeIndex);
            }
            chunk = stripVTControlCharacters(chunk);
          }
          pending += chunk;
          let output = "";
          while (pending) {
            const match = secrets.find((secret) => pending.startsWith(secret));
            if (match) {
              output += "[redacted]";
              pending = pending.slice(match.length);
            } else if (secrets.some((secret) => secret.startsWith(pending))) {
              break;
            } else {
              output += pending[0];
              pending = pending.slice(1);
            }
          }
          if (output) emit(output);
        },
        flush() {
          // A trailing partial credential must not escape on early termination.
          if (pending) emit("[redacted]");
          pending = "";
          pendingControl = "";
        },
      };
    },
  };
}

// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("Windows PR reviewer", () => {
  const workflow = parse(
    fs.readFileSync(".github/workflows/claude-windows-pr-review.yml", "utf8"),
  );
  const review = workflow.jobs["windows-review"];
  const post = workflow.jobs["post-windows-review"];
  const step = (name: string) =>
    review.steps.find((entry: { name: string }) => entry.name === name);

  it("isolates code execution from write credentials and trusted helpers", () => {
    const original = parse(
      fs.readFileSync(".github/workflows/claude-pr-review.yml", "utf8"),
    );
    const allowlist = /fromJSON\('([^']+)'\)/;
    const automaticAuthors =
      original.jobs["review-request"].if.match(allowlist)?.[1];
    expect(automaticAuthors).toBeTruthy();
    const executionAuthors = JSON.stringify(
      JSON.parse(automaticAuthors).filter(
        (author: string) =>
          !["princeaden1", "nourzakhama2003"].includes(author),
      ),
    );
    expect(review.if.replace(/\s+/g, " ").trim()).toBe(
      `github.event.action != 'closed' && contains( fromJSON('${executionAuthors}'), github.event.pull_request.user.login )`,
    );
    expect(step("PR Review").with.allowed_non_write_users).toBe("ryangroch");
    expect(workflow.on.pull_request_target.types).toContain("closed");
    expect(workflow.concurrency["cancel-in-progress"]).toBe(true);
    expect(review["runs-on"]).toBe("windows-2022");
    expect(workflow.permissions).toEqual({});
    expect(review.permissions).toEqual({
      contents: "read",
      "pull-requests": "read",
    });
    expect(
      review.steps.some((entry: { uses?: string }) =>
        entry.uses?.startsWith("actions/create-github-app-token@"),
      ),
    ).toBe(false);
    expect(step("Checkout trusted workflow repo").with.ref).toBe(
      "${{ github.sha }}",
    );
    const source = step("Checkout exact PR head for Windows execution").with;
    expect(source.ref).toBe("${{ github.event.pull_request.head.sha }}");
    expect(source.path).toBe("${{ env.REVIEW_SOURCE_PATH }}");
    expect(source["persist-credentials"]).toBe(false);
    expect(source["allow-unsafe-pr-checkout"]).toBe(true);
    const checkouts = [...review.steps, ...post.steps].filter(
      (entry: { uses?: string }) => entry.uses?.startsWith("actions/checkout@"),
    );
    for (const checkout of checkouts) {
      if (checkout.with !== source) {
        expect(checkout.with["allow-unsafe-pr-checkout"]).not.toBe(true);
      }
    }
    expect(post.needs).toBe("windows-review");
    const validation = post.steps.findIndex(
      (entry: { id?: string }) => entry.id === "validate-findings",
    );
    const token = post.steps.findIndex(
      (entry: { id?: string }) => entry.id === "post-token",
    );
    expect(validation).toBeGreaterThan(-1);
    expect(token).toBeGreaterThan(validation);
    const args = step("PR Review").with.claude_args;
    expect(args).toContain("--setting-sources user");
    expect(args).toContain('"Read,Glob,Grep,Bash,Edit,Write"');
  });

  it.each(["head-sha", "newer-sha"])(
    "checks that the reviewed source matches the API context (%s)",
    (headSha) => {
      const script = step("Verify context matches the checked-out PR head").with
        .script;
      const run = () =>
        new Function("require", "process", script)(
          (name: string) => {
            if (name === "node:fs") {
              return {
                readFileSync: () =>
                  JSON.stringify({ pullRequest: { headSha: "head-sha" } }),
              };
            }
            if (name === "node:child_process") {
              return { execFileSync: () => `${headSha}\r\n` };
            }
            throw new Error(`Unexpected module ${name}`);
          },
          { env: review.env },
        );
      if (headSha === "head-sha") expect(run).not.toThrow();
      else expect(run).toThrow("PR head changed");
    },
  );

  it.each(["\n", "\r\n"])(
    "renders all prompt variables and dependency failures with %j newlines",
    (newline) => {
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), "windows-review-prompt-"),
      );
      try {
        const templatePath = path.join(directory, "template.txt");
        const outputPath = path.join(directory, "prompt.txt");
        const githubOutput = path.join(directory, "github-output.txt");
        const template = fs
          .readFileSync(".github/prompts/claude-windows-pr-review.txt", "utf8")
          .replace(/\r?\n/g, newline);
        fs.writeFileSync(templatePath, template);
        const variables = {
          CONTEXT_PATH: review.env.REVIEW_CONTEXT_PATH,
          SOURCE_PATH: review.env.REVIEW_SOURCE_PATH,
          OUTPUT_MD_PATH: review.env.REVIEW_OUTPUT_PATH,
          OUTPUT_FINDINGS_PATH: review.env.REVIEW_FINDINGS_PATH,
          INSTALL_OUTCOME: "failure",
          TEST_SERVER_OUTCOME: "skipped",
        };
        // Check the workflow passes every variable required by the template.
        const render = step("Render Claude review prompt").env;
        for (const variable of Object.keys(variables)) {
          expect(render[variable]).toBeTruthy();
        }
        const result = spawnSync(
          process.execPath,
          ["scripts/issue-agent/render-template.mjs"],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              ...variables,
              TEMPLATE_PATH: templatePath,
              OUTPUT_PATH: outputPath,
              GITHUB_OUTPUT: githubOutput,
            },
          },
        );
        expect(result.status, result.stderr).toBe(0);
        const rendered = fs.readFileSync(outputPath, "utf8");
        expect(rendered).not.toMatch(/{{[A-Z0-9_]+}}/);
        expect(rendered).toContain("installation outcome: failure");
        expect(rendered).toContain("preparation outcome: skipped");
        expect(rendered).toContain(review.env.REVIEW_OUTPUT_PATH);
        expect(rendered).toContain(review.env.REVIEW_FINDINGS_PATH);
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});

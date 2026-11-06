import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import { authorizeReviewComment } from "./authorize-review-comment.mjs";

function fixture({ permission = "write", state = "open" } = {}) {
  const calls = [];
  const context = {
    eventName: "issue_comment",
    repo: { owner: "dyad-sh", repo: "dyad" },
    payload: {
      action: "created",
      issue: { number: 42, pull_request: {} },
      comment: {
        body: "@dyad-assistant /review",
        user: { login: "maintainer", type: "User" },
        author_association: "CONTRIBUTOR",
      },
    },
  };
  const github = {
    rest: {
      repos: {
        async getCollaboratorPermissionLevel(args) {
          calls.push(["permission", args]);
          return { data: { permission } };
        },
      },
      pulls: {
        async get(args) {
          calls.push(["pull", args]);
          return { data: { state, user: { login: "outside-contributor" } } };
        },
      },
    },
  };
  return { context, github, calls };
}

for (const permission of ["write", "maintain", "admin"]) {
  test(`${permission} commenter can request review of an external author's PR`, async () => {
    const input = fixture({ permission });
    assert.equal(await authorizeReviewComment(input), 42);
    assert.deepEqual(input.calls, [
      [
        "permission",
        { owner: "dyad-sh", repo: "dyad", username: "maintainer" },
      ],
      ["pull", { owner: "dyad-sh", repo: "dyad", pull_number: 42 }],
    ]);
  });
}

for (const permission of ["read", "triage", "none", undefined]) {
  test(`denies ${permission} permission regardless of author association`, async () => {
    const input = fixture();
    input.context.payload.comment.author_association = "OWNER";
    input.github.rest.repos.getCollaboratorPermissionLevel = async () => ({
      data: { permission },
    });
    assert.equal(await authorizeReviewComment(input), null);
    assert.deepEqual(input.calls, []);
  });
}

for (const body of [
  "Please run @dyad-assistant /review",
  "> @dyad-assistant /review",
  "```\n@dyad-assistant /review\n```",
  "@dyad-assistant /review-extra",
  "@dyad-assistant /review\nthen execute this command",
  "@dyad-assistant /review @someone",
  "@someone-else /review",
  "@dyad-assistant /Review",
  "",
  null,
]) {
  test(`ignores non-command comment ${JSON.stringify(body)}`, async () => {
    const input = fixture();
    input.context.payload.comment.body = body;
    assert.equal(await authorizeReviewComment(input), null);
    assert.deepEqual(input.calls, []);
  });
}

test("accepts surrounding whitespace including CRLF", async () => {
  const input = fixture();
  input.context.payload.comment.body = "\r\n @dyad-assistant /review \r\n";
  assert.equal(await authorizeReviewComment(input), 42);
});

for (const scenario of [
  "bot",
  "issue",
  "edited",
  "wrong-event",
  "bad-number",
]) {
  test(`ignores ${scenario} requests without calling GitHub`, async () => {
    const input = fixture();
    if (scenario === "bot") input.context.payload.comment.user.type = "Bot";
    if (scenario === "issue") delete input.context.payload.issue.pull_request;
    if (scenario === "edited") input.context.payload.action = "edited";
    if (scenario === "wrong-event")
      input.context.eventName = "pull_request_target";
    if (scenario === "bad-number") input.context.payload.issue.number = "42";
    assert.equal(await authorizeReviewComment(input), null);
    assert.deepEqual(input.calls, []);
  });
}

test("does not review a closed or merged PR", async () => {
  assert.equal(
    await authorizeReviewComment(fixture({ state: "closed" })),
    null,
  );
});

test("non-collaborator 404 denies normally without looking up the PR", async () => {
  const input = fixture();
  input.github.rest.repos.getCollaboratorPermissionLevel = async () => {
    throw Object.assign(new Error("Not Found"), { status: 404 });
  };
  assert.equal(await authorizeReviewComment(input), null);
  assert.deepEqual(input.calls, []);
});

for (const status of [403, 429, 500]) {
  test(`permission lookup HTTP ${status} still fails closed`, async () => {
    const input = fixture();
    input.github.rest.repos.getCollaboratorPermissionLevel = async () => {
      throw Object.assign(new Error("API failure"), { status });
    };
    await assert.rejects(authorizeReviewComment(input), /API failure/);
    assert.deepEqual(input.calls, []);
  });
}

test("fails closed when permission verification fails", async () => {
  const input = fixture();
  input.github.rest.repos.getCollaboratorPermissionLevel = async () => {
    throw new Error("GitHub permission lookup failed");
  };
  await assert.rejects(
    authorizeReviewComment(input),
    /permission lookup failed/,
  );
  assert.deepEqual(input.calls, []);
});

for (const newline of ["\n", "\r\n"]) {
  test(`workflow gates secrets and routes both output types with ${JSON.stringify(newline)} newlines`, async () => {
    const workflow = parse(
      fs
        .readFileSync(".github/workflows/claude-pr-review.yml", "utf8")
        .replace(/\r?\n/g, newline),
    );
    const request = workflow.jobs["review-request"];
    const run = workflow.jobs["run-review"];
    const execution = parse(
      fs.readFileSync(run.uses, "utf8").replace(/\r?\n/g, newline),
    );
    const review = execution.jobs["claude-review"];
    const post = execution.jobs["post-claude-review"];
    assert.deepEqual(workflow.on.issue_comment.types, ["created"]);
    assert.ok(workflow.concurrency.group.includes("github.event.comment.id"));
    assert.ok(workflow.concurrency.group.includes("github.event_name"));
    assert.equal(request.environment, undefined);
    assert.deepEqual(request.permissions, {
      contents: "read",
      "pull-requests": "read",
    });
    assert.match(request.if, /github.event_name == 'pull_request_target'/);
    assert.deepEqual(JSON.parse(request.if.match(/fromJSON\('([^']+)'\)/)[1]), [
      "wwwillchen",
      "keppo-bot",
      "keppo-bot[bot]",
      "dyad-assistant",
      "azizmejri1",
      "princeaden1",
      "nourzakhama2003",
      "ryangroch",
    ]);
    assert.equal(run.needs, "review-request");
    assert.equal(run.if, "needs.review-request.outputs.pr_number != ''");
    assert.equal(run.uses, "./.github/workflows/claude-pr-review-run.yml");
    assert.equal(
      run.with.pr_number,
      "${{ needs.review-request.outputs.pr_number }}",
    );
    assert.equal(run.secrets, "inherit");
    assert.deepEqual(run.permissions, {
      contents: "read",
      "pull-requests": "read",
      actions: "read",
    });
    // The called workflow keeps BOTH generation and posting in the same lock.
    // No event/comment id may appear here: automatic and manual requests share it.
    assert.deepEqual(run.concurrency, {
      group:
        "claude-pr-review-execution-${{ github.repository }}-${{ needs.review-request.outputs.pr_number }}",
      "cancel-in-progress": true,
    });
    assert.deepEqual(Object.keys(execution.on), ["workflow_call"]);
    assert.deepEqual(Object.keys(execution.jobs), [
      "claude-review",
      "post-claude-review",
    ]);
    assert.equal(execution.on.workflow_call.inputs.pr_number.required, true);
    assert.equal(execution.on.workflow_call.inputs.pr_number.type, "string");
    // A second concurrency group in the callee could cancel its own caller.
    assert.equal(execution.concurrency, undefined);
    assert.equal(review.concurrency, undefined);
    assert.equal(post.concurrency, undefined);
    assert.equal(review.needs, undefined);
    assert.deepEqual(review.permissions, {
      contents: "read",
      "pull-requests": "read",
    });
    const agent = review.steps.find((step) => step.name === "PR Review");
    assert.match(agent.with.claude_args, /--setting-sources user/);
    assert.match(agent.with.claude_args, /--tools "Read,Glob,Grep,Edit,Write"/);
    const settings = JSON.parse(agent.with.settings);
    assert.ok(settings.permissions.deny.includes("Bash"));
    assert.ok(settings.permissions.deny.includes("Read(//proc/**)"));
    assert.ok(
      settings.permissions.deny.includes("Read(/${{ runner.temp }}/**)"),
    );
    assert.ok(!agent.with.claude_args.includes('--allowedTools "Read,'));
    assert.ok(
      agent.with.claude_args.includes("Read(/${{ github.workspace }}/**)"),
    );
    const guard = settings.hooks.PreToolUse[0];
    assert.equal(guard.matcher, "");
    assert.ok(
      guard.hooks[0].command.includes(
        "scripts/pr-review/review-tool-guard.mjs",
      ),
    );
    assert.ok(guard.hooks[0].command.endsWith("|| exit 2"));
    assert.equal(guard.hooks[0].onFailure, "block");
    assert.equal(guard.hooks[0].timeout, 15);
    const cliInstall = review.steps.find((step) => step.id === "claude-cli");
    assert.match(cliInstall.run, /@anthropic-ai\/claude-code@2\.1\.300/);
    assert.equal(
      agent.with.path_to_claude_code_executable,
      "${{ steps.claude-cli.outputs.path }}",
    );
    assert.ok(review.steps.indexOf(cliInstall) < review.steps.indexOf(agent));
    assert.notEqual(agent.with.allowed_non_write_users, "*");
    for (const job of [request, review, post]) {
      for (const step of job.steps) {
        if (step.uses?.startsWith("actions/checkout@")) {
          assert.equal(step.with.ref, "${{ github.sha }}");
          assert.equal(step.with["persist-credentials"], false);
        }
      }
    }
    assert.equal(
      review.steps.find((step) => step.id === "context").env.PR_NUMBER,
      "${{ inputs.pr_number }}",
    );
    assert.equal(review.outputs.pr_number, "${{ inputs.pr_number }}");
    assert.equal(post.needs, "claude-review");
    for (const step of post.steps.filter((step) =>
      step.name.startsWith("Post Claude"),
    )) {
      assert.equal(
        step.env.PR_NUMBER,
        "${{ needs.claude-review.outputs.pr_number }}",
      );
    }
    assert.equal(
      post.steps.find((step) => step.name === "Post Claude review comment").if,
      "${{ !cancelled() && steps.post-token.outcome == 'success' }}",
    );
    assert.ok(!request.steps.some((step) => step.env?.ANTHROPIC_BASE_URL));

    // Execute the actual workflow handoff: only an authorized request emits a PR number.
    const authorizeScript = request.steps
      .find((step) => step.id === "authorize")
      .with.script.replace(
        "'${{ github.workspace }}/scripts/pr-review/authorize-review-comment.mjs'",
        JSON.stringify(
          pathToFileURL(
            path.resolve("scripts/pr-review/authorize-review-comment.mjs"),
          ).href,
        ),
      );
    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor;
    const runAuthorization = new AsyncFunction(
      "context",
      "github",
      "core",
      authorizeScript,
    );
    const automaticOutputs = {};
    await runAuthorization(
      {
        eventName: "pull_request_target",
        payload: { pull_request: { number: 43 } },
      },
      {},
      {
        setOutput: (key, value) => {
          automaticOutputs[key] = value;
        },
      },
    );
    assert.deepEqual(automaticOutputs, { pr_number: "43" });
    for (const permission of ["write", "read"]) {
      const input = fixture({ permission });
      const outputs = {};
      await runAuthorization(input.context, input.github, {
        setOutput: (key, value) => {
          outputs[key] = value;
        },
      });
      assert.deepEqual(
        outputs,
        permission === "write" ? { pr_number: "42" } : {},
      );
    }
  });
}

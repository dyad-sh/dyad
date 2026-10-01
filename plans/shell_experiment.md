# Pro Agent shell experiment with mandatory safety review

## Summary

Add an opt-in **Shell tool (Pro)** experiment using Bash on macOS/Linux and PowerShell on Windows. Every command must pass `gpt-6-luna` review before execution. Routine app and cloud work can be approved automatically. Consequential actions lacking sufficient authorization require one-time approval of the exact command. Clear safety violations remain blocked; unavailable reviews offer a retry that cannot execute the command.

Use shared review infrastructure for MCP and shell commands, with separate policies and outcomes.

## Settings and tool interface

- Add top-level `UserSettings.enableShellTool`, defaulting to `false`, with an Experiments toggle, Settings search entry, and default-setting snapshot coverage.
- Explain that commands run on the user's machine and consume Pro credits for review; this is not filesystem isolation.
- Expose `run_shell({ command, description, timeout_ms? })` only to the root Agent on Pro-funded turns using a local runtime. Exclude Build, Ask, Plan, sub-agents, Free-mode turns, Docker, and cloud runtimes.
- Limit command text to 9,000 UTF-16 code units on Windows (to fit the encoded command line) and 16,000 elsewhere. Choose the shell automatically by OS. Fix the starting directory to the app directory; expose neither environment overrides nor a selectable executable.
- Default execution timeout to 60 seconds, capped at five minutes. Return bounded output, exit status, and distinct blocked, cancelled, timed-out, and failed outcomes.

## Review pattern and policy

- Extract MCP's model invocation, bounded context formatting, timeout, cancellation, and validated decision parsing into a shared reviewer runner. Preserve MCP's existing `allow/ask` policy and fallback.
- Add a shell scaffold and separate policy based on the [pinned Codex Guardian policy](https://github.com/openai/codex/blob/7498521d288b9b3b96ffba4eedf089d8d6e06a84/codex-rs/prompts/templates/guardian/policy.md). Shell decisions are `allow/ask/block`, with a short reason naming the target, effect, and concern.
- Evaluate actual effects, user authorization, destructive scope, sensitive-data egress, credential probing, and security weakening. Explicit authorization can permit consequential app actions when it covers the target and effect and no other policy rule blocks them.
- Supply the exact command, shell, working directory, recent user intent, current-turn tool history, available dedicated tools, and Dyad's automatic lifecycle behavior. Tool output and repository content remain untrusted evidence.
- Let the reviewer obtain bounded, read-only app-file and path evidence when needed to understand scripts or destructive targets. Never execute commands to investigate them; block when effects remain unclear.
- Reject shell equivalents only when a dedicated tool supports the actual operation, target, and required options. Local preview logs do not replace cloud logs. Permit fallback only after a recorded execution failure of the relevant tool—not permission denial, safety rejection, or disabled access. Review that fallback independently.
- Use a 45-second shell review deadline, including evidence collection and model setup; MCP consent retains its eight-second deadline. Timeout, malformed output, unavailable model, or missing context prevents spawning and offers a distinct Review unavailable / Retry review flow. Cancellation propagates through review and execution.
- Reserve the last model step for a verdict by disabling inspection tools. Retain content hashes across metadata-only reinspections and reconcile provider effects only after successful command completion, never after a failed partial update.
- Review every invocation afresh. Generic “always allow” tool consent must never bypass review or a required one-time consequential-action approval.

## Execution, lifecycle, and presentation

- Run Bash without startup profiles and PowerShell without profiles or interactive prompts. Invoke the resolved executable directly with argument arrays, avoiding an intermediate `cmd.exe`.
- Support foreground, noninteractive commands only. Reject background jobs, persistent servers, privilege escalation, and unrelated machine administration.
- Avoid injecting Dyad credentials; pass only the host environment required for app commands. Keep command text out of general telemetry.
- Preserve host CLI profiles, authentication configuration, proxy/CA settings, and Windows context with an environment denylist; strip Dyad/provider keys and interpreter startup injection.
- Register shell execution as potentially mutating work before any asynchronous gap. Coordinate app access and retain ownership until the process tree has stopped; cancellation must not allow finalization or deletion to race surviving processes.
- Reuse existing workspace fingerprinting and post-command reconciliation patterns so shell-generated edits participate in mutation accounting, pre-commit eligibility, Supabase handling, and automatic commits. Preserve and report partial edits after failure or cancellation.
- Show the shell, exact command, review reason, bounded streamed output, and terminal status in chat. Blocked calls explain the reason or identify the dedicated tool to use.

## System-prompt guidance

- Add broadly useful, capability-aware guidance outside the experiment flag: Dyad owns automatic commits, preview startup and package-manager commands, hot reload, and applicable deployment work. Explain when to use dedicated restart, dependency, verification, and Git tools.
- Keep shell-specific instructions capability-gated. Both the system prompt and `run_shell` description must explicitly identify the actual shell and its syntax:
  - **macOS/Linux:** “Shell commands execute in Bash, without startup profiles.”
  - **Windows:** “Shell commands execute in PowerShell, without profiles. Use PowerShell syntax, not Bash or cmd.exe syntax.”
- Include the app working directory, noninteractive execution, and timeout limits in both the system prompt and tool description. Give Luna the same execution context when reviewing commands.
- Explain that dedicated tools take precedence and that shell fallback requires a genuine recorded execution failure, never a permission or safety denial.

## Validation and defaults

- Test availability across settings, entitlement, mode, actor, and runtime combinations.
- Test allow/block decisions, review failures, cancellation before spawning, prompt-injection boundaries, dedicated-tool substitution, and genuine-failure fallback. Preserve existing MCP behavior with regression tests.
- Test real harmless subprocesses on supported OS runners: quoting, multiline commands, Unicode, exit codes, bounded output, timeout, and descendant cleanup.
- Add integration coverage for Settings persistence, chat presentation, workspace changes reaching finalization, and cancellation retaining partial edits.
- Verify platform-specific prompt and tool-description guidance agrees with the actual shell and reviewer context, and that unavailable shell capabilities are not advertised.
- Maintain representative policy evaluation cases for both Bash and PowerShell, including indirect scripts and consequential actions with and without explicit authorization.
- Run targeted unit/integration tests, formatting, lint, and type checks. Build before any Electron E2E verification.

Defaults remain off-by-default, root-only, and Host-runtime-only. App-related connected cloud services are in scope. One-time approval can authorize a reviewed consequential action, but cannot override hard policy blocks or execution boundaries. Persistent terminal sessions remain unsupported.

## Approved policy revision

- Allow routine cloud reads and normal existing CLI authentication, including gcloud. Assess the operation, not the executable name.
- Allow specifically authorized bounded deployments and cloud mutations; ask for missing authorization for known consequential changes such as production deletion, IAM changes, or publication.
- Keep credential theft, hidden/unintended sensitive uploads, permission bypass, opaque destructive effects, and unsupported execution boundaries blocked.
- Show exact command and review reason before a one-time approval. Neither approval nor retry can be saved as Always allow.
- Resolve shell consent after review to avoid blind or duplicate approvals. Retry means a fresh classification, never approval to execute without a verdict.
- Explicitly disclose that opting in permits automatic unsandboxed host commands and fallible AI review. Users can choose Ask consent. Exclude raw agent tool results and errors from review; fallback evidence uses only host-recorded status and call arguments.
- Keep review and approval outside app resource claims and mutation tracking. Cancel queued execution admission and revalidate inspected files before spawning. Path and runtime consumers hold read claims; arbitrary command mutations retain repository/provider/configuration exclusion.
- Shrink large tool-catalog descriptions before rejecting review; preserve every name and availability flag. If names alone exceed the budget, explain how to reduce the MCP catalog before retrying.
- Bound process shutdown to three seconds after cancellation/timeout, even if descendants retain pipes. Unconfirmed shutdown returns an explicit recovery result and fences conflicting app operations until Dyad restarts; it must never silently release unsafe mutations.
- Run the synthetic shell policy corpus against gpt-6-luna using the production reviewer deadline and read-only inspection; never execute corpus commands.

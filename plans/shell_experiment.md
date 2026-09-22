# Pro Agent shell experiment with mandatory safety review

## Summary

Add an opt-in **Shell tool (Pro)** experiment using Bash on macOS/Linux and PowerShell on Windows. Every command must pass `gpt-5.6-luna` review before execution. Rejections, uncertainty, and review failures block execution without a manual override.

Use shared review infrastructure for MCP and shell commands, with separate policies and outcomes.

## Settings and tool interface

- Add top-level `UserSettings.enableShellTool`, defaulting to `false`, with an Experiments toggle, Settings search entry, and default-setting snapshot coverage.
- Explain that commands run on the user's machine and consume Pro credits for review; this is not filesystem isolation.
- Expose `run_shell({ command, description, timeout_ms? })` only to the root Agent on Pro-funded turns using a local runtime. Exclude Build, Ask, Plan, sub-agents, Free-mode turns, Docker, and cloud runtimes.
- Choose the shell automatically by OS. Fix the starting directory to the app directory; expose neither environment overrides nor a selectable executable.
- Default execution timeout to 60 seconds, capped at five minutes. Return bounded output, exit status, and distinct blocked, cancelled, timed-out, and failed outcomes.

## Review pattern and policy

- Extract MCP's model invocation, bounded context formatting, timeout, cancellation, and validated decision parsing into a shared reviewer runner. Preserve MCP's existing `allow/ask` policy and fallback.
- Add a shell scaffold and separate policy based on the [pinned Codex Guardian policy](https://github.com/openai/codex/blob/7498521d288b9b3b96ffba4eedf089d8d6e06a84/codex-rs/prompts/templates/guardian/policy.md). Shell decisions are `allow/block`, with a short reason.
- Evaluate actual effects, user authorization, destructive scope, sensitive-data egress, credential probing, and security weakening. Explicit authorization can permit consequential app actions when it covers the target and effect and no other policy rule blocks them.
- Supply the exact command, shell, working directory, recent user intent, current-turn tool history, available dedicated tools, and Dyad's automatic lifecycle behavior. Tool output and repository content remain untrusted evidence.
- Let the reviewer obtain bounded, read-only app-file and path evidence when needed to understand scripts or destructive targets. Never execute commands to investigate them; block when effects remain unclear.
- Reject shell equivalents of dedicated tools. Permit fallback only after a recorded execution failure of the relevant tool—not permission denial, safety rejection, or disabled access. Review that fallback independently.
- Use an eight-second review deadline, including evidence collection. Timeout, malformed output, unavailable model, or missing context prevents spawning. Cancellation propagates through review and execution.
- Review every invocation afresh. Generic “always allow” tool consent must never bypass review.

## Execution, lifecycle, and presentation

- Run Bash without startup profiles and PowerShell without profiles or interactive prompts. Invoke the resolved executable directly with argument arrays, avoiding an intermediate `cmd.exe`.
- Support foreground, noninteractive commands only. Reject background jobs, persistent servers, privilege escalation, and unrelated machine administration.
- Avoid injecting Dyad credentials; pass only the host environment required for app commands. Keep command text out of general telemetry.
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

Defaults are off-by-default, root-only, local-runtime-only, with no approval override or persistent terminal sessions.

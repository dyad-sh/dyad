# Triage playbook

Known situations and what to tell the reporter. Every entry comes from a reply a
maintainer has already written by hand. Use the wording here, in product terms,
and cite the entry id in `playbookMatch`. If nothing matches, say so with
`"playbookMatch": null` so the team can add an entry.

Links you may use in reporter-facing text: https://www.dyad.sh/download,
https://www.dyad.sh/docs/..., https://nodejs.org, https://www.githubstatus.com,
https://status.supabase.com, and issues or PRs in this repository. No other links.

---

### id: empty-report

**When you see:** an in-app report (`Session ID:` and `## System Information`
present) whose Issue Description, Expected Behavior, and Actual Behavior are
blank.

**Assessment:** `needs_info`

**Tell the reporter:** we can't tell yet what went wrong. Ask what they were
doing and what they saw, plus a screenshot. If `Screenshot status: captured`
but no image is attached, use `screenshot_not_attached`. If the version is
behind, add the update step.

**Title:** `[session report] No description (Dyad <version>, <Windows|macOS|Linux>)`
unless the main Logs section shows one clear user-facing failure, in which case
name that failure instead.

**Ignore:** the `## Auto-Updater Logs` section and any Squirrel, Update.exe, or
CheckForUpdate lines. That is a background update check tracked in #4466; it is
not what the reporter saw. Do not title the issue after it and do not list it
as the problem. You may mention in the summary that the automatic update check
failed, as a reason to update by hand.

**Source:** 73 of the last 300 issues; #4408, #4393, #4263.

---

### id: node-not-found-windows

**When you see:** `'node' is not recognized as an internal or external command`,
`spawn node ENOENT`, or pnpm not found, on Windows.

**Assessment:** `environment_setup`

**Tell the reporter:** Dyad can't find Node.js on the computer, which it needs to
run the app. Steps:

1. Install Node.js from https://nodejs.org (pick the LTS version).
2. Quit Dyad completely and open it again.
3. If it still doesn't work, open **Settings**, find **Node.js Path
   Configuration**, and click **Browse for Node.js** to point Dyad at the folder
   where Node.js was installed.

**Source:** #3665, #3348, #4188, #4189, #3612, #4456. Verified on 1.13.0.

---

### id: pnpm-engine-mismatch

**When you see:** `ERR_PNPM_UNSUPPORTED_ENGINE` or dependency installation failing
on a project imported from another tool.

**Assessment:** `environment_setup`

**Tell the reporter:** paste this into the chat and send it:

> Fix the dependency installation error. If ERR_PNPM_ENGINE reports that the
> project's engines.pnpm range excludes the current pnpm version, update only
> package.json by preserving the existing range and adding the current pnpm
> major version (for example, change ^9 || ^10 to ^9 || ^10 || ^11). Then retry
> the dependency installation once.

Ask whether the project was imported from another tool.

**Source:** #4455, #3497. Verified on 1.13.0.

---

### id: context-too-long

**When you see:** "maximum context length", "too many tokens", or a request that
fails because the conversation is too large.

**Assessment:** `likely_dyad_bug` if on a version older than 1.13.0, otherwise
`needs_info`.

**Tell the reporter:** start a new chat for the next task. If they set a very
large max output tokens value for the model, lower it. Update to 1.13.0 or
newer, which handles this better.

**Source:** #4421, #4355, #1558, #1827. Verified on 1.13.0.

---

### id: pro-credits-out-use-own-key

**When you see:** Dyad Pro credits are used up, a daily chat limit message, or
the reporter wants Dyad to use their own API key instead of Pro.

**Assessment:** `question`

**Tell the reporter:** click the **Pro** button next to the model picker and turn
off **Enable Dyad Pro**. Dyad will use their own API key until they turn it
back on.

**Source:** #4392, #4388. Verified on 1.12.0.

---

### id: credits-billing

**When you see:** credits consumed by failed requests, credits not refreshed
after payment, or charged more than expected.

**Assessment:** `needs_human`

**Tell the reporter:** someone from the Dyad team will check the account. Ask
for the session id (**Help** > **Upload Chat Session**) and roughly how many
credits were affected. Never promise a refund or credit adjustment.

**Source:** #3394, #3611, #3658, #4140, #4354, #3610.

---

### id: neon-token-refresh

**When you see:** Neon integration fails with "Token refresh failed".

**Assessment:** `external_service`

**Tell the reporter:** open **Settings**, go to Integrations, click **Disconnect
from Neon**, then open **Manage app** and connect to Neon again.

**Source:** #4316. Verified on 1.11.0.

---

### id: github-push-or-connect-fails

**When you see:** "Sync to GitHub" or "Connect to GitHub" fails, "GitHub
operation failed", or GitHub returns HTML instead of JSON.

**Assessment:** `external_service` when the service status says GitHub has an
incident, otherwise `needs_info`.

**Tell the reporter:** check https://www.githubstatus.com. If there are
uncommitted changes, click **Review & commit** first, then try again. Point to
https://www.dyad.sh/docs/integrations/github#troubleshooting.

**Source:** #3959, #4318, #3406, #3398. Verified on 1.12.0.

---

### id: supabase-deploy

**When you see:** a Supabase edge function deploy is stuck, or every edge
function redeploys when only one changed.

**Assessment:** `external_service` when Supabase has an incident, otherwise
`likely_dyad_bug`.

**Tell the reporter:** check https://status.supabase.com. Restoring an earlier
version from **Versions** redeploys the functions. Since 1.11.0 there is a
button to push edge functions by hand.

**Source:** #4172, #3635. Verified on 1.11.0.

---

### id: git-repo-corrupted

**When you see:** "Not a git repository", "Failed to resolve ref 'HEAD'", or the
app's git history is broken.

**Assessment:** `environment_setup`

**Tell the reporter:** open **Manage app**, click the overflow menu (three dots,
top right), and choose **Copy app** without history. Or use **Import App** on
the home screen to import the folder again.

**Source:** #4241, #3657, #3552. Verified on 1.10.0.

---

### id: import-folder-exists

**When you see:** importing an app fails because a folder with that name already
exists in `dyad-apps` (often after a crash mid-import).

**Assessment:** `fixed_in_release` (1.10.0-beta.3)

**Tell the reporter:** delete or rename that folder inside `dyad-apps`, then
import again. Newer versions handle this automatically.

**Source:** #4217.

---

### id: app-name-invalid

**When you see:** an app name with a trailing dot, spaces, or other unusual
characters causing path errors or @-mention problems.

**Assessment:** `likely_dyad_bug`

**Tell the reporter:** rename the app to letters, numbers, and dashes.

**Source:** #3782, #4168.

---

### id: network-dns

**When you see:** "TypeError: terminated", "fetch failed", ENOTFOUND, or AI
requests failing while the Dyad servers report no errors.

**Assessment:** `environment_setup`

**Tell the reporter:** try another network (a phone hotspot works) or turn off
any VPN, then try again.

**Source:** #4167, #4165, #3653, #4107.

---

### id: fable-refusal

**When you see:** Claude Fable refuses, or "Each tool_use block must have a
corresponding tool_result block", especially on security-related tasks.

**Assessment:** `external_service`

**Tell the reporter:** use Opus or GPT for security reviews and similar tasks;
Fable declines some of them. Since 1.8.0-beta.1 Dyad shows a warning when this
happens.

**Source:** #3747, #3922.

---

### id: crash-force-close

**When you see:** Dyad quits on its own, freezes, or force closes.

**Assessment:** `needs_human`

**Tell the reporter:** update to the latest version (stability work landed in
1.7.0). Then, if it happens again, open **Help** > **Upload Chat Session** and
paste the session id here. If logs are trimmed, the team may ask for the `main`
log file from `%APPDATA%\dyad\logs` on Windows.

**Source:** #3490, #4294, #3863, #3980.

---

### id: macos-too-old

**When you see:** errors on macOS 10.15 (Catalina) or earlier.

**Assessment:** `environment_setup`

**Tell the reporter:** Dyad needs a recent version of macOS; upgrade macOS and
try again.

**Source:** #4250.

---

### id: model-missing-or-new-provider

**When you see:** a model disappeared from the list, or a request to add a
specific model or provider.

**Assessment:** `feature_request`

**Tell the reporter:** add it as a custom model, see
https://www.dyad.sh/docs/guides/ai-models/custom-models. New built-in providers
are only added when there is clear demand.

**Source:** #4425, #4322, #4293.

---

### id: user-app-bug

**When you see:** the problem is inside the app the reporter built (a request
loop, a runtime error in their code, their page failing), not in Dyad itself.

**Assessment:** `user_app_issue`

**Tell the reporter:** this is coming from the app rather than from Dyad. Switch
to Agent mode and ask Dyad to find the cause.

**Source:** #4359.

---

### id: old-version

**When you see:** the reporter's Dyad version is behind the current one.

**Assessment:** keep whatever else applies; add the step below.

**Tell the reporter:** download the latest version from
https://www.dyad.sh/download. If a release fixed this exact problem, say which
version and set `fixedIn`.

**Source:** #3837, #3859, #3513, #4287, #4295.

---

### id: build-mode-large-app

**When you see:** Build mode making poor or partial edits on a large app, or a
weak model behaving badly in Agent mode.

**Assessment:** `question`

**Tell the reporter:** use Agent mode for larger apps, and a stronger model if
the current one is a small or older model.

**Source:** #3815, #3773.

---

### id: windows-crlf-staging

**When you see:** git staging fails on Windows with CRLF line ending warnings.

**Assessment:** `fixed_in_release` (1.5.0-beta.1, PR #3683)

**Tell the reporter:** update to the latest version.

**Source:** #3682.

---

### id: third-party-balance

**When you see:** a balance or quota shown by a third-party model router is
wrong.

**Assessment:** `external_service`

**Tell the reporter:** that balance is managed by the provider, not by Dyad;
contact them directly.

**Source:** #3974.

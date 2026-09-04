# Issue Triage v2: a first reply that actually helps

> Proposal, 2026-09-03. Based on the 300 most recent issues (#3391 to #4456, May 11 to Sep 3, 2026) and the maintainer's 205 replies on them.

## Summary

Today the triage bot posts up to three canned comments on a new issue: "please write in English", "please fill in all the fields", and a "this might be a duplicate" list. The duplicate list is the only substantive content, and for the non-developers who file most of our issues it rarely helps. Meanwhile the maintainer's own first replies fall into a handful of repeatable patterns that the bot could produce in most cases.

Proposal: replace the three comments with **one reply** that

1. says plainly what we think is going on (a bug in Dyad, already fixed, an outside service, a setup problem, a problem in the app they built, or "we can't tell yet"),
2. gives steps in product terms when there is a known fix or workaround,
3. points to the one or two existing reports worth following, with their outcome,
4. asks for exactly the missing information,
5. tucks technical notes for the team into a `<details>` block,

backed by a **maintained playbook** of known problems and their answers so the bot is consistent with what we say by hand.

## What the bot does today

|                                                                     |              Count (of 300) |
| ------------------------------------------------------------------- | --------------------------: |
| Got a "might be a duplicate" comment                                |                         132 |
| Got a "fill in all the fields" comment                              |                         103 |
| Got a "please write in English" comment                             |                           6 |
| Got no comment from anyone                                          |                          42 |
| Got no labels at all (triage failed silently, see #4427)            |                          41 |
| Reporter replied after the duplicate comment                        |                   32 of 132 |
| Closed as a duplicate because of the bot's list                     |                           0 |
| Duplicate lines posted, by confidence                               | 150 high, 69 medium, 17 low |
| Duplicate comments that included a workaround (`helpfulSuggestion`) |                   34 of 132 |

## What we learned

### 1. The bot invents titles from log noise, then finds "duplicates" of its own titles

In-app reports arrive titled `[session report] <add title>` with the description blank. Task 3 of the prompt then rewrites the title. In **23 cases** it chose "Squirrel auto-update 404 error on Windows", taken from the Auto-Updater Logs section that PR #3800 added to every Windows report. None of those 23 reporters described an update problem. One replied at all, with a screenshot of something else. Each time, the maintainer asked "what issue are you having?" (#4408, #4395, #4373, #4181, #3979, #3962, #3915).

The duplicate step then linked each new one to the previous ones (#4408 links #4395, #4384, #4373, which link #4299, #4297, and so on), producing a chain of 23 issues carrying zero information about what anyone actually saw.

There is a real question hiding in there (why does the Windows update check 404 for so many people, all on old versions?), but it belongs in one tracked issue for the team, not in 23 user-facing titles.

### 2. One report in four is empty, and the bot's reply doesn't use what the report contains

73 of 300 issues have a blank or placeholder title or description. The bot says "Please fill in all the fields in the issue so we can help you. A screenshot is very helpful!" The maintainer then re-asks in about 30 threads, in a friendlier way ("could you let us know what issue you're having? a screenshot would be very helpful").

But the report body already has the Dyad version, OS, model, chat mode, Node path, the last 3.5 KB of logs, and a `Screenshot status:` line whose text literally says "if no image is attached, ask them to paste it". Sometimes the logs alone tell the story: #4456 (Node.js not found), #4432 (no space left on disk), #3848 (the maintainer read the log, found the decrypt error, and shipped 1.6.2 the next day). The bot should do the reading and say what it found.

### 3. The bot never says what it thinks is going on; the maintainer always does

Rough sort of the 205 maintainer replies:

| First-reply pattern                                                | Approx. | Example                           | Bot can do it?                                        |
| ------------------------------------------------------------------ | ------: | --------------------------------- | ----------------------------------------------------- |
| Ask for Help > Upload Chat Session, a screenshot, or "what issue?" |      40 | #4391, #4385, #4125               | Yes                                                   |
| "Fixed in release X" or "please update"                            |      25 | #4295, #4355, #3837, #4267        | Yes, with release notes and a version check           |
| Concrete workaround in product terms                               |      25 | #4316, #4392, #4241, #4172        | Yes, from a playbook                                  |
| Confirm the bug, say a fix is coming                               |      20 | #4396, #4264, #3714               | Confirm yes; never promise a date                     |
| Not a Dyad problem (outage, provider, OS, the user's own app)      |      10 | #3959, #4172, #4250, #4359, #3974 | Partly (status feeds and playbook)                    |
| Clarifying question                                                |      15 | #4455, #4418, #3391               | Yes                                                   |
| Credits, billing, refunds                                          |      10 | #3394, #3658, #4140, #4354        | No. Hand to a person, explicitly                      |
| Feature request response                                           |      20 | #4322, #4425, #4178               | Partly (offer the existing route, e.g. custom models) |

### 4. Version drift is a large, cheap win

Reports arrive from 1.4 through 1.12 while 1.13 is current. Whole classes of reports were fixed in specific releases: credentials dropped on restart in 1.6.2 (#3848, #3859), force close in 1.7.0 (#3490, #3863), the stop button and web-crawl hang in 1.11.1 (#4289), the context-limit error and the "trim is not a function" crash in 1.13.0-beta.1 (#4355, #4295). The bot has the reporter's version in the body and the current version in the checked-out `package.json`, and can read the release notes.

### 5. The duplicate list is written for developers

"(confidence: high)" is jargon. "You might want to try Try downloading and installing Node.js" is a template bug (double "try") that appears in every workaround we post. Medium and low matches draw pushback: #3505 "They are not the same", #3782 "The existing issue is after a rename. This is with a completely new app." What a reporter wants to hear is "someone else hit this in #3665 and these steps fixed it" or "it's still open, you can follow it there".

### 6. Three comments where one would do

Language, incomplete, and duplicates post as separate comments (#3979 and #4182 got all three). The reporter sees a wall of bot text before any person shows up.

### 7. When the bot fails, nothing happens

41 issues have no labels, which means the triage job never finished (permission denials, per #4427). Nobody is told except the daily health check, and the reporter gets silence.

## The proposed reply

One comment. Sections are omitted when empty; a reply never has all five. Above the `<details>` fold, aim for under 120 words.

```
Hi @reporter, thanks for the report.

**What's going on:** {one or two plain sentences}

**What you can do now:**
1. {step in product words, e.g. Click **Manage app**, then **Copy app**}
2. {step}

**Others with the same problem:** #123 (fixed in 1.10.0) · #456 (still open, follow it for updates)

**To help us fix it:** {only what's missing: a screenshot, what you were doing, or Help > Upload Chat Session and paste the session id}

Someone from the Dyad team will follow up here.

<details>
<summary>Notes for the Dyad team</summary>

- Dyad 1.9.0 (current 1.13.0), Windows, model auto:auto, Build mode
- Log signature: ...
- Likely area: ...; related: #..., PR #...
- Playbook: matched "..." / no match
- Confidence: medium
</details>
```

Writing rules the prompt will carry:

- Talk to a person, not a developer. Use the words on the screen (**Pro** button, **Manage app**, **Versions**, **Help > Upload Chat Session**). No stack traces, file paths, or "confidence: high" above the fold.
- Say what we think is going on and how sure we are. If there is no evidence, say "we can't tell yet" and ask for one thing.
- Only give steps that come from the playbook, the release notes, or a maintainer comment on a linked issue. Never invent a workaround.
- Never promise a fix date, a refund, or credits. Never close or say "duplicate". Never @-mention anyone but the reporter.
- Show at most two related reports, and only ones we are sure about, each with its outcome. Weaker matches go in the team notes.
- When the reporter's version is behind, say so and link the download page. When release notes mention the fix, say which version.
- End with the sign-off so it's clear a person is coming.

### Before and after on real issues

**#4174, an empty Windows report on 1.9.0**

Today: title rewritten to "Squirrel auto-update 404 error on Windows"; comment lists #4181 and #4185 as high-confidence duplicates (both also empty). Maintainer later asks what the issue is. No reply.

Proposed title: `[session report] No description (Dyad 1.9.0, Windows)`

> Hi @reporter, thanks for sending this from Dyad.
>
> **What's going on:** Your report came through without a description, so we can't tell yet what went wrong. The logs show that Dyad's automatic update check failed, which is probably not what you noticed, but it does mean you're on an older version.
>
> **What you can do now:** Download the latest version from https://www.dyad.sh/download and try again. A lot has been fixed since 1.9.0.
>
> **To help us fix it:** Reply with what you were doing and what you saw instead. A screenshot of the error is the fastest way for us to help.
>
> Someone from the Dyad team will follow up here.
>
> <details><summary>Notes for the Dyad team</summary>
>
> - Empty session report. 1.9.0 (current 1.13.0), win32, auto:auto, Build mode. Screenshot status: none.
> - Only error in logs: Squirrel Update.exe CheckForUpdate returned HTTP 404. Same signature in #4181, #4185, #4174 and 20 others, all empty reports on old versions. Treated as background noise for the reporter; tracked for the team in the Windows updater issue.
> - No defect identified from this report. Playbook: "background updater error".
> </details>

**#4456, an empty 1.13.0 report whose logs show Node.js missing**

Today: title rewritten well ("Node.js/pnpm not recognized on Windows"), but the comment is a three-item duplicate list with the double-"try" workaround.

> Hi @reporter, thanks for sending this from Dyad.
>
> **What's going on:** Dyad can't find Node.js on your computer, which it needs to run your app. This is a setup problem rather than something wrong with your app, and it has a known fix.
>
> **What you can do now:**
>
> 1. Install Node.js from https://nodejs.org (pick the LTS version).
> 2. Quit Dyad completely and open it again.
> 3. If it still doesn't work, open **Settings**, find **Node.js Path Configuration**, and click **Browse for Node.js** to point Dyad at the folder where you installed it.
>
> **Others with the same problem:** #3665 and #3348. The steps above resolved it there.
>
> Someone from the Dyad team will follow up here.
>
> <details><summary>Notes for the Dyad team</summary>
>
> - 1.13.0 (current), win32, auto:free, Ask mode. Screenshot status: captured, no image attached.
> - Log: `'node' is not recognized as an internal or external command` from runShellCommand; managed pnpm install exited 1. Node Path reports `C:\Program Files\nodejs\node.exe`, so Node is installed but not on PATH (compare #3612, corrupted PATH entry).
> - Playbook: "Node.js not found on Windows". Confidence: high.
> </details>

**#4392, a Pro user whose own Anthropic key isn't used once credits run out**

Today: comment links #4388 as a low-confidence duplicate. Maintainer answers by email and then here.

> Hi @reporter, thanks for the report.
>
> **What's going on:** When your Dyad Pro credits run out, Dyad keeps trying to use Pro rather than switching to your own Anthropic key. That's how it works today, so nothing is wrong with your setup, and you can switch it yourself.
>
> **What you can do now:** Click the **Pro** button next to the model picker and turn off **Enable Dyad Pro**. Dyad will use your own API key until you turn it back on.
>
> Someone from the Dyad team will follow up here.
>
> <details><summary>Notes for the Dyad team</summary>
>
> - Pro user, 1.12.0. "Failed to verify" on Anthropic BYOK after credits hit 0.
> - Same answer given by hand in #4388 (daily chat limit). Two reports in one week; consider falling back to the user's own key automatically when credits are 0, or a clearer message.
> - Playbook: "Pro credits ran out, wants own key". Confidence: high.
> </details>

## The playbook

A new file, `.github/prompts/triage-playbook.md`, injected into the prompt. Each entry names the situation, what to tell the reporter (in product words), and the issues it came from. Seed entries, all taken from replies the maintainer has already written:

| Situation (what the bot sees)                                                    | What to tell the reporter                                                                                                                                                                                                                       | Source                                   |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Report has no description                                                        | Ask what they were doing and what they saw, plus a screenshot. Title it `[session report] No description (Dyad X, OS)`. Ignore the Auto-Updater Logs section unless the reporter mentions updating. If the version is behind, suggest updating. | 73 issues; #4408, #4393, #4263           |
| "node is not recognized" or pnpm not found (Windows)                             | Install Node.js from nodejs.org (LTS), quit and reopen Dyad; else **Settings** > **Node.js Path Configuration** > **Browse for Node.js**.                                                                                                       | #3665, #3348, #4188, #4189, #3612, #4456 |
| `ERR_PNPM_UNSUPPORTED_ENGINE` or dependency install fails on an imported project | Paste the maintainer's fix-it prompt into the chat (see #4455). Ask whether the project was imported from another tool.                                                                                                                         | #4455, #3497                             |
| "maximum context length" or "too many tokens"                                    | Start a new chat; check the model's max output tokens setting isn't set very high; update to 1.13.0 or newer.                                                                                                                                   | #4421, #4355, #1558, #1827               |
| Pro credits ran out, daily chat limit, or wants to use own key                   | **Pro** button > turn off **Enable Dyad Pro**.                                                                                                                                                                                                  | #4392, #4388                             |
| Credits consumed by errors, not refreshed, or charged more than expected         | Say a person will check the account. Ask for the session id (**Help** > **Upload Chat Session**) and roughly how many credits. Never promise a refund.                                                                                          | #3394, #3611, #3658, #4140, #4354, #3610 |
| Neon "Token refresh failed"                                                      | **Settings** > Integrations > **Disconnect from Neon**, then **Manage app** and reconnect.                                                                                                                                                      | #4316                                    |
| GitHub push or connect fails, "invalid JSON (HTML)"                              | Check githubstatus.com. If there are uncommitted changes, click **Review & commit** first. Link the GitHub troubleshooting docs.                                                                                                                | #3959, #4318, #3406, #3398               |
| Supabase deploy stuck, or every edge function redeploys                          | Check status.supabase.com. Restoring an earlier version from **Versions** redeploys functions. 1.11.0 added a manual push button.                                                                                                               | #4172, #3635                             |
| "Not a git repository", "Failed to resolve ref HEAD", git corrupted              | **Manage app** > overflow menu > **Copy app** (without history), or re-import with **Import App**.                                                                                                                                              | #4241, #3657, #3552                      |
| Import fails after a crash, folder already exists                                | Delete or rename the folder in `dyad-apps`, then import again. Fixed in 1.10.0-beta.3.                                                                                                                                                          | #4217                                    |
| App name with a trailing dot, or spaces, breaks paths or @-mentions              | Rename the app to letters, numbers, and dashes.                                                                                                                                                                                                 | #3782, #4168                             |
| "TypeError: terminated", AI request fails, DNS errors                            | Try another network or turn off VPN.                                                                                                                                                                                                            | #4167, #4165, #3653, #4107               |
| Claude Fable refuses, or `tool_use` block error on security tasks                | Use Opus or GPT for security reviews. A warning shows in the UI since 1.8.0-beta.1.                                                                                                                                                             | #3747, #3922                             |
| Dyad crashes or force closes                                                     | Update (stability work landed in 1.7.0). **Help** > **Upload Chat Session**. If logs are trimmed, email the `main` log from `%APPDATA%\dyad\logs`.                                                                                              | #3490, #4294, #3863, #3980               |
| macOS older than supported                                                       | Upgrade macOS.                                                                                                                                                                                                                                  | #4250                                    |
| A model disappeared from the list, or add provider X                             | Add it as a custom model (docs link). Providers are only added with clear demand.                                                                                                                                                               | #4425, #4322, #4293                      |
| Network loop or error inside the app the user built                              | That's the app, not Dyad. Switch to Agent mode and ask Dyad to find the cause.                                                                                                                                                                  | #4359                                    |
| Reporter is on an old version                                                    | Link the download page. Check release notes for a fix mention and name the version.                                                                                                                                                             | #3837, #3859, #3513, #4287, #4295        |
| Build mode struggling on a large app, or a weak model                            | Use Agent mode; suggest a stronger model.                                                                                                                                                                                                       | #3815, #3773                             |
| Windows CRLF warnings block git staging                                          | Fixed by PR #3683; terminal commands as fallback.                                                                                                                                                                                               | #3682                                    |
| Balance shown by a third-party router                                            | Contact that provider.                                                                                                                                                                                                                          | #3974                                    |

Each entry gets a "verified on version" field. When the bot can't match an entry it writes "Playbook: no match" in the team notes, which is the signal to add one. Keep it around 20 to 30 entries; if it grows past that, move the long tail to docs.

## Implementation

### Prompt (`.github/prompts/claude-triage.txt`)

- **Labels**: unchanged.
- **Related reports** (was "duplicates"): require an outcome per match (fixed in X, open, closed without fix). Only high-confidence matches reach the reporter, at most two. Medium go in the team notes. Drop low entirely.
- **Title**: when the description is empty, never derive a title from the Auto-Updater Logs section. Default to `[session report] No description (Dyad X, OS)` unless the main Logs show one clear user-facing failure (like Node.js missing), in which case name that.
- **Assessment** (new): one of `likely_dyad_bug`, `fixed_in_release`, `external_service`, `user_app_issue`, `environment_setup`, `needs_info`, `feature_request`, `question`, `needs_human`. Must cite evidence: a log line, a playbook entry, a release note, or a maintainer comment. No evidence means `needs_info`.
- **Steps** (new): product words only, bold UI labels, at most four. Only from the playbook, release notes, or a maintainer comment on a linked issue.
- **Info needed** (new): from a fixed list: description, screenshot (when `Screenshot status: captured` but no image is attached, ask them to paste it), session id via **Help** > **Upload Chat Session**, version.
- **Team notes** (new): markdown, about 120 words: environment line, log signature, likely area or file, related issues and PRs, playbook match or miss, confidence.
- **Tone rules**: the writing rules above, verbatim.

### Trusted context injected by the workflow, not fetched by the agent

The render step already substitutes template variables. Add:

- `CURRENT_VERSION` from `package.json`.
- `RELEASE_INDEX` from `gh release list --limit 40` (version, date, name) so "fixed in X" claims can be checked against real releases.
- `PLAYBOOK` from the new file.
- `SERVICE_STATUS` from the GitHub and Supabase status APIs (one `curl` each in the trusted step), so the bot can say "GitHub is having an outage right now" the way the maintainer did in #3959 and #4318.

The agent keeps no network access. Give it read-only `Read`, `Grep`, and `Glob` on the checkout so the team notes can point at the code that logged the error, plus `Bash(gh release view:*)`.

### Output (`triage.json`)

```json
{
  "labels": ["bug"],
  "nonEnglish": false,
  "incomplete": false,
  "title": null,
  "assessment": "environment_setup",
  "summary": "Dyad can't find Node.js on your computer, which it needs to run your app.",
  "steps": [
    "Install Node.js from https://nodejs.org (pick the LTS version).",
    "Quit Dyad completely and open it again."
  ],
  "fixedIn": null,
  "related": [
    {
      "number": 3665,
      "outcome": "resolved_with_workaround",
      "note": "The steps above resolved it there."
    }
  ],
  "infoNeeded": [],
  "developerNotes": "- 1.13.0, win32 ...",
  "playbookMatch": "node-not-found-windows"
}
```

### Apply script (`scripts/issue-triage/apply-triage.mjs`)

- Compose the single comment from the fields, omitting empty sections, always appending the sign-off.
- Sanitize all free text: strip HTML, strip @-mentions other than the reporter, allow links only to `github.com/dyad-sh/dyad`, `www.dyad.sh`, `nodejs.org`, `githubstatus.com`, `status.supabase.com`; cap lengths (summary 400 chars, each step 200, notes 1200).
- Validate `fixedIn.version` against `RELEASE_INDEX` and `related[].number` against the repo.
- On `needs_human` (credits, crashes we can't read, anything the bot can't answer), add a `triage/needs-human` label so the team can filter to the issues where the bot had nothing to offer.

### Workflow (`.github/workflows/claude-triage.yml`)

- If `triage.json` is missing, post a minimal safe comment ("Thanks for the report, someone from the Dyad team will take a look") and add a `triage/failed` label, so failures are visible on the issue instead of only in the daily health check.

### Rollout

1. Add `scripts/issue-triage/preview.mjs`: given a `triage.json`, print the composed comment without posting. Two example decisions live in `scripts/issue-triage/examples/`. To replay a real issue, render the prompt with `scripts/issue-agent/render-template.mjs` and run it through the `claude` CLI with the same environment variables the workflow sets, then preview the result. This also gives us the model-bump diff that #4069 asked for.
2. Ship with the playbook seeded from the table above.
3. After two weeks, look at: reporter reply rate after the bot comment (today 24%), how many issues still need a maintainer first reply, and the "playbook: no match" rate. Add entries from the misses.

## Risks and how we handle them

- **Confident wrong answers.** Assessment requires cited evidence, defaults to "we can't tell yet", and every reply says a person will follow up.
- **Prompt injection into posted text.** Free-text fields are new surface. The agent still cannot post; the apply script strips HTML and mentions, allowlists link hosts, and caps lengths. Status and release data come from the trusted step, not from the agent.
- **Playbook rot.** Entries carry a verified version; keep the file small; the "no match" signal keeps it honest.
- **Over-replying on feature requests.** Feature requests get labels only, plus a short note when an existing route already exists (see Decisions).

## Decisions

Settled on 2026-09-03:

1. **Feature requests get labels only.** The bot posts a comment on a feature request only when an existing route already covers it (custom models, a setting, a documented flow), and that comment is just the route plus a one-line thanks. No related-report list, no sign-off.
2. **Titles may still come from logs, but never from the updater section.** The Node.js case (#4456) shows a log-derived title can be good. The prompt ignores the Auto-Updater Logs section and any Squirrel, Update.exe, or CheckForUpdate lines when titling or assessing an empty report.
3. **The Windows updater 404 is tracked on its own.** Filed as #4466 with the 23 affected reports, the update host in use, and hypotheses. The playbook's empty-report entry points there so the bot mentions the failed update check only as a reason to update by hand.

## Also fixed along the way

The silent triage failures (41 unlabeled issues, #4427) had a concrete cause: the agent's allowlist granted `Edit(/tmp/issue-triage/**)`, an absolute path, while the decision file lives at `tmp/issue-triage/triage.json` inside the workspace. Writes were denied unless the model happened to use `echo` redirection. The workflow now grants `Write` and `Edit` on that one workspace-relative file, and the apply job posts the fallback comment when the file is still missing.

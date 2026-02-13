# Claude Code Configuration

This directory contains Claude Code configuration for the Dyad project.

## Skills

Skills are invoked with `/dyad:<skill>`. Available skills:

| Skill                              | Description                                                    | Uses                                |
| ---------------------------------- | -------------------------------------------------------------- | ----------------------------------- |
| `/dyad:plan-to-issue`              | Convert a plan to a GitHub issue                               | -                                   |
| `/dyad:fix-issue`                  | Fix a GitHub issue                                             | `pr-push`                           |
| `/dyad:pr-fix`                     | Fix PR issues from CI failures or review comments              | `pr-fix:comments`, `pr-fix:actions` |
| `/dyad:pr-fix:comments`            | Address unresolved PR review comments                          | `lint`, `pr-push`                   |
| `/dyad:pr-fix:actions`             | Fix failing CI checks and GitHub Actions                       | `e2e-rebase`, `pr-push`             |
| `/dyad:pr-rebase`                  | Rebase the current branch                                      | `pr-push`                           |
| `/dyad:pr-push`                    | Push changes and create/update a PR                            | `remember-learnings`                |
| `/dyad:fast-push`                  | Fast push via haiku sub-agent                                  | -                                   |
| `/dyad:lint`                       | Run all pre-commit checks (formatting, linting, type-checking) | -                                   |
| `/dyad:e2e-rebase`                 | Rebase E2E test snapshots                                      | -                                   |
| `/dyad:deflake-e2e`                | Deflake flaky E2E tests                                        | -                                   |
| `/dyad:deflake-e2e-recent-commits` | Gather flaky tests from recent CI runs and deflake them        | `deflake-e2e`, `pr-push`            |
| `/dyad:session-debug`              | Debug session issues                                           | -                                   |
| `/dyad:pr-screencast`              | Record visual demo of PR feature                               | -                                   |
| `/dyad:feedback-to-issues`         | Turn customer feedback into GitHub issues                      | -                                   |
| `/remember-learnings`              | Capture session learnings into AGENTS.md/rules                 | -                                   |

# Claude Code Configuration

This directory contains Claude Code configuration for the Coney project.

## Skills

Skills are invoked with `/coney:<skill>`. Available skills:

| Skill                              | Description                                                    | Uses                                |
| ---------------------------------- | -------------------------------------------------------------- | ----------------------------------- |
| `/coney:plan-to-issue`              | Convert a plan to a GitHub issue                               | -                                   |
| `/coney:fix-issue`                  | Fix a GitHub issue                                             | `pr-push`                           |
| `/coney:pr-fix`                     | Fix PR issues from CI failures or review comments              | `pr-fix:comments`, `pr-fix:actions` |
| `/coney:pr-fix:comments`            | Address unresolved PR review comments                          | `lint`, `pr-push`                   |
| `/coney:pr-fix:actions`             | Fix failing CI checks and GitHub Actions                       | `e2e-rebase`, `pr-push`             |
| `/coney:pr-rebase`                  | Rebase the current branch                                      | `pr-push`                           |
| `/coney:pr-push`                    | Push changes and create/update a PR                            | `remember-learnings`                |
| `/coney:fast-push`                  | Fast push via haiku sub-agent                                  | -                                   |
| `/coney:lint`                       | Run all pre-commit checks (formatting, linting, type-checking) | -                                   |
| `/coney:e2e-rebase`                 | Rebase E2E test snapshots                                      | -                                   |
| `/coney:deflake-e2e`                | Deflake flaky E2E tests                                        | -                                   |
| `/coney:deflake-e2e-recent-commits` | Gather flaky tests from recent CI runs and deflake them        | `deflake-e2e`, `pr-push`            |
| `/coney:session-debug`              | Debug session issues                                           | -                                   |
| `/coney:pr-screencast`              | Record visual demo of PR feature                               | -                                   |
| `/coney:feedback-to-issues`         | Turn customer feedback into GitHub issues                      | -                                   |
| `/remember-learnings`              | Capture session learnings into AGENTS.md/rules                 | -                                   |

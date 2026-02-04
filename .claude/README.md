# Claude Code Configuration

This directory contains Claude Code configuration for the Dyad project.

## Commands

Slash commands are invoked with `/dyad:<command>`. Available commands:

| Command                 | Description                                                    | Uses                                |
| ----------------------- | -------------------------------------------------------------- | ----------------------------------- |
| `/dyad:plan-to-issue`   | Convert a plan to a GitHub issue                               | -                                   |
| `/dyad:fix-issue`       | Fix a GitHub issue                                             | `pr-push`                           |
| `/dyad:pr-fix`          | Fix PR issues from CI failures or review comments              | `pr-fix:comments`, `pr-fix:actions` |
| `/dyad:pr-fix:comments` | Address unresolved PR review comments                          | `lint`, `pr-push`                   |
| `/dyad:pr-fix:actions`  | Fix failing CI checks and GitHub Actions                       | `e2e-rebase`, `pr-push`             |
| `/dyad:pr-rebase`       | Rebase the current branch                                      | `pr-push`                           |
| `/dyad:pr-push`         | Push changes and create/update a PR                            | `remember-learnings`                |
| `/dyad:lint`            | Run all pre-commit checks (formatting, linting, type-checking) | -                                   |
| `/dyad:e2e-rebase`      | Rebase E2E test snapshots                                      | -                                   |
| `/dyad:deflake-e2e`     | Deflake flaky E2E tests                                        | -                                   |
| `/dyad:session-debug`   | Debug session issues                                           | -                                   |

# Cross-Platform Test Determinism

Unit tests run on macOS and Windows in CI but are usually written on Linux,
where `/tmp` is a real directory and Git does no line-ending conversion. Both
assumptions are false on the CI runners, and the resulting failures reproduce
only there unless you deliberately recreate the condition.

## Reproduce the CI-only condition locally

Both classes are reproducible on Linux, so there is no need to guess from a job
log or to "fix and hope":

- **macOS `/var` → `/private/var`** (and any user-data dir behind a symlink):
  point `TMPDIR` at a symlink to a real directory, then run the target. Anything
  that compares an `os.tmpdir()`-derived path against `fs.realpath` output now
  fails the way it does on macOS.
- **Windows checkout conversion**: run with `GIT_CONFIG_GLOBAL` pointing at a
  file containing `[core]\n\tautocrlf = true`. `core.autocrlf` is honored on
  every platform; only the default differs, so this reproduces the CRLF class
  exactly.

## Never compare Git's stdout to an OS-shaped path

Git prints POSIX separators on every platform and resolves Windows 8.3 short
names to long ones, while `path.join` from `os.tmpdir()` yields backslashes and
the short name (`C:\Users\RUNNER~1\...`). The two spellings name the same
directory and share no common substring, so both `toBe` and `toContain` fail.

Put both sides through `path.resolve`, which normalizes separators, and compare
paths rather than searching for one inside a listing. For worktrees use
`git worktree list --porcelain` and read the `worktree ` lines: the plain form
puts the sha on the same line, and a path containing a space splits wrong.

## Pin conversion in fixture repositories

A test that writes files directly and then commits them has a working tree Git
itself would not produce: with `core.autocrlf=true` the checkout comes back
CRLF and byte-exact content assertions fail. Fixture helpers that run
`git init` should pin `git config core.autocrlf false` next to the
`user.email` / `user.name` they already set — the same hermeticity, so the
fixture does not inherit the machine's Git configuration.

This is a property of _fixtures_ only. A real app's conversion settings are its
own, and a sandbox or worktree overlay should keep inheriting them so its
checkout reproduces what the user actually has on disk.

## Dangling symlinks have no canonical form

`fs.realpath` cannot canonicalize a link whose target does not exist, so
containment for a dangling link is judged on the link _text_ — which carries
whatever spelling the caller used. When roots are compared only in their
resolved form, an absolute target naming the unresolved root (behind a macOS
symlink, or under a Windows short name) is judged outside and the link is
deleted. Accept both spellings of each root; see `relativeToEitherSpelling` in
`src/ipc/services/git_overlay_workspace.ts`.

# gh-permission-hook Tests

Unit tests for the GitHub CLI permission hook.

## Running Tests

```sh
python3 .claude/hooks/tests/test_gh_permission_hook.py
```

Or from the tests directory:

```sh
cd .claude/hooks/tests
python3 test_gh_permission_hook.py
```

## Test Files

- **good_commands.txt**: Commands that should be **allowed** by the hook (auto-approved or passed through for manual approval). These include read-only operations and explicitly allowed PR modification commands.

- **bad_commands.txt**: Commands that should be **blocked** by the hook. These include destructive operations, shell injection attempts, and operations that could modify issues, releases, repos, etc.

## Adding Test Cases

To add new test cases, simply add commands to the appropriate file:

- Add safe commands to `good_commands.txt`
- Add dangerous commands to `bad_commands.txt`

Lines starting with `#` are treated as comments and ignored.

#!/usr/bin/env python3
"""
GitHub CLI Permission Hook

This hook enforces a security policy for `gh` commands, auto-approving safe
operations and blocking dangerous ones.

ALLOWED (auto-approved):
------------------------
1. Read-only gh commands:
   - pr/issue/run/repo/release/workflow/gist: view, list, status, diff, checks, comments
   - search, browse, status, auth status
   - config get, config list
   - run watch, run download, release download

2. PR workflow commands:
   - pr create, edit, ready, review, close, merge

3. Issue workflow commands:
   - issue create, edit, close, reopen, comment

4. gh api - REST endpoints:
   - GET requests (explicit or implicit - gh api defaults to GET)
   - POST to /pulls/{id}/comments/{id}/replies (PR comment replies)
   - POST to /issues/{id}/comments (issue comments)

5. gh api graphql - queries and specific mutations:
   - All GraphQL queries (read-only)
   - Mutations: resolveReviewThread, unresolveReviewThread
   - Mutations: addPullRequestReview, addPullRequestReviewComment

6. Piping to safe text-processing commands:
   - jq, head, tail, grep, wc, sort, uniq, cut, tr, less, more

BLOCKED (denied):
-----------------
1. Destructive gh commands:
   - repo delete, create, edit, rename, archive
   - issue delete, transfer, pin, unpin
   - release delete, create, edit
   - gist delete, create, edit
   - run cancel, rerun
   - workflow disable, enable
   - auth logout
   - config set
   - label create, edit, delete
   - secret/variable management

2. gh api - destructive HTTP methods:
   - POST, PUT, PATCH, DELETE (except allowed endpoints above)

3. gh api graphql - mutations:
   - All mutations except the PR review ones listed above

4. Shell injection attempts:
   - Command chaining: ; && || &
   - Command substitution: $() ``
   - Process substitution: <() >()
   - Piping to non-safe commands
"""
import json
import sys
import re
from typing import Optional


# Shell metacharacters that could allow command chaining/injection
# Note: We check for specific dangerous patterns, not all shell metacharacters
# - ; separates commands
# - | pipes output (but || is logical OR)
# - && is logical AND
# - || is logical OR
# - & can run background + chain another command
# - ` and $( are command substitution
# - $'...' is ANSI-C quoting which can embed escape sequences
# - <(...) and >(...) are process substitution (execute commands)
# - \n and \r can separate commands in bash
# - We don't block () alone as they're used in GraphQL queries
SHELL_INJECTION_PATTERNS = re.compile(
    r'('           # Start alternation group
    r';'           # Command separator
    r'|(?<!\|)\|(?!\|)'  # Single pipe (not ||)
    r'|\|\|'       # Logical OR (could chain commands)
    r'|&&'         # Logical AND
    r'|&\s+\S'     # Background + another command (& followed by space and non-space)
    r'|&\S'        # Background + another command (& followed directly by non-space)
    r'|&\s*$'      # Trailing background operator (& at end of command)
    r'|`'          # Backtick command substitution
    r'|\$\('       # $( command substitution
    r"|\$'"        # ANSI-C quoting $'...' (can embed escape sequences like \n)
    r'|<\('        # Process substitution <(...)
    r'|>\('        # Process substitution >(...)
    r'|\n'         # Newline (command separator in bash)
    r'|\r'         # Carriage return (can also separate commands)
    r')'           # End alternation group
)

# Pattern to match single-quoted strings only
# Single quotes in bash are truly literal - no expansion occurs inside them
# Double quotes still allow command substitution: "$(cmd)" executes cmd
# So we only strip single-quoted content before checking for shell injection
SINGLE_QUOTED_PATTERN = re.compile(r"'[^']*'")

# Pattern to match double-quoted strings that are safe for pipe detection
# A double-quoted string without $( or backticks cannot execute commands,
# so any | inside is a literal character, not a shell pipe
# We use this to allow patterns like: grep -E "bug|error"
SAFE_DOUBLE_QUOTED_PATTERN = re.compile(r'"[^"$`]*"')

# Safe pipe destinations - commands that only process text output
# These are safe because they can't execute arbitrary code from piped input
# jq: JSON processor, commonly used with gh api output
# head/tail: display first/last N lines
# grep: pattern search (cannot execute code from input)
# wc: word/line/character count
# sort/uniq: sort and deduplicate lines
# cut: extract fields from lines
# tr: character translation
# less/more: pagers
SAFE_PIPE_PATTERN = re.compile(r'\|\s*(jq|head|tail|grep|wc|sort|uniq|cut|tr|less|more)\b')

# Safe redirect patterns - common shell redirects that don't execute commands
# 2>&1: redirect stderr to stdout (very common for capturing all output)
# >&2 or 1>&2: redirect stdout to stderr
# N>&M: redirect file descriptor N to M
SAFE_REDIRECT_PATTERN = re.compile(r'\d*>&\d+')


def extract_gh_command(command: str) -> Optional[str]:
    """
    Extract the gh command from a potentially prefixed command string.

    Handles cases like:
    - "gh pr view 123"
    - "GH_TOKEN=xxx gh pr view 123"
    - "env GH_TOKEN=xxx gh pr view 123"

    Returns None if no gh command is found.

    IMPORTANT: This function only matches `gh` when it's the actual command
    being executed (at the start, or after env var assignments / the env command).
    It will NOT match `gh` appearing as an argument to another command.
    """
    cmd = command.strip()

    # Direct gh command at the start
    if cmd.startswith("gh ") or cmd == "gh":
        return cmd

    # Pattern to match:
    # - Optional wrappers: sudo, command, env
    # - Zero or more VAR=value assignments (no spaces in value, or quoted)
    # - Then 'gh ' command
    #
    # Examples:
    # - "GH_TOKEN=xxx gh pr view"
    # - "env GH_TOKEN=xxx gh pr view"
    # - "sudo gh repo delete"
    # - "command gh pr view"
    # - "FOO=bar BAZ=qux gh pr view"
    # - "env gh pr view" (env with no vars)
    #
    # This pattern ensures 'gh' must come after valid wrapper/env var syntax,
    # not as an argument to another command like "rm -rf / gh pr view"

    # Match: optional wrappers (sudo/command), optional 'env', optional VAR=value pairs, then 'gh '
    # VAR=value allows: VAR=word, VAR="quoted", VAR='quoted'
    env_var_pattern = r'''
        ^                           # Start of string
        (?:sudo\s+)?                # Optional 'sudo ' command
        (?:command\s+)?             # Optional 'command ' builtin
        (?:env\s+)?                 # Optional 'env ' command
        (?:                         # Zero or more env var assignments
            [A-Za-z_][A-Za-z0-9_]*  # Variable name
            =                       # Equals sign
            (?:                     # Value (one of):
                "[^"]*"             # Double-quoted string
                |'[^']*'            # Single-quoted string
                |[^\s]+             # Unquoted word (no spaces)
            )
            \s+                     # Whitespace after assignment
        )*                          # Zero or more env var assignments (changed from + to *)
        (gh\s+.*)$                  # Capture the gh command
    '''

    match = re.match(env_var_pattern, cmd, re.VERBOSE)
    if match:
        return match.group(1)

    return None


def contains_shell_injection(cmd: str) -> bool:
    """
    Check if command contains shell metacharacters that could allow injection.

    This prevents bypasses like: "gh pr view 123; rm -rf /"

    Only single-quoted strings are safe to strip because bash treats their
    content literally. Double-quoted strings still allow command substitution
    (e.g., "$(rm -rf /)" would execute), so we must check inside them.

    Safe pipes to text-processing commands (like jq) are allowed since they
    only process the output and can't execute arbitrary code.
    """
    # Strip only single-quoted strings before checking
    # Single quotes are truly safe in bash: '$(cmd)' is literal, not executed
    # Double quotes are NOT safe: "$(cmd)" executes cmd
    # This handles cases like: gh api ... --jq '.[] | {field: .field}'
    cmd_without_single_quotes = SINGLE_QUOTED_PATTERN.sub("''", cmd)

    # Strip double-quoted strings that don't contain $( or backticks
    # These are safe for pipe/metachar detection since | inside is literal
    # This allows patterns like: grep -E "bug|error"
    cmd_without_safe_doubles = SAFE_DOUBLE_QUOTED_PATTERN.sub('""', cmd_without_single_quotes)

    # Replace safe pipe destinations with a placeholder before checking
    # This allows patterns like: gh api graphql ... | jq '...'
    cmd_to_check = SAFE_PIPE_PATTERN.sub(' SAFE_PIPE ', cmd_without_safe_doubles)

    # Replace safe redirect patterns (like 2>&1) before checking
    # These are standard shell redirects, not command execution
    cmd_to_check = SAFE_REDIRECT_PATTERN.sub(' ', cmd_to_check)

    return bool(SHELL_INJECTION_PATTERNS.search(cmd_to_check))


def main():
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        # Invalid input, allow normal permission flow
        sys.exit(0)

    tool_name = input_data.get("tool_name", "")
    tool_input = input_data.get("tool_input", {})
    command = tool_input.get("command", "")

    # Only process Bash commands
    if tool_name != "Bash":
        sys.exit(0)

    # Extract gh command (handles env var prefixes)
    gh_command = extract_gh_command(command)
    if not gh_command:
        sys.exit(0)

    # Reject commands with shell metacharacters to prevent injection
    if contains_shell_injection(command):
        decision = make_deny_decision(
            "Command contains shell metacharacters that could allow injection"
        )
        print(json.dumps(decision))
        sys.exit(0)

    # Normalize whitespace for matching
    normalized_cmd = " ".join(gh_command.split())

    # Check if this is a gh api command
    if normalized_cmd.startswith("gh api "):
        decision = check_gh_api_command(normalized_cmd)
        if decision:
            print(json.dumps(decision))
        sys.exit(0)

    # Check other gh commands
    decision = check_gh_command(normalized_cmd)
    if decision:
        print(json.dumps(decision))
    sys.exit(0)


def check_gh_api_command(cmd: str) -> Optional[dict]:
    """
    Check gh api commands for read-only vs destructive operations.

    gh api defaults to GET when no --method is specified.
    """
    # Check for GraphQL commands first
    if re.search(r"gh\s+api\s+graphql\b", cmd, re.IGNORECASE):
        return check_gh_graphql_command(cmd)

    # Destructive HTTP methods
    destructive_methods = ["POST", "PUT", "PATCH", "DELETE"]

    # Check for explicit method flag (handles --method VALUE, --method=VALUE, --method="VALUE", --method='VALUE')
    method_match = re.search(r'--method[=\s]+["\']?(\w+)["\']?', cmd, re.IGNORECASE)
    if method_match:
        method = method_match.group(1).upper()
        if method in destructive_methods:
            return make_deny_decision(
                f"Destructive gh api command blocked: --method {method}"
            )
        elif method == "GET":
            return make_allow_decision("Read-only gh api GET request auto-approved")

    # Check for -X shorthand method flag (handles -X VALUE, -X=VALUE, -X="VALUE", -X='VALUE')
    method_match = re.search(r'-X[=\s]+["\']?(\w+)["\']?', cmd)
    if method_match:
        method = method_match.group(1).upper()
        if method in destructive_methods:
            return make_deny_decision(
                f"Destructive gh api command blocked: -X {method}"
            )
        elif method == "GET":
            return make_allow_decision("Read-only gh api GET request auto-approved")

    # Check for --input or -f/--field flags (typically used with POST/PATCH)
    # Handles both space and equals syntax: --input data.json or --input=data.json
    if re.search(r"(--input[=\s]|--field[=\s]|-f[=\s]|-F[=\s])", cmd):
        # Allow PR comment replies (repos/.../pulls/.../comments/.../replies)
        if re.search(r'/pulls/\d+/comments/\d+/replies', cmd):
            return make_allow_decision("PR comment reply auto-approved")

        # Allow issue comment creation/replies
        if re.search(r'/issues/\d+/comments', cmd):
            return make_allow_decision("Issue comment auto-approved")

        return make_deny_decision(
            "gh api command with input data blocked (likely a write operation)"
        )

    # No method specified = defaults to GET, which is safe
    return make_allow_decision("Read-only gh api request auto-approved (defaults to GET)")


def check_gh_graphql_command(cmd: str) -> Optional[dict]:
    """
    Check gh api graphql commands for queries vs mutations.

    GraphQL queries are read-only, mutations are write operations.
    Some PR-related mutations are allowed for workflow automation.
    """
    # Check for mutation keyword FIRST to prevent bypass via "mutation ... query {" payload
    # Pattern matches: mutation{, mutation (, mutation Name{, mutation Name(
    has_mutation = re.search(r'\bmutation\s*(?:\w+\s*)?[\({]', cmd, re.IGNORECASE)
    if has_mutation:
        # Extract the actual mutation operation name - it must come immediately after
        # the mutation's opening brace, not nested in input arguments.
        # Pattern handles: mutation { name..., mutation Name { name..., mutation($var: Type!) { name...
        # The key is matching right after "mutation [Name] [(variables)] {"
        allowed_pr_mutations = (
            r'\bmutation\s*'           # mutation keyword
            r'(?:\w+\s*)?'             # optional mutation name
            r'(?:\([^)]*\)\s*)?'       # optional variables in parentheses
            r'\{\s*'                   # opening brace
            r'(resolveReviewThread|unresolveReviewThread|'
            r'addPullRequestReviewComment|addPullRequestReview)\b'
        )
        if re.search(allowed_pr_mutations, cmd, re.IGNORECASE):
            return make_allow_decision("PR review mutation auto-approved")

        # Block other mutations
        return make_deny_decision(
            "GraphQL mutation blocked (write operation)"
        )

    # Check for query operations (read-only) - only allowed if no mutation present
    # Pattern matches: query{, query (, query Name{, query Name(
    if re.search(r'\bquery\s*(?:\w+\s*)?[\({]', cmd, re.IGNORECASE):
        return make_allow_decision("GraphQL query auto-approved (read-only)")

    # If we can't determine the operation type, don't auto-approve
    # Let it go through normal permission flow
    return None


def check_gh_command(cmd: str) -> Optional[dict]:
    """
    Check other gh commands for read-only vs destructive operations.
    """
    # Read-only commands that should be auto-approved
    readonly_patterns = [
        r"^gh (pr|issue|run|repo|release|workflow|gist) (view|list|status|diff|checks|comments)",
        r"^gh search ",
        r"^gh browse ",
        r"^gh status\b",
        r"^gh auth status",
        r"^gh config (get|list)",
        r"^gh api .+",  # Already handled above, but fallback
        r"^gh pr checks\b",
        r"^gh pr diff\b",
        r"^gh run watch\b",
        r"^gh run download\b",
        r"^gh release download\b",
    ]

    for pattern in readonly_patterns:
        if re.match(pattern, cmd, re.IGNORECASE):
            return make_allow_decision(f"Read-only gh command auto-approved")

    # PR modification commands are explicitly allowed
    pr_allowed_patterns = [
        r"^gh pr (create|edit|ready|review|close|merge)\b",
    ]

    for pattern in pr_allowed_patterns:
        if re.match(pattern, cmd, re.IGNORECASE):
            return make_allow_decision("PR modification command auto-approved")

    # Issue modification commands are explicitly allowed
    issue_allowed_patterns = [
        r"^gh issue (create|edit|close|reopen|comment)\b",
    ]

    for pattern in issue_allowed_patterns:
        if re.match(pattern, cmd, re.IGNORECASE):
            return make_allow_decision("Issue modification command auto-approved")

    # Destructive commands that should be blocked
    destructive_patterns = [
        (r"^gh repo delete\b", "Repository deletion"),
        (r"^gh issue delete\b", "Issue deletion"),
        (r"^gh issue (transfer|pin|unpin)\b", "Issue transfer/pin operation"),
        (r"^gh release delete\b", "Release deletion"),
        (r"^gh gist delete\b", "Gist deletion"),
        (r"^gh run cancel\b", "Workflow run cancellation"),
        (r"^gh run rerun\b", "Workflow re-run"),
        (r"^gh workflow (disable|enable)\b", "Workflow enable/disable"),
        (r"^gh auth logout\b", "Auth logout"),
        (r"^gh config set\b", "Config modification"),
        (r"^gh repo (create|edit|rename|archive)\b", "Repository modification"),
        (r"^gh release (create|edit)\b", "Release modification"),
        (r"^gh gist (create|edit)\b", "Gist modification"),
        (r"^gh label (create|edit|delete)\b", "Label modification"),
        (r"^gh secret\b", "Secret management"),
        (r"^gh variable\b", "Variable management"),
    ]

    for pattern, description in destructive_patterns:
        if re.match(pattern, cmd, re.IGNORECASE):
            return make_deny_decision(f"Destructive gh command blocked: {description}")

    # For unrecognized gh commands, allow normal permission flow
    return None


def make_allow_decision(reason: str) -> dict:
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "permissionDecisionReason": reason
        }
    }


def make_deny_decision(reason: str) -> dict:
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason
        }
    }


if __name__ == "__main__":
    main()

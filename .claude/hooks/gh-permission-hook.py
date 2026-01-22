#!/usr/bin/env python3
"""
Permission hook to auto-approve read-only GitHub CLI commands
and reject destructive operations.
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
# - & followed by space can run background + another command
# - ` and $( are command substitution
# - We don't block () alone as they're used in GraphQL queries
SHELL_INJECTION_PATTERNS = re.compile(
    r';'           # Command separator
    r'|(?<!\|)\|(?!\|)'  # Single pipe (not ||)
    r'|\|\|'       # Logical OR (could chain commands)
    r'|&&'         # Logical AND
    r'|&\s+\S'     # Background + another command (& followed by space and non-space)
    r'|`'          # Backtick command substitution
    r'|\$\('       # $( command substitution
)


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
    # - Optional 'env' command at start
    # - Zero or more VAR=value assignments (no spaces in value, or quoted)
    # - Then 'gh ' command
    #
    # Examples:
    # - "GH_TOKEN=xxx gh pr view"
    # - "env GH_TOKEN=xxx gh pr view"
    # - "FOO=bar BAZ=qux gh pr view"
    #
    # This pattern ensures 'gh' must come after valid env var syntax,
    # not as an argument to another command like "rm -rf / gh pr view"

    # Match: optional 'env ' at start, then VAR=value pairs, then 'gh '
    # VAR=value allows: VAR=word, VAR="quoted", VAR='quoted'
    env_var_pattern = r'''
        ^                           # Start of string
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
        )+                          # One or more env var assignments
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
    """
    return bool(SHELL_INJECTION_PATTERNS.search(cmd))


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

    # Check for explicit method flag (handles both --method VALUE and --method=VALUE)
    method_match = re.search(r"--method[=\s]+(\w+)", cmd, re.IGNORECASE)
    if method_match:
        method = method_match.group(1).upper()
        if method in destructive_methods:
            return make_deny_decision(
                f"Destructive gh api command blocked: --method {method}"
            )
        elif method == "GET":
            return make_allow_decision("Read-only gh api GET request auto-approved")

    # Check for -X shorthand method flag (handles both -X VALUE and -X=VALUE)
    method_match = re.search(r"-X[=\s]+(\w+)", cmd)
    if method_match:
        method = method_match.group(1).upper()
        if method in destructive_methods:
            return make_deny_decision(
                f"Destructive gh api command blocked: -X {method}"
            )
        elif method == "GET":
            return make_allow_decision("Read-only gh api GET request auto-approved")

    # Check for --input or -f/--field flags (typically used with POST/PATCH)
    if re.search(r"(--input\s|--field\s|-f\s|-F\s)", cmd):
        return make_deny_decision(
            "gh api command with input data blocked (likely a write operation)"
        )

    # No method specified = defaults to GET, which is safe
    return make_allow_decision("Read-only gh api request auto-approved (defaults to GET)")


def check_gh_graphql_command(cmd: str) -> Optional[dict]:
    """
    Check gh api graphql commands for queries vs mutations.

    GraphQL queries are read-only, mutations are write operations.
    """
    # Look for mutation keyword in the query
    # Common patterns: -f query="mutation ...", -f query='mutation ...'
    # The mutation keyword appears at the start of the operation
    if re.search(r'mutation\s*[\s\({]', cmd, re.IGNORECASE):
        return make_deny_decision(
            "GraphQL mutation blocked (write operation)"
        )

    # Check for query operations (read-only)
    if re.search(r'query\s*[\s\({]', cmd, re.IGNORECASE):
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

    # Destructive commands that should be blocked
    destructive_patterns = [
        (r"^gh repo delete\b", "Repository deletion"),
        (r"^gh issue close\b", "Issue closing"),
        (r"^gh issue delete\b", "Issue deletion"),
        (r"^gh release delete\b", "Release deletion"),
        (r"^gh gist delete\b", "Gist deletion"),
        (r"^gh run cancel\b", "Workflow run cancellation"),
        (r"^gh run rerun\b", "Workflow re-run"),
        (r"^gh workflow disable\b", "Workflow disabling"),
        (r"^gh auth logout\b", "Auth logout"),
        (r"^gh config set\b", "Config modification"),
        (r"^gh repo (create|edit|rename|archive)\b", "Repository modification"),
        (r"^gh issue (create|edit|transfer|pin|unpin)\b", "Issue modification"),
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

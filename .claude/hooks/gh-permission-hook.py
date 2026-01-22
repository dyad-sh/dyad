#!/usr/bin/env python3
"""
Permission hook to auto-approve read-only GitHub CLI commands
and reject destructive operations.
"""
import json
import sys
import re

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

    # Only process gh commands
    if not command.strip().startswith("gh "):
        sys.exit(0)

    # Normalize whitespace for matching
    normalized_cmd = " ".join(command.split())

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


def check_gh_api_command(cmd: str) -> dict | None:
    """
    Check gh api commands for read-only vs destructive operations.

    gh api defaults to GET when no --method is specified.
    """
    # Destructive HTTP methods
    destructive_methods = ["POST", "PUT", "PATCH", "DELETE"]

    # Check for explicit method flag
    method_match = re.search(r"--method\s+(\w+)", cmd, re.IGNORECASE)
    if method_match:
        method = method_match.group(1).upper()
        if method in destructive_methods:
            return make_deny_decision(
                f"Destructive gh api command blocked: --method {method}"
            )
        elif method == "GET":
            return make_allow_decision("Read-only gh api GET request auto-approved")

    # Check for -X shorthand method flag
    method_match = re.search(r"-X\s+(\w+)", cmd)
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


def check_gh_command(cmd: str) -> dict | None:
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

    # Destructive commands that should be blocked
    destructive_patterns = [
        (r"^gh repo delete\b", "Repository deletion"),
        (r"^gh pr close\b", "PR closing"),
        (r"^gh pr merge\b", "PR merging"),
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
        (r"^gh pr (create|edit|ready|review)\b", "PR modification"),
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

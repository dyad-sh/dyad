#!/usr/bin/env python3
"""
Python Permission Hook

This hook enforces that python/python3 commands can only execute scripts
located inside the .claude directory.

ALLOWED:
- python .claude/script.py
- python3 .claude/hooks/test.py
- python "$CLAUDE_PROJECT_DIR/.claude/script.py"

BLOCKED:
- python script.py (outside .claude)
- python /usr/local/bin/script.py
- python ../malicious.py
- python -m <module> (module execution bypasses directory restriction)
- python -c "<code>" (inline code execution)
- python < /tmp/file.py (stdin redirection)
- python .claude/script.py; malicious_command (shell injection)

PASSTHROUGH (normal permission flow):
- Non-python commands (ls, cat, etc.)
- python --version (version check)
- python --help (help)
"""
import json
import os
import re
import shlex
import sys


# Shell metacharacters that could allow command chaining/injection
# Based on gh-permission-hook.py patterns
SHELL_INJECTION_PATTERNS = re.compile(
    r'('
    r';'                      # Command separator
    r'|(?<!\|)\|(?!\|)'       # Single pipe (not ||)
    r'|\|\|'                  # Logical OR
    r'|&&'                    # Logical AND
    r'|&\s+\S'                # Background + another command
    r'|&\S'                   # Background + another command
    r'|&\s*$'                 # Trailing background operator
    r'|`'                     # Backtick command substitution
    r'|\$\('                  # $( command substitution
    r"|\$'"                   # ANSI-C quoting
    r'|<\('                   # Process substitution <(...)
    r'|>\('                   # Process substitution >(...)
    r'|<<<'                   # Here-string
    r'|<<[^<]'                # Here-doc (<<EOF, <<'EOF', etc.)
    r'|<\s*[^<]'              # Input redirection (< file) - note: after heredoc checks
    r'|\n'                    # Newline
    r'|\r'                    # Carriage return
    r')'
)

# Pattern to match single-quoted strings (safe to strip for metachar check)
SINGLE_QUOTED_PATTERN = re.compile(r"'[^']*'")

# Pattern to match double-quoted strings without command substitution
SAFE_DOUBLE_QUOTED_PATTERN = re.compile(r'"[^"$`]*"')


def contains_shell_injection(cmd: str) -> bool:
    """
    Check if command contains shell metacharacters that could allow injection.
    Returns True if dangerous patterns are found.
    """
    # Strip single-quoted strings (truly safe in bash)
    cmd_without_single_quotes = SINGLE_QUOTED_PATTERN.sub("''", cmd)

    # Strip double-quoted strings that don't contain $( or backticks
    cmd_without_safe_doubles = SAFE_DOUBLE_QUOTED_PATTERN.sub('""', cmd_without_single_quotes)

    return bool(SHELL_INJECTION_PATTERNS.search(cmd_without_safe_doubles))


def is_python_command(cmd: str) -> bool:
    """
    Quick check if a command looks like a python command.
    Used to decide whether to apply python-specific security checks.
    """
    # Strip env var prefixes
    stripped = cmd.strip()
    while True:
        match = re.match(r'^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|\'[^\']*\'|[^\s]*)\s+', stripped)
        if match:
            stripped = stripped[match.end():]
        else:
            break

    # Check for python pattern (including env python, path/to/python, etc.)
    return bool(re.match(
        r'^(?:env\s+)?(?:/usr/bin/env\s+)?(?:[^\s]*/)?python3?\b',
        stripped
    ))


def main():
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        # Invalid input, allow normal permission flow
        sys.exit(0)

    tool_name = input_data.get("tool_name", "")
    tool_input = input_data.get("tool_input")

    # Validate types to prevent crashes on malformed input
    if not isinstance(tool_input, dict):
        sys.exit(0)

    command = tool_input.get("command")
    if not isinstance(command, str):
        sys.exit(0)

    # Only process Bash commands
    if tool_name != "Bash":
        sys.exit(0)

    # Check if this is a python/python3 command
    result = extract_python_script(command)

    if result is None:
        # Not a python command, let it through
        sys.exit(0)

    # Unpack result
    script_path, denial_reason = result

    # If there's a denial reason, deny the command
    if denial_reason:
        decision = make_deny_decision(denial_reason)
        print(json.dumps(decision))
        sys.exit(0)

    # If script_path is empty string, it's a passthrough case (e.g., --version)
    if script_path == "":
        sys.exit(0)

    # Check if the script is inside .claude directory
    if is_inside_claude_dir(script_path):
        decision = make_allow_decision(
            f"Python script is inside .claude directory: {script_path}"
        )
        print(json.dumps(decision))
        sys.exit(0)
    else:
        decision = make_deny_decision(
            f"Python scripts can only be run from inside the .claude directory. "
            f"Attempted to run: {script_path}"
        )
        print(json.dumps(decision))
        sys.exit(0)


def extract_python_script(command: str) -> tuple[str, str] | None:
    """
    Extract the Python script path from a command.

    Returns:
    - None if not a python command (passthrough to normal permission flow)
    - (script_path, "") if a script was found that should be validated
    - ("", "") if it's a passthrough case like --version or --help
    - ("", denial_reason) if the command should be denied immediately
    """
    cmd = command.strip()

    # Check for shell injection FIRST before any parsing
    if contains_shell_injection(command):
        # Check if this even looks like a python command before denying
        if is_python_command(cmd):
            return ("", "Python command contains shell metacharacters that could allow injection")
        # Not a python command, let normal flow handle it
        return None

    # Remove common environment variable prefixes
    # e.g., "FOO=bar python script.py" -> "python script.py"
    while True:
        # Handle both unquoted and quoted env var values
        match = re.match(r'^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|\'[^\']*\'|[^\s]*)\s+', cmd)
        if match:
            cmd = cmd[match.end():]
        else:
            break

    # Check if command starts with python or python3
    # Include: python, python3, /usr/bin/python, /usr/local/bin/python,
    # and handle 'env python' patterns
    python_match = re.match(
        r'^(?:env\s+)?'  # Optional 'env ' prefix
        r'(?:/usr/bin/env\s+)?'  # Optional '/usr/bin/env ' prefix
        r'((?:[^\s]*/)?python3?)'  # Python executable (with optional path)
        r'(?:\s+|$)',  # Followed by space or end of string
        cmd
    )
    if not python_match:
        return None

    # Get the rest after "python" or "python3"
    rest = cmd[python_match.end():].strip()

    # If no arguments, it's interactive mode - DENY (stdin redirection risk)
    if not rest:
        return ("", "Interactive Python mode is not allowed (stdin redirection risk)")

    # Use shlex for robust argument parsing
    try:
        args = shlex.split(rest)
    except ValueError:
        # Malformed quotes - deny for safety
        return ("", "Malformed command (unmatched quotes)")

    if not args:
        return ("", "Interactive Python mode is not allowed (stdin redirection risk)")

    i = 0
    while i < len(args):
        arg = args[i]

        # Handle end-of-options delimiter
        if arg == '--':
            # Next argument is the script
            if i + 1 < len(args):
                return (args[i + 1], "")
            return ("", "Interactive Python mode is not allowed (stdin redirection risk)")

        # DENY: -m module execution (bypasses directory restriction)
        # Check for both standalone -m and combined flags like -um, -Bm
        if arg == '-m' or (arg.startswith('-') and not arg.startswith('--') and 'm' in arg[1:]):
            return ("", "Python -m module execution is not allowed (bypasses directory restriction)")

        # DENY: -c inline code execution
        # Check for both standalone -c and combined flags like -Bc, -uc
        if arg == '-c' or (arg.startswith('-') and not arg.startswith('--') and 'c' in arg[1:]):
            return ("", "Python -c inline code execution is not allowed")

        # Passthrough: version/help flags (safe, no code execution)
        if arg in ('--version', '-V', '--help', '-h'):
            return ("", "")

        # Handle flags that take arguments
        # Python 3 flags with arguments: -W (warning control), -X (implementation-specific options)
        if arg in ('-W', '-X'):
            i += 2  # Skip flag and its argument
            continue

        # Handle combined flags like -Werror or -Xdev
        if arg.startswith('-W') or arg.startswith('-X'):
            i += 1
            continue

        # Skip other short flags (e.g., -u, -B, -O, -OO, -s, -S, -E, -I)
        if arg.startswith('-') and not arg.startswith('--'):
            i += 1
            continue

        # Skip long options we don't specifically handle
        if arg.startswith('--'):
            i += 1
            continue

        # First non-flag argument is the script path
        return (arg, "")

    # Only flags, no script - passthrough for things like 'python --version'
    return ("", "")


def is_inside_claude_dir(script_path: str) -> bool:
    """
    Check if the script path is inside the .claude directory.
    Handles both absolute and relative paths.

    Security note: We intentionally expand environment variables to support
    paths like $CLAUDE_PROJECT_DIR/.claude/script.py. The subsequent realpath()
    call resolves the final path, and we verify it's inside .claude after
    expansion. This prevents bypasses like $HOME/../../../tmp/malicious.py
    because realpath() resolves to the actual location which is then checked.
    """
    # Expand environment variables (see security note above)
    expanded_path = os.path.expandvars(script_path)

    # Get the project directory from environment or use current working directory
    project_dir = os.environ.get('CLAUDE_PROJECT_DIR', os.getcwd())
    claude_dir = os.path.join(project_dir, '.claude')

    # Normalize the script path
    if os.path.isabs(expanded_path):
        abs_script_path = os.path.normpath(expanded_path)
    else:
        abs_script_path = os.path.normpath(os.path.join(project_dir, expanded_path))

    # Resolve any symlinks to get the real path
    try:
        real_script_path = os.path.realpath(abs_script_path)
        real_claude_dir = os.path.realpath(claude_dir)
    except OSError:
        # If we can't resolve paths, be conservative and deny
        return False

    # Check if the script is inside the .claude directory
    # Use os.path.commonpath to handle edge cases
    try:
        common = os.path.commonpath([real_script_path, real_claude_dir])
        return common == real_claude_dir
    except ValueError:
        # Different drives on Windows, etc.
        return False


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

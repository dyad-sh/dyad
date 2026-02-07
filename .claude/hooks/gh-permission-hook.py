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
   - pr create, edit, ready, review, close, reopen, merge, comment

3. Issue workflow commands:
   - issue create, edit, close, reopen, comment

4. gh api - REST endpoints:
   - GET requests (explicit or implicit - gh api defaults to GET)
   - POST to /pulls/{id}/comments/{id}/replies (PR comment replies)
   - POST to /pulls/{id}/reviews (PR reviews with inline comments)
   - POST to /issues/{id}/comments (issue comments)
   - PATCH to /pulls/{id} (PR title/body updates)
   - PATCH to /issues/comments/{id} (issue comment updates)
   - PATCH to /pulls/comments/{id} (PR comment updates)
   - POST to /issues/{id}/labels (add labels to issues)

5. gh api graphql - queries and specific mutations:
   - All GraphQL queries (read-only)
   - Mutations: resolveReviewThread, unresolveReviewThread
   - Mutations: addPullRequestReview, addPullRequestReviewComment

6. Piping to safe text-processing commands:
   - jq, head, tail, grep, wc, sort, uniq, cut, tr

BLOCKED (denied):
-----------------
1. Destructive gh commands:
   - repo delete, create, edit, rename, archive
   - issue delete, transfer, pin, unpin
   - release delete, create, edit
   - gist delete, create, edit
   - run cancel, rerun
   - workflow disable, enable, run
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

Note: Markdown code spans with identifier-like content are allowed in double-quoted
strings (common in PR/issue descriptions). Code spans must contain at least one
dot, hyphen, or underscore to be recognized as identifiers (e.g., `config.json`,
`my-component`, `my_variable`). Plain words like `word` are NOT allowed as they
could be actual commands like `env` or `whoami`.
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

# Pattern to match markdown-style inline code spans that look like identifiers
# Must contain at least one of: dot, hyphen, or underscore to distinguish from commands
# Matches: `config.json`, `my-component`, `my_variable`, `package.json`
# Does NOT match: `whoami`, `env`, `id` (could be actual commands)
# SECURITY: Requires non-alpha chars to reduce risk of matching actual commands
MARKDOWN_CODE_SPAN_PATTERN = re.compile(r'`[\w.-]*[._-][\w.-]*`')

# Pattern to match double-quoted strings (for processing)
DOUBLE_QUOTED_STRING_PATTERN = re.compile(r'"[^"]*"')

# Safe pipe destinations - commands that only process text output
# These are safe because they can't execute arbitrary code from piped input
# jq: JSON processor, commonly used with gh api output
# head/tail: display first/last N lines
# grep: pattern search (cannot execute code from input)
# wc: word/line/character count
# sort/uniq: sort and deduplicate lines
# cut: extract fields from lines
# tr: character translation
# Note: less/more are NOT included because they support shell escapes (e.g., !cmd)
SAFE_PIPE_PATTERN = re.compile(r'\|\s*(jq|head|tail|grep|wc|sort|uniq|cut|tr)\b')

# Safe redirect patterns - common shell redirects that don't execute commands
# 2>&1: redirect stderr to stdout (very common for capturing all output)
# >&2 or 1>&2: redirect stdout to stderr
# N>&M: redirect file descriptor N to M
# N>/dev/null: redirect to /dev/null (suppress output)
SAFE_REDIRECT_PATTERN = re.compile(r'\d*>&\d+|\d*>/dev/null')

# Safe fallback pattern - || echo "..." is commonly used for error handling
# This pattern matches: || echo "string" or || echo 'string' or || echo WORD
# The echo command only outputs text, making this safe for fallback values
SAFE_FALLBACK_PATTERN = re.compile(r'\|\|\s*echo\s+(?:"[^"]*"|\'[^\']*\'|\S+)\s*$')


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


def neutralize_code_spans_in_double_quotes(match: re.Match) -> str:
    """
    Process a double-quoted string and neutralize markdown code spans inside it.

    This allows PR/issue bodies with markdown like `concurrency` to pass through,
    while still blocking backticks outside of quoted strings (real command substitution).
    """
    content = match.group(0)
    # Neutralize code spans (backtick pairs with simple identifier content)
    neutralized = MARKDOWN_CODE_SPAN_PATTERN.sub("MDCODE", content)
    return neutralized


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

    # Neutralize markdown code spans ONLY INSIDE double-quoted strings
    # This allows PR/issue bodies with markdown formatting like `concurrency`
    # to be stripped in the next step, while still catching backticks outside quotes
    # (which are real command substitution)
    cmd_with_neutralized_spans = DOUBLE_QUOTED_STRING_PATTERN.sub(
        neutralize_code_spans_in_double_quotes, cmd_without_single_quotes
    )

    # Strip double-quoted strings that don't contain $( or backticks
    # These are safe for pipe/metachar detection since | inside is literal
    # This allows patterns like: grep -E "bug|error"
    cmd_without_safe_doubles = SAFE_DOUBLE_QUOTED_PATTERN.sub('""', cmd_with_neutralized_spans)

    # Replace safe pipe destinations with a placeholder before checking
    # This allows patterns like: gh api graphql ... | jq '...'
    cmd_to_check = SAFE_PIPE_PATTERN.sub(' SAFE_PIPE ', cmd_without_safe_doubles)

    # Replace safe redirect patterns (like 2>&1, 2>/dev/null) before checking
    # These are standard shell redirects, not command execution
    cmd_to_check = SAFE_REDIRECT_PATTERN.sub(' ', cmd_to_check)

    # Replace safe fallback patterns (|| echo "...") before checking
    # This is a common idiom for providing default output on failure
    cmd_to_check = SAFE_FALLBACK_PATTERN.sub(' ', cmd_to_check)

    return bool(SHELL_INJECTION_PATTERNS.search(cmd_to_check))


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

    # Extract gh command (handles env var prefixes)
    gh_command = extract_gh_command(command)
    if not gh_command:
        sys.exit(0)

    # Normalize whitespace for matching
    normalized_cmd = " ".join(gh_command.split())

    # Allow gh pr commands without shell injection check (common workflow commands)
    # Other gh commands with shell metacharacters are blocked for safety
    if not normalized_cmd.startswith("gh pr "):
        if contains_shell_injection(command):
            decision = make_deny_decision(
                "Command contains shell metacharacters that could allow injection"
            )
            print(json.dumps(decision))
            sys.exit(0)

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


def extract_api_endpoint(cmd: str) -> Optional[str]:
    """
    Extract the API endpoint from a gh api command.

    The endpoint is the first positional argument after 'gh api' that doesn't
    start with a dash (flag). It may or may not have a leading slash.

    Examples:
    - "gh api /repos/owner/repo" -> "/repos/owner/repo"
    - "gh api repos/owner/repo" -> "repos/owner/repo"
    - "gh api --method GET /repos/owner/repo" -> "/repos/owner/repo"
    - "gh api /repos/owner/repo -f body='test'" -> "/repos/owner/repo"
    """
    # Remove "gh api " prefix and "graphql" if present
    api_part = re.sub(r'^gh\s+api\s+', '', cmd, flags=re.IGNORECASE)

    # Skip past graphql keyword if present
    if api_part.lower().startswith('graphql'):
        return None  # GraphQL commands are handled separately

    # Split by whitespace, but be careful about quoted strings
    # We'll use a simple approach: find the first token that looks like an endpoint
    # (starts with / or looks like a path) and isn't a flag

    # First, remove flag arguments to isolate the endpoint
    # Flags: --method, --method=X, -X, -X=X, --input, --input=X, -f, -f=X, -F, -F=X, --field, --field=X
    # --jq, --jq=X, --paginate, --template, etc.

    # Remove known flags with values
    cleaned = api_part
    # Remove flags that take values
    cleaned = re.sub(r'--method[=\s]+(?:"[^"]*"|\'[^\']*\'|\S+)', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'-X[=\s]+(?:"[^"]*"|\'[^\']*\'|\S+)', '', cleaned)
    cleaned = re.sub(r'--input[=\s]+(?:"[^"]*"|\'[^\']*\'|\S+)', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'--field[=\s]+(?:"[^"]*"|\'[^\']*\'|\S+)', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'-f[=\s]+(?:"[^"]*"|\'[^\']*\'|\S+)', '', cleaned)
    cleaned = re.sub(r'-F[=\s]+(?:"[^"]*"|\'[^\']*\'|\S+)', '', cleaned)
    cleaned = re.sub(r'--jq[=\s]+(?:"[^"]*"|\'[^\']*\'|\S+)', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'--template[=\s]+(?:"[^"]*"|\'[^\']*\'|\S+)', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'--header[=\s]+(?:"[^"]*"|\'[^\']*\'|\S+)', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'-H[=\s]+(?:"[^"]*"|\'[^\']*\'|\S+)', '', cleaned)
    # Remove standalone flags
    cleaned = re.sub(r'--paginate\b', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'--silent\b', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'--verbose\b', '', cleaned, flags=re.IGNORECASE)

    # Now find the endpoint - should be first remaining path-like token
    # Could start with / or be like repos/owner/repo
    endpoint_match = re.search(r'''
        (?:^|\s)                        # start or whitespace
        (['"]?)                         # optional opening quote
        (/?[a-zA-Z][a-zA-Z0-9_/{}.-]*)  # endpoint path
        \1                              # matching closing quote
    ''', cleaned.strip(), re.VERBOSE)

    if endpoint_match:
        return endpoint_match.group(2)
    return None


def check_gh_api_command(cmd: str) -> Optional[dict]:
    """
    Check gh api commands for read-only vs destructive operations.

    gh api defaults to GET when no --method is specified.
    """
    # Check for GraphQL commands first
    if re.search(r"gh\s+api\s+graphql\b", cmd, re.IGNORECASE):
        return check_gh_graphql_command(cmd)

    # Extract the actual endpoint from the command
    endpoint = extract_api_endpoint(cmd)

    # Destructive HTTP methods
    destructive_methods = ["POST", "PUT", "PATCH", "DELETE"]

    # Determine the HTTP method being used
    method = None

    # Check for explicit method flag (handles --method VALUE, --method=VALUE, --method="VALUE", --method='VALUE')
    method_match = re.search(r'--method[=\s]+["\']?(\w+)["\']?', cmd, re.IGNORECASE)
    if method_match:
        method = method_match.group(1).upper()

    # Check for -X shorthand method flag (handles -X VALUE, -X=VALUE, -X="VALUE", -X='VALUE')
    if not method:
        method_match = re.search(r'-X[=\s]+["\']?(\w+)["\']?', cmd)
        if method_match:
            method = method_match.group(1).upper()

    # Check if command has input data (implies write operation)
    has_input = bool(re.search(r"(--input[=\s]|--field[=\s]|-f[=\s]|-F[=\s])", cmd))

    # Check allowed endpoints FIRST before blocking based on method
    # This allows explicit POST to allowed endpoints like PR comment replies
    if endpoint:
        # Allow PR comment replies (repos/.../pulls/.../comments/.../replies)
        if re.search(r'/pulls/\d+/comments/\d+/replies$', endpoint):
            if method in [None, "POST"]:
                return make_allow_decision("PR comment reply auto-approved")

        # Allow PR review creation (repos/.../pulls/.../reviews)
        if re.search(r'/pulls/\d+/reviews$', endpoint):
            if method in [None, "POST"]:
                return make_allow_decision("PR review auto-approved")

        # Allow issue comment creation (repos/.../issues/.../comments)
        if re.search(r'/issues/\d+/comments$', endpoint):
            if method in [None, "POST"]:
                return make_allow_decision("Issue comment auto-approved")

        # Allow updating issue comments (repos/.../issues/comments/...)
        if re.search(r'/issues/comments/\d+$', endpoint):
            if method == "PATCH":
                return make_allow_decision("Issue comment update auto-approved")

        # Allow updating PR review comments (repos/.../pulls/comments/...)
        if re.search(r'/pulls/comments/\d+$', endpoint):
            if method == "PATCH":
                return make_allow_decision("PR comment update auto-approved")

        # Allow updating PRs (repos/.../pulls/...)
        if re.search(r'/pulls/\d+$', endpoint):
            if method == "PATCH":
                return make_allow_decision("PR update auto-approved")

        # Allow adding labels to issues (repos/.../issues/.../labels)
        if re.search(r'/issues/\d+/labels$', endpoint):
            if method in [None, "POST"]:
                return make_allow_decision("Issue label addition auto-approved")

    # Now check if method is destructive (after checking allowed endpoints)
    if method:
        if method in destructive_methods:
            return make_deny_decision(
                f"Destructive gh api command blocked: {method}"
            )
        elif method == "GET":
            return make_allow_decision("Read-only gh api GET request auto-approved")

    # Check for input flags (typically used with POST/PATCH)
    if has_input:
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
        #
        # IMPORTANT: We must handle GraphQL field aliases. In GraphQL, you can write:
        #   mutation { aliasName: actualOperation(args) { ... } }
        # If someone writes: mutation { resolveReviewThread: deleteIssue(args) { ... } }
        # The 'resolveReviewThread' is just an alias, the actual operation is 'deleteIssue'.
        # So we need to ensure the matched name is NOT followed by ':' (which would make it an alias).
        allowed_pr_mutations = (
            r'\bmutation\s*'           # mutation keyword
            r'(?:\w+\s*)?'             # optional mutation name
            r'(?:\([^)]*\)\s*)?'       # optional variables in parentheses
            r'\{\s*'                   # opening brace
            r'(resolveReviewThread|unresolveReviewThread|'
            r'addPullRequestReviewComment|addPullRequestReview)\b'  # word boundary ensures full name match
            r'(?!\s*:)'                # NOT followed by colon (would make it an alias)
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
        r"^gh pr (create|edit|ready|review|close|reopen|merge|comment)\b",
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
        (r"^gh workflow (disable|enable|run)\b", "Workflow modification"),
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


def make_ask_decision(reason: str) -> dict:
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "ask",
            "permissionDecisionReason": reason
        }
    }


if __name__ == "__main__":
    main()

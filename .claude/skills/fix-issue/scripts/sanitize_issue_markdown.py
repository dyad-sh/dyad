#!/usr/bin/env python3
"""
Sanitize GitHub issue markdown by removing comments, unusual formatting,
and other artifacts that may confuse LLMs processing the issue.
"""

import re
import sys


def sanitize_issue_markdown(markdown: str) -> str:
    """
    Sanitize GitHub issue markdown content.

    Removes:
    - HTML comments (<!-- ... -->)
    - Zero-width characters and other invisible Unicode
    - Excessive blank lines (more than 2 consecutive)
    - Leading/trailing whitespace on each line
    - HTML tags that aren't useful for understanding content
    - GitHub-specific directives that aren't content

    Args:
        markdown: Raw markdown string from GitHub issue

    Returns:
        Cleaned markdown string
    """
    result = markdown

    # Remove HTML comments (including multi-line)
    result = re.sub(r"<!--[\s\S]*?-->", "", result)

    # Remove zero-width characters and other invisible Unicode
    # (Zero-width space, non-joiner, joiner, word joiner, no-break space, etc.)
    result = re.sub(
        r"[\u200b\u200c\u200d\u2060\ufeff\u00ad\u034f\u061c\u180e]", "", result
    )

    # Remove other control characters (except newlines, tabs)
    result = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", result)

    # Remove HTML details/summary blocks but keep inner content
    result = re.sub(r"</?(?:details|summary)[^>]*>", "", result, flags=re.IGNORECASE)

    # Remove empty HTML tags
    result = re.sub(r"<([a-z]+)[^>]*>\s*</\1>", "", result, flags=re.IGNORECASE)

    # Remove GitHub task list markers that are just decoration
    # But keep the actual checkbox content (supports both [x] and [X])
    result = re.sub(r"^\s*-\s*\[[ xX]\]\s*$", "", result, flags=re.MULTILINE)

    # Normalize line endings
    result = result.replace("\r\n", "\n").replace("\r", "\n")

    # Strip trailing whitespace from each line
    result = "\n".join(line.rstrip() for line in result.split("\n"))

    # Collapse more than 2 consecutive blank lines into 2
    result = re.sub(r"\n{4,}", "\n\n\n", result)

    # Strip leading/trailing whitespace from the whole document
    result = result.strip()

    return result


def main():
    """Read from stdin, sanitize, write to stdout."""
    if len(sys.argv) > 1:
        # Read from file
        with open(sys.argv[1], "r", encoding="utf-8") as f:
            content = f.read()
    else:
        # Read from stdin
        content = sys.stdin.read()

    sanitized = sanitize_issue_markdown(content)
    print(sanitized)


if __name__ == "__main__":
    main()

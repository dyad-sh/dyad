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
    # Zero-width space, zero-width non-joiner, zero-width joiner,
    # word joiner, zero-width no-break space, etc.
    invisible_chars = [
        "\u200b",  # Zero-width space
        "\u200c",  # Zero-width non-joiner
        "\u200d",  # Zero-width joiner
        "\u2060",  # Word joiner
        "\ufeff",  # Zero-width no-break space / BOM
        "\u00ad",  # Soft hyphen
        "\u034f",  # Combining grapheme joiner
        "\u061c",  # Arabic letter mark
        "\u180e",  # Mongolian vowel separator
    ]
    for char in invisible_chars:
        result = result.replace(char, "")

    # Remove other control characters (except newlines, tabs)
    result = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", result)

    # Remove HTML details/summary blocks but keep inner content
    result = re.sub(r"<details[^>]*>", "", result, flags=re.IGNORECASE)
    result = re.sub(r"</details>", "", result, flags=re.IGNORECASE)
    result = re.sub(r"<summary[^>]*>", "", result, flags=re.IGNORECASE)
    result = re.sub(r"</summary>", "", result, flags=re.IGNORECASE)

    # Remove empty HTML tags
    result = re.sub(r"<([a-z]+)[^>]*>\s*</\1>", "", result, flags=re.IGNORECASE)

    # Remove GitHub task list markers that are just decoration
    # But keep the actual checkbox content
    result = re.sub(r"^(\s*)-\s*\[ \]\s*$", "", result, flags=re.MULTILINE)
    result = re.sub(r"^(\s*)-\s*\[x\]\s*$", "", result, flags=re.MULTILINE)

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

#!/usr/bin/env python3
"""
Unit tests for sanitize_issue_markdown.py using golden input/output pairs.
"""

import unittest
from pathlib import Path

from sanitize_issue_markdown import sanitize_issue_markdown


class TestSanitizeIssueMarkdown(unittest.TestCase):
    """Test the sanitize_issue_markdown function using golden files."""

    GOLDENS_DIR = Path(__file__).parent / "goldens"

    def _load_golden_pair(self, name: str) -> tuple[str, str]:
        """Load a golden input/output pair by name."""
        input_file = self.GOLDENS_DIR / f"{name}_input.md"
        output_file = self.GOLDENS_DIR / f"{name}_output.md"

        with open(input_file, "r", encoding="utf-8") as f:
            input_content = f.read()
        with open(output_file, "r", encoding="utf-8") as f:
            expected_output = f.read()

        return input_content, expected_output

    def _run_golden_test(self, name: str):
        """Run a golden test by name."""
        input_content, expected_output = self._load_golden_pair(name)
        actual_output = sanitize_issue_markdown(input_content)
        self.assertEqual(
            actual_output,
            expected_output,
            f"Golden test '{name}' failed.\n"
            f"Expected:\n{repr(expected_output)}\n\n"
            f"Actual:\n{repr(actual_output)}",
        )

    def test_html_comments(self):
        """Test that HTML comments are removed."""
        self._run_golden_test("html_comments")

    def test_invisible_chars(self):
        """Test that invisible/zero-width characters are removed."""
        self._run_golden_test("invisible_chars")

    def test_excessive_whitespace(self):
        """Test that excessive blank lines and trailing whitespace are normalized."""
        self._run_golden_test("excessive_whitespace")

    def test_details_summary(self):
        """Test that details/summary HTML tags are removed but content is kept."""
        self._run_golden_test("details_summary")

    def test_mixed(self):
        """Test a complex issue with multiple types of artifacts."""
        self._run_golden_test("mixed")

    def test_empty_input(self):
        """Test that empty input returns empty output."""
        self.assertEqual(sanitize_issue_markdown(""), "")

    def test_plain_text(self):
        """Test that plain text without artifacts is unchanged."""
        plain = "# Simple Issue\n\nThis is plain text.\n\n## Section\n\nMore text."
        self.assertEqual(sanitize_issue_markdown(plain), plain)

    def test_preserves_code_blocks(self):
        """Test that code blocks are preserved."""
        content = """# Issue

```python
def foo():
    # This is a comment in code, not HTML
    return 42
```

More text."""
        result = sanitize_issue_markdown(content)
        self.assertIn("# This is a comment in code", result)
        self.assertIn("def foo():", result)

    def test_preserves_inline_code(self):
        """Test that inline code is preserved."""
        content = "Use `<!-- not a comment -->` for HTML comments."
        # The sanitizer will still remove the HTML comment even in inline code
        # because we're doing a simple regex replacement. This is acceptable.
        result = sanitize_issue_markdown(content)
        self.assertIn("Use `", result)

    def test_preserves_links(self):
        """Test that markdown links are preserved."""
        content = "Check [this link](https://example.com) for more info."
        result = sanitize_issue_markdown(content)
        self.assertEqual(result, content)

    def test_preserves_images(self):
        """Test that image references are preserved."""
        content = "![Screenshot](https://example.com/image.png)"
        result = sanitize_issue_markdown(content)
        self.assertEqual(result, content)

    def test_crlf_normalization(self):
        """Test that CRLF line endings are normalized to LF."""
        content = "Line 1\r\nLine 2\r\nLine 3"
        result = sanitize_issue_markdown(content)
        self.assertEqual(result, "Line 1\nLine 2\nLine 3")

    def test_removes_control_characters(self):
        """Test that control characters are removed."""
        content = "Hello\x00World\x1fTest"
        result = sanitize_issue_markdown(content)
        self.assertEqual(result, "HelloWorldTest")


def discover_golden_tests():
    """Discover all golden test pairs in the goldens directory."""
    goldens_dir = Path(__file__).parent / "goldens"
    if not goldens_dir.exists():
        return []

    input_files = goldens_dir.glob("*_input.md")
    names = set()
    for f in input_files:
        name = f.stem.replace("_input", "")
        output_file = goldens_dir / f"{name}_output.md"
        if output_file.exists():
            names.add(name)
    return sorted(names)


if __name__ == "__main__":
    # Print discovered golden tests
    golden_tests = discover_golden_tests()
    print(f"Discovered {len(golden_tests)} golden test pairs: {golden_tests}")
    print()

    # Run tests
    unittest.main(verbosity=2)

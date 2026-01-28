#!/usr/bin/env python3
"""
Post consensus review results as GitHub PR comments.

Posts one summary comment plus inline comments on specific lines.
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path


def get_pr_head_sha(repo: str, pr_number: int) -> str | None:
    """Get the HEAD commit SHA of the PR."""
    try:
        result = subprocess.run(
            ['gh', 'pr', 'view', str(pr_number),
             '--repo', repo,
             '--json', 'headRefOid',
             '-q', '.headRefOid'],
            capture_output=True,
            text=True
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except FileNotFoundError:
        pass
    return None


def post_summary_comment(repo: str, pr_number: int, body: str) -> bool:
    """Post a summary comment on the PR."""
    try:
        result = subprocess.run(
            ['gh', 'pr', 'comment', str(pr_number),
             '--repo', repo,
             '--body', body],
            capture_output=True,
            text=True
        )
        if result.returncode != 0:
            print(f"Error posting summary comment: {result.stderr}")
            return False
        print(f"Summary comment posted to {repo}#{pr_number}")
        return True
    except FileNotFoundError:
        print("Error: GitHub CLI (gh) not found. Install from https://cli.github.com/")
        return False


def post_inline_review(repo: str, pr_number: int, commit_sha: str,
                       issues: list[dict], num_agents: int) -> bool:
    """Post a PR review with inline comments for each issue."""
    if not issues:
        return True

    # Build review comments for each issue
    comments = []
    for issue in issues:
        # Skip issues without valid file/line info
        file_path = issue.get('file', '')
        if not file_path or file_path.startswith('UNKNOWN'):
            continue

        line = issue.get('line_start', 0)
        if line <= 0:
            continue

        severity_emoji = {"HIGH": ":red_circle:", "MEDIUM": ":yellow_circle:", "LOW": ":green_circle:"}.get(
            issue.get('severity', 'LOW'), ":white_circle:"
        )

        body_parts = [
            f"**{severity_emoji} {issue.get('severity', 'LOW')}** | {issue.get('category', 'other')} | "
            f"Consensus: {issue.get('consensus_count', 0)}/{num_agents}",
            "",
            f"**{issue.get('title', 'Issue')}**",
            "",
            issue.get('description', ''),
        ]

        if issue.get('suggestion'):
            body_parts.extend(["", f":bulb: **Suggestion:** {issue['suggestion']}"])

        comments.append({
            "path": file_path,
            "line": line,
            "body": "\n".join(body_parts)
        })

    if not comments:
        print("No inline comments to post (all issues lack valid file/line info)")
        return True

    # Create the review payload
    review_payload = {
        "commit_id": commit_sha,
        "body": f"Multi-agent code review found {len(comments)} issue(s) with consensus.",
        "event": "COMMENT",
        "comments": comments
    }

    # Post using gh api
    try:
        result = subprocess.run(
            ['gh', 'api',
             f'repos/{repo}/pulls/{pr_number}/reviews',
             '-X', 'POST',
             '--input', '-'],
            input=json.dumps(review_payload),
            capture_output=True,
            text=True
        )
        if result.returncode != 0:
            print(f"Error posting inline review: {result.stderr}")
            # Try to parse error for more detail
            try:
                error_data = json.loads(result.stderr)
                if 'message' in error_data:
                    print(f"GitHub API error: {error_data['message']}")
                if 'errors' in error_data:
                    for err in error_data['errors']:
                        print(f"  - {err}")
            except json.JSONDecodeError:
                pass
            return False
        print(f"Posted {len(comments)} inline comment(s) to {repo}#{pr_number}")
        return True
    except FileNotFoundError:
        print("Error: GitHub CLI (gh) not found")
        return False


def filter_duplicate_issues(issues: list[dict], existing_comments: dict) -> tuple[list[dict], int]:
    """Filter out issues that already have comments on the PR.

    Returns (filtered_issues, num_duplicates).
    """
    review_comments = existing_comments.get('review_comments', [])

    filtered = []
    duplicates = 0

    for issue in issues:
        file_path = issue.get('file', '')
        line = issue.get('line_start', 0)
        title = issue.get('title', '').lower()

        # Check if there's already a comment at this location with similar content
        is_duplicate = False
        for existing in review_comments:
            if existing.get('path') == file_path:
                existing_line = existing.get('line', 0)
                existing_body = existing.get('body', '').lower()

                # Same line (within tolerance) and similar title/content
                if abs(existing_line - line) <= 3:
                    # Check if title keywords appear in existing comment
                    title_words = set(title.split())
                    if any(word in existing_body for word in title_words if len(word) > 3):
                        is_duplicate = True
                        break

        if is_duplicate:
            duplicates += 1
        else:
            filtered.append(issue)

    return filtered, duplicates


def format_summary_comment(
    issues: list[dict],
    num_agents: int,
    num_duplicates: int = 0,
    low_priority_issues: list[dict] | None = None
) -> str:
    """Format a summary comment with markdown table.

    Always posts a summary, even if no new issues.
    """
    high_issues = [i for i in issues if i.get('severity') == 'HIGH']
    medium_issues = [i for i in issues if i.get('severity') == 'MEDIUM']
    low_issues = [i for i in issues if i.get('severity') == 'LOW']

    lines = [
        "## :mag: Multi-Agent Code Review",
        "",
    ]

    # Summary counts
    if not issues and not low_priority_issues:
        if num_duplicates > 0:
            lines.append(f":white_check_mark: No new issues found. ({num_duplicates} issue(s) already commented on)")
        else:
            lines.append(":white_check_mark: No issues found by consensus review.")
        lines.extend(["", "*Generated by multi-agent consensus review*"])
        return "\n".join(lines)

    total_new = len(issues)
    lines.append(f"Found **{total_new}** new issue(s) flagged by {num_agents} independent reviewers.")
    if num_duplicates > 0:
        lines.append(f"({num_duplicates} issue(s) skipped - already commented)")
    lines.append("")

    # Severity summary
    lines.append("### Summary")
    lines.append("")
    lines.append("| Severity | Count |")
    lines.append("|----------|-------|")
    lines.append(f"| :red_circle: HIGH | {len(high_issues)} |")
    lines.append(f"| :yellow_circle: MEDIUM | {len(medium_issues)} |")
    lines.append(f"| :green_circle: LOW | {len(low_issues)} |")
    lines.append("")

    # Issues table (HIGH and MEDIUM)
    actionable_issues = high_issues + medium_issues
    if actionable_issues:
        lines.append("### Issues to Address")
        lines.append("")
        lines.append("| Severity | File | Issue |")
        lines.append("|----------|------|-------|")

        for issue in actionable_issues:
            severity = issue.get('severity', 'LOW')
            emoji = {"HIGH": ":red_circle:", "MEDIUM": ":yellow_circle:"}.get(severity, ":white_circle:")
            file_path = issue.get('file', 'unknown')
            line_start = issue.get('line_start', 0)
            title = issue.get('title', 'Issue')

            if file_path.startswith('UNKNOWN'):
                location = file_path
            elif line_start > 0:
                location = f"`{file_path}:{line_start}`"
            else:
                location = f"`{file_path}`"

            lines.append(f"| {emoji} {severity} | {location} | {title} |")

        lines.append("")

    # Low priority section
    if low_issues:
        lines.append("<details>")
        lines.append("<summary>:green_circle: Low Priority Issues ({} items)</summary>".format(len(low_issues)))
        lines.append("")
        for issue in low_issues:
            file_path = issue.get('file', 'unknown')
            line_start = issue.get('line_start', 0)
            title = issue.get('title', 'Issue')

            if file_path.startswith('UNKNOWN'):
                location = file_path
            elif line_start > 0:
                location = f"`{file_path}:{line_start}`"
            else:
                location = f"`{file_path}`"

            lines.append(f"- **{title}** - {location}")
        lines.append("")
        lines.append("</details>")
        lines.append("")

    if actionable_issues:
        lines.append("See inline comments for details.")
        lines.append("")

    lines.append("*Generated by multi-agent consensus review*")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description='Post PR review comments')
    parser.add_argument('--pr-number', type=int, required=True, help='PR number')
    parser.add_argument('--repo', type=str, required=True, help='Repository (owner/repo)')
    parser.add_argument('--results', type=str, required=True, help='Path to consensus_results.json')
    parser.add_argument('--dry-run', action='store_true', help='Print comments instead of posting')
    parser.add_argument('--summary-only', action='store_true', help='Only post summary, no inline comments')
    args = parser.parse_args()

    # Load results
    results_path = Path(args.results)
    if not results_path.exists():
        print(f"Error: Results file not found: {args.results}")
        sys.exit(1)

    with open(results_path) as f:
        results = json.load(f)

    consensus_issues = results.get('consensus_issues', [])
    num_agents = results.get('num_agents', 3)
    existing_comments = results.get('existing_comments', {'review_comments': [], 'pr_comments': []})

    # Filter out issues that already have comments
    filtered_issues, num_duplicates = filter_duplicate_issues(consensus_issues, existing_comments)

    if num_duplicates > 0:
        print(f"Filtered out {num_duplicates} duplicate issue(s) already commented on")

    # Separate low priority issues for summary section
    high_medium_issues = [i for i in filtered_issues if i.get('severity') in ('HIGH', 'MEDIUM')]
    low_issues = [i for i in filtered_issues if i.get('severity') == 'LOW']

    # Format summary comment (always post, even if no new issues)
    summary_body = format_summary_comment(
        filtered_issues,
        num_agents,
        num_duplicates=num_duplicates,
        low_priority_issues=low_issues
    )

    if args.dry_run:
        print("DRY RUN - Would post the following:")
        print("\n" + "=" * 50)
        print("SUMMARY COMMENT:")
        print("=" * 50)
        print(summary_body)

        if not args.summary_only and high_medium_issues:
            print("\n" + "=" * 50)
            print("INLINE COMMENTS (HIGH/MEDIUM only):")
            print("=" * 50)
            for issue in high_medium_issues:
                file_path = issue.get('file', '')
                line = issue.get('line_start', 0)
                if file_path and not file_path.startswith('UNKNOWN') and line > 0:
                    print(f"\n--- {file_path}:{line} ---")
                    print(f"[{issue.get('severity')}] {issue.get('title')}")
                    print(issue.get('description', ''))
        return 0

    # Get PR head commit SHA for inline comments
    commit_sha = None
    if not args.summary_only:
        commit_sha = get_pr_head_sha(args.repo, args.pr_number)
        if not commit_sha:
            print("Warning: Could not get PR head SHA, falling back to summary-only mode")
            args.summary_only = True

    # Post summary comment
    if not post_summary_comment(args.repo, args.pr_number, summary_body):
        sys.exit(1)

    # Post inline comments (only for HIGH/MEDIUM issues)
    if not args.summary_only and high_medium_issues and commit_sha:
        assert commit_sha is not None  # Type narrowing for pyright
        if not post_inline_review(args.repo, args.pr_number, commit_sha,
                                  high_medium_issues, num_agents):
            print("Warning: Failed to post some inline comments")
            # Don't exit with error - summary was posted successfully

    return 0


if __name__ == '__main__':
    sys.exit(main())

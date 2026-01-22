#!/usr/bin/env python3
"""
Multi-Agent PR Review Orchestrator

Spawns multiple Claude sub-agents to review a PR diff, each receiving files
in a different randomized order. Aggregates results using consensus voting.
"""

import argparse
import asyncio
import json
import os
import random
import re
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional

try:
    import anthropic
except ImportError:
    print("Error: anthropic package required. Install with: pip install anthropic")
    sys.exit(1)

# Configuration
NUM_AGENTS = 3
CONSENSUS_THRESHOLD = 2
MIN_SEVERITY = "MEDIUM"
MODEL = "claude-sonnet-4-20250514"
MAX_TOKENS = 4096

SEVERITY_RANK = {"HIGH": 3, "MEDIUM": 2, "LOW": 1}

REVIEW_SYSTEM_PROMPT = """You are a code reviewer analyzing a pull request for correctness issues.

Review the provided code changes carefully. For each issue you identify:
1. Specify the exact file path
2. Specify the line number(s) affected
3. Describe the issue clearly and concisely
4. Classify the criticality level

Criticality levels:
- HIGH: Security vulnerabilities, data loss risks, crashes, race conditions, broken core functionality
- MEDIUM: Logic errors, unhandled edge cases, performance issues, resource leaks, maintainability concerns
- LOW: Style issues, minor improvements, documentation gaps, naming suggestions

Output ONLY a JSON array of issues. No other text.

Schema:
[
  {
    "file": "path/to/file.py",
    "line_start": 42,
    "line_end": 45,
    "severity": "HIGH|MEDIUM|LOW",
    "category": "security|logic|performance|error-handling|style|other",
    "title": "Brief issue title",
    "description": "Detailed explanation of the issue and why it matters",
    "suggestion": "Optional: how to fix it"
  }
]

If no issues found, return an empty array: []"""


@dataclass
class Issue:
    file: str
    line_start: int
    line_end: int
    severity: str
    category: str
    title: str
    description: str
    suggestion: Optional[str] = None
    agent_id: Optional[int] = None


@dataclass
class FileDiff:
    path: str
    content: str
    additions: int
    deletions: int


def parse_unified_diff(diff_content: str) -> list[FileDiff]:
    """Parse a unified diff into individual file diffs."""
    files = []
    current_file = None
    current_content = []
    additions = 0
    deletions = 0
    
    for line in diff_content.split('\n'):
        if line.startswith('diff --git'):
            # Save previous file
            if current_file:
                files.append(FileDiff(
                    path=current_file,
                    content='\n'.join(current_content),
                    additions=additions,
                    deletions=deletions
                ))
            # Extract new filename
            match = re.search(r'b/(.+)$', line)
            current_file = match.group(1) if match else None
            current_content = [line]
            additions = 0
            deletions = 0
        elif current_file:
            current_content.append(line)
            if line.startswith('+') and not line.startswith('+++'):
                additions += 1
            elif line.startswith('-') and not line.startswith('---'):
                deletions += 1
    
    # Save last file
    if current_file:
        files.append(FileDiff(
            path=current_file,
            content='\n'.join(current_content),
            additions=additions,
            deletions=deletions
        ))
    
    return files


def create_shuffled_orderings(files: list[FileDiff], num_orderings: int) -> list[list[FileDiff]]:
    """Create multiple different orderings of the file list."""
    orderings = []
    for i in range(num_orderings):
        shuffled = files.copy()
        random.seed(i * 12345)  # Different seed for each agent
        random.shuffle(shuffled)
        orderings.append(shuffled)
    return orderings


def build_review_prompt(files: list[FileDiff]) -> str:
    """Build the review prompt with file diffs in the given order."""
    prompt_parts = ["Please review the following code changes:\n"]
    
    for i, f in enumerate(files, 1):
        prompt_parts.append(f"\n--- File {i}: {f.path} ({f.additions}+, {f.deletions}-) ---\n")
        prompt_parts.append(f.content)
    
    prompt_parts.append("\n\nAnalyze these changes and report any correctness issues as JSON.")
    return '\n'.join(prompt_parts)


async def run_sub_agent(
    client: anthropic.AsyncAnthropic,
    agent_id: int,
    files: list[FileDiff]
) -> list[Issue]:
    """Run a single sub-agent review."""
    prompt = build_review_prompt(files)
    
    print(f"  Agent {agent_id}: Starting review ({len(files)} files)...")
    
    try:
        response = await client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=REVIEW_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}]
        )
        
        # Extract JSON from response
        content = response.content[0].text.strip()
        
        # Handle potential markdown code blocks
        if content.startswith('```'):
            content = re.sub(r'^```\w*\n?', '', content)
            content = re.sub(r'\n?```$', '', content)
        
        issues_data = json.loads(content)
        issues = []
        
        for item in issues_data:
            issue = Issue(
                file=item.get('file', ''),
                line_start=item.get('line_start', 0),
                line_end=item.get('line_end', item.get('line_start', 0)),
                severity=item.get('severity', 'LOW').upper(),
                category=item.get('category', 'other'),
                title=item.get('title', ''),
                description=item.get('description', ''),
                suggestion=item.get('suggestion'),
                agent_id=agent_id
            )
            issues.append(issue)
        
        print(f"  Agent {agent_id}: Found {len(issues)} issues")
        return issues
        
    except json.JSONDecodeError as e:
        print(f"  Agent {agent_id}: Failed to parse JSON response: {e}")
        return []
    except Exception as e:
        print(f"  Agent {agent_id}: Error: {e}")
        return []


def issues_match(a: Issue, b: Issue, line_tolerance: int = 5) -> bool:
    """Check if two issues refer to the same problem."""
    if a.file != b.file:
        return False
    
    # Check line overlap with tolerance
    a_range = set(range(a.line_start - line_tolerance, a.line_end + line_tolerance + 1))
    b_range = set(range(b.line_start, b.line_end + 1))
    if not a_range.intersection(b_range):
        return False
    
    # Same category is a strong signal
    if a.category == b.category:
        return True
    
    # Check for similar titles (simple word overlap)
    a_words = set(a.title.lower().split())
    b_words = set(b.title.lower().split())
    overlap = len(a_words.intersection(b_words))
    if overlap >= 2 or (overlap >= 1 and len(a_words) <= 3):
        return True
    
    return False


def aggregate_issues(
    all_issues: list[list[Issue]],
    consensus_threshold: int = CONSENSUS_THRESHOLD,
    min_severity: str = MIN_SEVERITY
) -> list[dict]:
    """Aggregate issues using consensus voting."""
    # Flatten all issues with their source agent
    flat_issues = []
    for agent_issues in all_issues:
        flat_issues.extend(agent_issues)
    
    if not flat_issues:
        return []
    
    # Group similar issues
    groups = []
    used = set()
    
    for i, issue in enumerate(flat_issues):
        if i in used:
            continue
        
        group = [issue]
        used.add(i)
        
        for j, other in enumerate(flat_issues):
            if j in used:
                continue
            if issues_match(issue, other):
                group.append(other)
                used.add(j)
        
        groups.append(group)
    
    # Filter by consensus and severity
    min_rank = SEVERITY_RANK.get(min_severity, 2)
    consensus_issues = []
    
    for group in groups:
        # Count unique agents
        agents = set(issue.agent_id for issue in group)
        if len(agents) < consensus_threshold:
            continue
        
        # Check if any agent rated it at min_severity or above
        max_severity = max(SEVERITY_RANK.get(i.severity, 0) for i in group)
        if max_severity < min_rank:
            continue
        
        # Use the highest-severity version as the representative
        representative = max(group, key=lambda i: SEVERITY_RANK.get(i.severity, 0))
        
        consensus_issues.append({
            **asdict(representative),
            'consensus_count': len(agents),
            'all_severities': [i.severity for i in group]
        })
    
    # Sort by severity (highest first), then by file
    consensus_issues.sort(
        key=lambda x: (-SEVERITY_RANK.get(x['severity'], 0), x['file'], x['line_start'])
    )
    
    return consensus_issues


def format_pr_comment(issues: list[dict], pr_number: int) -> str:
    """Format consensus issues as a GitHub PR comment."""
    if not issues:
        return "## 🔍 Multi-Agent Code Review\n\nNo significant issues found by consensus review."
    
    lines = [
        "## 🔍 Multi-Agent Code Review",
        "",
        f"Found **{len(issues)}** issue(s) flagged by multiple reviewers:",
        ""
    ]
    
    for i, issue in enumerate(issues, 1):
        severity_emoji = {"HIGH": "🔴", "MEDIUM": "🟡", "LOW": "🟢"}.get(issue['severity'], "⚪")
        
        lines.append(f"### {severity_emoji} {issue['title']}")
        lines.append("")
        lines.append(f"**File:** `{issue['file']}` (lines {issue['line_start']}-{issue['line_end']})")
        lines.append(f"**Severity:** {issue['severity']} | **Category:** {issue['category']}")
        lines.append(f"**Consensus:** {issue['consensus_count']}/{NUM_AGENTS} reviewers")
        lines.append("")
        lines.append(issue['description'])
        
        if issue.get('suggestion'):
            lines.append("")
            lines.append(f"💡 **Suggestion:** {issue['suggestion']}")
        
        lines.append("")
        lines.append("---")
        lines.append("")
    
    lines.append("*Generated by multi-agent consensus review*")
    
    return '\n'.join(lines)


async def main():
    parser = argparse.ArgumentParser(description='Multi-agent PR review orchestrator')
    parser.add_argument('--pr-number', type=int, required=True, help='PR number')
    parser.add_argument('--repo', type=str, required=True, help='Repository (owner/repo)')
    parser.add_argument('--diff-file', type=str, required=True, help='Path to diff file')
    parser.add_argument('--output', type=str, default='consensus_results.json', help='Output file')
    parser.add_argument('--num-agents', type=int, default=NUM_AGENTS, help='Number of sub-agents')
    parser.add_argument('--threshold', type=int, default=CONSENSUS_THRESHOLD, help='Consensus threshold')
    parser.add_argument('--min-severity', type=str, default=MIN_SEVERITY, 
                       choices=['HIGH', 'MEDIUM', 'LOW'], help='Minimum severity to report')
    args = parser.parse_args()
    
    # Check for API key
    if not os.environ.get('ANTHROPIC_API_KEY'):
        print("Error: ANTHROPIC_API_KEY environment variable required")
        sys.exit(1)
    
    # Read diff file
    diff_path = Path(args.diff_file)
    if not diff_path.exists():
        print(f"Error: Diff file not found: {args.diff_file}")
        sys.exit(1)
    
    diff_content = diff_path.read_text()
    
    print(f"Multi-Agent PR Review")
    print(f"=====================")
    print(f"PR: {args.repo}#{args.pr_number}")
    print(f"Agents: {args.num_agents}")
    print(f"Consensus threshold: {args.threshold}")
    print(f"Min severity: {args.min_severity}")
    print()
    
    # Parse diff into files
    files = parse_unified_diff(diff_content)
    print(f"Parsed {len(files)} changed files")
    
    if not files:
        print("No files to review")
        sys.exit(0)
    
    # Create shuffled orderings
    orderings = create_shuffled_orderings(files, args.num_agents)
    
    # Run sub-agents in parallel
    print(f"\nSpawning {args.num_agents} review agents...")
    client = anthropic.AsyncAnthropic()
    
    tasks = [
        run_sub_agent(client, i + 1, ordering)
        for i, ordering in enumerate(orderings)
    ]
    
    all_results = await asyncio.gather(*tasks)
    
    # Aggregate results
    print(f"\nAggregating results...")
    consensus_issues = aggregate_issues(
        all_results,
        consensus_threshold=args.threshold,
        min_severity=args.min_severity
    )
    
    print(f"Found {len(consensus_issues)} consensus issues")
    
    # Save results
    output = {
        'pr_number': args.pr_number,
        'repo': args.repo,
        'num_agents': args.num_agents,
        'consensus_threshold': args.threshold,
        'min_severity': args.min_severity,
        'total_issues_per_agent': [len(r) for r in all_results],
        'consensus_issues': consensus_issues,
        'comment_body': format_pr_comment(consensus_issues, args.pr_number)
    }
    
    output_path = Path(args.output)
    output_path.write_text(json.dumps(output, indent=2))
    print(f"Results saved to: {args.output}")
    
    # Print summary
    print(f"\n{'='*50}")
    print("CONSENSUS ISSUES SUMMARY")
    print(f"{'='*50}")
    
    if not consensus_issues:
        print("No issues met consensus threshold")
    else:
        for issue in consensus_issues:
            print(f"\n[{issue['severity']}] {issue['title']}")
            print(f"  File: {issue['file']}:{issue['line_start']}")
            print(f"  Consensus: {issue['consensus_count']}/{args.num_agents} agents")
    
    return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))

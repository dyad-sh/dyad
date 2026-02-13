#!/usr/bin/env python3
"""
Reasoned validation of code review issues.

Uses LLM to reason through each issue and determine:
- Whether it's a real problem or false positive
- Whether the severity is merited
- What the merge verdict should be
"""

import argparse
import asyncio
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

try:
    import anthropic
except ImportError:
    print("Error: anthropic package required. Install with: pip install anthropic")
    sys.exit(1)

VALIDATION_MODEL = "claude-sonnet-4-5"
SEVERITY_RANK = {"HIGH": 3, "MEDIUM": 2, "LOW": 1}


@dataclass
class ValidatedIssue:
    """An issue that has been validated through reasoned analysis."""
    file: str
    line_start: int
    line_end: int
    severity: str
    category: str
    title: str
    description: str
    suggestion: Optional[str]
    is_valid: bool
    validation_reasoning: str
    original_severity: str
    agent_count: int


@dataclass
class DroppedIssue:
    """An issue that was dropped during validation."""
    file: str
    line_start: int
    title: str
    drop_reason: str


def determine_merge_verdict(
    validated_issues: list[ValidatedIssue]
) -> tuple[str, str]:
    """Determine merge verdict based on validated issues.

    Returns:
        Tuple of (verdict, rationale) where verdict is YES/NOT SURE/NO
    """
    high_issues = [i for i in validated_issues if i.severity == 'HIGH']
    medium_issues = [i for i in validated_issues if i.severity == 'MEDIUM']

    if high_issues:
        return "NO", f"Do NOT merge: {len(high_issues)} HIGH severity issue(s) found"
    elif len(medium_issues) >= 3:
        return "NO", f"Do NOT merge: {len(medium_issues)} MEDIUM severity issues need attention"
    elif len(medium_issues) >= 2:
        return "NOT SURE", f"Review recommended: {len(medium_issues)} MEDIUM severity issues found"
    elif len(medium_issues) == 1:
        return "NOT SURE", "Review recommended: 1 MEDIUM severity issue found"
    else:
        return "YES", "Merge with confidence: No significant issues found"


async def validate_issues(
    client: anthropic.AsyncAnthropic,
    grouped_issues: list[list[dict]],
    diff_content: str = ""
) -> tuple[list[ValidatedIssue], list[DroppedIssue]]:
    """Use LLM to validate each issue group through reasoned analysis.

    Args:
        client: Anthropic client
        grouped_issues: List of issue groups (issues that refer to the same problem)
        diff_content: Optional diff content for context

    Returns:
        Tuple of (validated_issues, dropped_issues)
    """
    if not grouped_issues:
        return [], []

    # Build the validation prompt
    issue_descriptions = []
    for i, group in enumerate(grouped_issues):
        representative = group[0]
        agent_count = len(set(issue.get('agent_id', 0) for issue in group))
        severities = [issue.get('severity', 'LOW') for issue in group]

        issue_descriptions.append(
            f"Issue {i + 1}:\n"
            f"  File: {representative.get('file', 'unknown')}\n"
            f"  Lines: {representative.get('line_start', 0)}-{representative.get('line_end', 0)}\n"
            f"  Severity: {representative.get('severity', 'LOW')} (agents rated: {', '.join(severities)})\n"
            f"  Category: {representative.get('category', 'other')}\n"
            f"  Title: {representative.get('title', '')}\n"
            f"  Description: {representative.get('description', '')}\n"
            f"  Flagged by: {agent_count} agent(s)\n"
        )

    prompt = f"""You are a senior code reviewer validating issues found by multiple review agents.

For each issue below, reason through whether it's a REAL problem that should be fixed:

1. **Validate the issue**: Is this actually a bug/problem, or could the agents be misunderstanding the code?
   - Consider framework conventions, common patterns, and surrounding context
   - Consider if this could be a false positive from not having full project context

2. **Assess severity**: Is the assigned severity merited?
   - HIGH should be reserved for: security vulnerabilities, data loss, crashes, broken functionality
   - MEDIUM is for: logic errors, edge cases, performance issues, maintainability problems
   - LOW is for: style issues, minor improvements, nitpicks
   - Adjust severity up or down based on actual impact

3. **Make a decision**: Keep the issue (with potentially adjusted severity) or DROP it as a false positive

Issues to validate:
{chr(10).join(issue_descriptions)}

Output a JSON object with:
{{
  "validated_issues": [
    {{
      "issue_index": 1,
      "is_valid": true/false,
      "reasoning": "Brief explanation of why this is/isn't a real issue",
      "adjusted_severity": "HIGH/MEDIUM/LOW",
      "severity_rationale": "Why this severity is appropriate (if adjusted)"
    }}
  ]
}}

Be conservative - only DROP issues you're confident are false positives.
Output ONLY the JSON object, no other text."""

    try:
        response = await client.messages.create(
            model=VALIDATION_MODEL,
            max_tokens=8192,
            messages=[{"role": "user", "content": prompt}]
        )

        # Extract text content
        content = None
        for block in response.content:
            if block.type == "text":
                content = block.text.strip()
                break

        if content is None:
            raise ValueError("No text response from validation model")

        # Handle markdown code blocks
        if content.startswith('```'):
            content = re.sub(r'^```\w*\n?', '', content)
            content = re.sub(r'\n?```$', '', content)

        result = json.loads(content)
        validations = result.get('validated_issues', [])

        validated_issues = []
        dropped_issues = []

        for validation in validations:
            idx = validation.get('issue_index', 0) - 1  # Convert to 0-based
            if idx < 0 or idx >= len(grouped_issues):
                continue

            group = grouped_issues[idx]
            representative = group[0]
            agent_count = len(set(issue.get('agent_id', 0) for issue in group))

            if validation.get('is_valid', True):
                validated_issues.append(ValidatedIssue(
                    file=representative.get('file', ''),
                    line_start=representative.get('line_start', 0),
                    line_end=representative.get('line_end', 0),
                    severity=validation.get('adjusted_severity', representative.get('severity', 'LOW')),
                    category=representative.get('category', 'other'),
                    title=representative.get('title', ''),
                    description=representative.get('description', ''),
                    suggestion=representative.get('suggestion'),
                    is_valid=True,
                    validation_reasoning=validation.get('reasoning', ''),
                    original_severity=representative.get('severity', 'LOW'),
                    agent_count=agent_count
                ))
            else:
                dropped_issues.append(DroppedIssue(
                    file=representative.get('file', ''),
                    line_start=representative.get('line_start', 0),
                    title=representative.get('title', ''),
                    drop_reason=validation.get('reasoning', 'Determined to be false positive')
                ))

        # Handle any issues not in the validation response (keep them by default)
        validated_indices = set(v.get('issue_index', 0) - 1 for v in validations)
        for idx, group in enumerate(grouped_issues):
            if idx not in validated_indices:
                representative = group[0]
                agent_count = len(set(issue.get('agent_id', 0) for issue in group))
                validated_issues.append(ValidatedIssue(
                    file=representative.get('file', ''),
                    line_start=representative.get('line_start', 0),
                    line_end=representative.get('line_end', 0),
                    severity=representative.get('severity', 'LOW'),
                    category=representative.get('category', 'other'),
                    title=representative.get('title', ''),
                    description=representative.get('description', ''),
                    suggestion=representative.get('suggestion'),
                    is_valid=True,
                    validation_reasoning="Not explicitly validated, kept by default",
                    original_severity=representative.get('severity', 'LOW'),
                    agent_count=agent_count
                ))

        # Sort by severity
        validated_issues.sort(
            key=lambda x: (-SEVERITY_RANK.get(x.severity, 0), x.file, x.line_start)
        )

        return validated_issues, dropped_issues

    except (json.JSONDecodeError, ValueError) as e:
        print(f"Warning: Failed to parse validation response: {e}")
        # Fall back to keeping all issues
        validated_issues = []
        for group in grouped_issues:
            representative = group[0]
            agent_count = len(set(issue.get('agent_id', 0) for issue in group))
            validated_issues.append(ValidatedIssue(
                file=representative.get('file', ''),
                line_start=representative.get('line_start', 0),
                line_end=representative.get('line_end', 0),
                severity=representative.get('severity', 'LOW'),
                category=representative.get('category', 'other'),
                title=representative.get('title', ''),
                description=representative.get('description', ''),
                suggestion=representative.get('suggestion'),
                is_valid=True,
                validation_reasoning="Validation failed, kept by default",
                original_severity=representative.get('severity', 'LOW'),
                agent_count=agent_count
            ))
        return validated_issues, []


def format_validated_results(
    validated_issues: list[ValidatedIssue],
    dropped_issues: list[DroppedIssue],
    num_agents: int = 3
) -> dict:
    """Format validated results for output."""
    verdict, rationale = determine_merge_verdict(validated_issues)

    return {
        'merge_verdict': verdict,
        'merge_rationale': rationale,
        'validated_issues': [
            {
                'file': i.file,
                'line_start': i.line_start,
                'line_end': i.line_end,
                'severity': i.severity,
                'original_severity': i.original_severity,
                'category': i.category,
                'title': i.title,
                'description': i.description,
                'suggestion': i.suggestion,
                'validation_reasoning': i.validation_reasoning,
                'agent_count': i.agent_count
            }
            for i in validated_issues
        ],
        'dropped_issues': [
            {
                'file': d.file,
                'line_start': d.line_start,
                'title': d.title,
                'drop_reason': d.drop_reason
            }
            for d in dropped_issues
        ]
    }


async def main():
    parser = argparse.ArgumentParser(description='Validate code review issues')
    parser.add_argument('input_file', help='JSON file with grouped issues')
    parser.add_argument('--output', '-o', type=str, default='-', help='Output file (- for stdout)')
    args = parser.parse_args()

    # Load input
    input_path = Path(args.input_file)
    if not input_path.exists():
        print(f"Error: Input file not found: {args.input_file}", file=sys.stderr)
        sys.exit(1)

    with open(input_path) as f:
        data = json.load(f)

    grouped_issues = data.get('grouped_issues', [])

    if not grouped_issues:
        print("No issues to validate", file=sys.stderr)
        result = format_validated_results([], [])
    else:
        client = anthropic.AsyncAnthropic()
        validated, dropped = await validate_issues(client, grouped_issues)
        result = format_validated_results(validated, dropped)

    # Output
    output_json = json.dumps(result, indent=2)

    if args.output == '-':
        print(output_json)
    else:
        Path(args.output).write_text(output_json)
        print(f"Wrote validation results to {args.output}", file=sys.stderr)

    return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))

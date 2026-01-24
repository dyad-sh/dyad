#!/usr/bin/env python3
"""
Standalone issue aggregation using consensus voting.

Can be used to re-process raw agent outputs or for testing.
"""

import argparse
import json
import sys
from pathlib import Path

SEVERITY_RANK = {"HIGH": 3, "MEDIUM": 2, "LOW": 1}


def issues_match(a: dict, b: dict, line_tolerance: int = 5) -> bool:
    """Check if two issues refer to the same problem."""
    if a['file'] != b['file']:
        return False
    
    # Check line overlap with tolerance (applied symmetrically to both issues)
    a_start = a.get('line_start', 0)
    a_end = a.get('line_end', a_start)
    b_start = b.get('line_start', 0)
    b_end = b.get('line_end', b_start)

    a_range = set(range(max(1, a_start - line_tolerance), a_end + line_tolerance + 1))
    b_range = set(range(max(1, b_start - line_tolerance), b_end + line_tolerance + 1))
    
    if not a_range.intersection(b_range):
        return False
    
    # Same category is a strong signal
    if a.get('category') == b.get('category'):
        return True
    
    # Check for similar titles
    a_words = set(a.get('title', '').lower().split())
    b_words = set(b.get('title', '').lower().split())
    overlap = len(a_words.intersection(b_words))
    
    if overlap >= 2 or (overlap >= 1 and len(a_words) <= 3):
        return True
    
    return False


def aggregate(
    agent_results: list[list[dict]],
    consensus_threshold: int = 2,
    min_severity: str = "MEDIUM"
) -> list[dict]:
    """
    Aggregate issues from multiple agents using consensus voting.
    
    Args:
        agent_results: List of issue lists, one per agent
        consensus_threshold: Minimum number of agents that must agree
        min_severity: Minimum severity level to include
    
    Returns:
        List of consensus issues
    """
    # Flatten and tag with agent ID
    flat_issues = []
    for agent_id, issues in enumerate(agent_results):
        for issue in issues:
            issue_copy = dict(issue)
            issue_copy['agent_id'] = agent_id
            flat_issues.append(issue_copy)
    
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
    min_rank = SEVERITY_RANK.get(min_severity.upper(), 2)
    consensus_issues = []
    
    for group in groups:
        # Count unique agents
        agents = set(issue['agent_id'] for issue in group)
        if len(agents) < consensus_threshold:
            continue
        
        # Check severity threshold
        max_severity = max(SEVERITY_RANK.get(i.get('severity', 'LOW').upper(), 0) for i in group)
        if max_severity < min_rank:
            continue
        
        # Use highest-severity version as representative
        representative = max(group, key=lambda i: SEVERITY_RANK.get(i.get('severity', 'LOW').upper(), 0))
        
        result = dict(representative)
        result['consensus_count'] = len(agents)
        result['all_severities'] = [i.get('severity', 'LOW') for i in group]
        del result['agent_id']
        
        consensus_issues.append(result)
    
    # Sort by severity then file
    consensus_issues.sort(
        key=lambda x: (-SEVERITY_RANK.get(x.get('severity', 'LOW').upper(), 0), 
                       x.get('file', ''), 
                       x.get('line_start', 0))
    )
    
    return consensus_issues


def main():
    parser = argparse.ArgumentParser(description='Aggregate agent review results')
    parser.add_argument('input_files', nargs='+', help='JSON files with agent results')
    parser.add_argument('--output', '-o', type=str, default='-', help='Output file (- for stdout)')
    parser.add_argument('--threshold', type=int, default=2, help='Consensus threshold')
    parser.add_argument('--min-severity', type=str, default='MEDIUM',
                       choices=['HIGH', 'MEDIUM', 'LOW'], help='Minimum severity')
    args = parser.parse_args()
    
    # Load all agent results
    agent_results = []
    for input_file in args.input_files:
        path = Path(input_file)
        if not path.exists():
            print(f"Warning: File not found: {input_file}", file=sys.stderr)
            continue
        
        with open(path) as f:
            data = json.load(f)
            # Handle both raw arrays and wrapped results
            if isinstance(data, list):
                agent_results.append(data)
            elif isinstance(data, dict) and 'issues' in data:
                agent_results.append(data['issues'])
            else:
                print(f"Warning: Unexpected format in {input_file}", file=sys.stderr)
    
    if not agent_results:
        print("Error: No valid input files", file=sys.stderr)
        sys.exit(1)
    
    # Aggregate
    consensus = aggregate(
        agent_results,
        consensus_threshold=args.threshold,
        min_severity=args.min_severity
    )
    
    # Output
    output_json = json.dumps(consensus, indent=2)
    
    if args.output == '-':
        print(output_json)
    else:
        Path(args.output).write_text(output_json)
        print(f"Wrote {len(consensus)} consensus issues to {args.output}", file=sys.stderr)
    
    return 0


if __name__ == '__main__':
    sys.exit(main())

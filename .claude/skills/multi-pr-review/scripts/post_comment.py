#!/usr/bin/env python3
"""
Post consensus review results as a GitHub PR comment.
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


def post_comment_gh_cli(repo: str, pr_number: int, body: str) -> bool:
    """Post comment using GitHub CLI."""
    try:
        result = subprocess.run(
            ['gh', 'pr', 'comment', str(pr_number), 
             '--repo', repo, 
             '--body', body],
            capture_output=True,
            text=True
        )
        if result.returncode != 0:
            print(f"Error posting comment: {result.stderr}")
            return False
        print(f"Comment posted successfully to {repo}#{pr_number}")
        return True
    except FileNotFoundError:
        print("Error: GitHub CLI (gh) not found. Install from https://cli.github.com/")
        return False


def post_comment_api(repo: str, pr_number: int, body: str, token: str) -> bool:
    """Post comment using GitHub API directly."""
    import urllib.request
    import urllib.error
    
    url = f"https://api.github.com/repos/{repo}/issues/{pr_number}/comments"
    
    data = json.dumps({"body": body}).encode('utf-8')
    
    req = urllib.request.Request(url, data=data, method='POST')
    req.add_header('Authorization', f'token {token}')
    req.add_header('Accept', 'application/vnd.github.v3+json')
    req.add_header('Content-Type', 'application/json')
    
    try:
        with urllib.request.urlopen(req) as response:
            if response.status == 201:
                print(f"Comment posted successfully to {repo}#{pr_number}")
                return True
            else:
                print(f"Unexpected status: {response.status}")
                return False
    except urllib.error.HTTPError as e:
        print(f"Error posting comment: {e.code} {e.reason}")
        print(e.read().decode())
        return False


def main():
    parser = argparse.ArgumentParser(description='Post PR review comment')
    parser.add_argument('--pr-number', type=int, required=True, help='PR number')
    parser.add_argument('--repo', type=str, required=True, help='Repository (owner/repo)')
    parser.add_argument('--results', type=str, required=True, help='Path to consensus_results.json')
    parser.add_argument('--dry-run', action='store_true', help='Print comment instead of posting')
    args = parser.parse_args()
    
    # Load results
    results_path = Path(args.results)
    if not results_path.exists():
        print(f"Error: Results file not found: {args.results}")
        sys.exit(1)
    
    with open(results_path) as f:
        results = json.load(f)
    
    comment_body = results.get('comment_body', '')
    
    if not comment_body:
        print("No comment body found in results")
        sys.exit(1)
    
    if args.dry_run:
        print("DRY RUN - Would post the following comment:")
        print("=" * 50)
        print(comment_body)
        print("=" * 50)
        return 0
    
    # Try GitHub CLI first, fall back to API
    token = os.environ.get('GITHUB_TOKEN')
    
    # Check if gh is available and authenticated
    try:
        result = subprocess.run(['gh', 'auth', 'status'], capture_output=True)
        if result.returncode == 0:
            if post_comment_gh_cli(args.repo, args.pr_number, comment_body):
                return 0
    except FileNotFoundError:
        pass
    
    # Fall back to API
    if token:
        if post_comment_api(args.repo, args.pr_number, comment_body, token):
            return 0
    else:
        print("Error: Neither gh CLI nor GITHUB_TOKEN available")
        print("Either authenticate with 'gh auth login' or set GITHUB_TOKEN env var")
        sys.exit(1)
    
    sys.exit(1)


if __name__ == '__main__':
    sys.exit(main())

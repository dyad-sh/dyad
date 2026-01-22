# Issue Output Schema

JSON schema for the structured issue output from sub-agents.

## Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "array",
  "items": {
    "type": "object",
    "required": [
      "file",
      "line_start",
      "severity",
      "category",
      "title",
      "description"
    ],
    "properties": {
      "file": {
        "type": "string",
        "description": "Relative path to the file containing the issue"
      },
      "line_start": {
        "type": "integer",
        "minimum": 1,
        "description": "Starting line number of the issue"
      },
      "line_end": {
        "type": "integer",
        "minimum": 1,
        "description": "Ending line number (defaults to line_start if single line)"
      },
      "severity": {
        "type": "string",
        "enum": ["HIGH", "MEDIUM", "LOW"],
        "description": "Criticality level of the issue"
      },
      "category": {
        "type": "string",
        "enum": [
          "security",
          "logic",
          "performance",
          "error-handling",
          "style",
          "other"
        ],
        "description": "Category of the issue"
      },
      "title": {
        "type": "string",
        "maxLength": 100,
        "description": "Brief, descriptive title for the issue"
      },
      "description": {
        "type": "string",
        "description": "Detailed explanation of the issue and its impact"
      },
      "suggestion": {
        "type": "string",
        "description": "Optional suggestion for how to fix the issue"
      }
    }
  }
}
```

## Example Output

```json
[
  {
    "file": "src/auth/login.py",
    "line_start": 45,
    "line_end": 48,
    "severity": "HIGH",
    "category": "security",
    "title": "SQL injection vulnerability in user lookup",
    "description": "User input is directly interpolated into SQL query without parameterization. An attacker could inject malicious SQL to bypass authentication or extract data.",
    "suggestion": "Use parameterized queries: cursor.execute('SELECT * FROM users WHERE username = ?', (username,))"
  },
  {
    "file": "src/utils/cache.py",
    "line_start": 112,
    "line_end": 112,
    "severity": "MEDIUM",
    "category": "error-handling",
    "title": "Missing exception handling for cache connection failure",
    "description": "If Redis connection fails, the exception propagates and crashes the request handler. Cache failures should be handled gracefully with fallback to direct database queries.",
    "suggestion": "Wrap cache operations in try/except and fall back to database on failure"
  }
]
```

## Consensus Output

After aggregation, issues include additional metadata:

```json
{
  "file": "src/auth/login.py",
  "line_start": 45,
  "line_end": 48,
  "severity": "HIGH",
  "category": "security",
  "title": "SQL injection vulnerability in user lookup",
  "description": "...",
  "suggestion": "...",
  "consensus_count": 3,
  "all_severities": ["HIGH", "HIGH", "MEDIUM"]
}
```

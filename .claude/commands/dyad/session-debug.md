# Session Debug

Analyze session debugging data to identify errors and issues that may have caused a user-reported problem.

## Arguments

- `$ARGUMENTS`: Two space-separated arguments expected:
  1. URL to a JSON file containing session debugging data (starts with `http://` or `https://`)
  2. GitHub issue number or URL

## Instructions

1. **Parse and validate the arguments:**

   Split `$ARGUMENTS` on whitespace to get exactly two arguments:
   - First argument: session data URL (must start with `http://` or `https://`)
   - Second argument: GitHub issue identifier (number like `123` or full URL like `https://github.com/owner/repo/issues/123`)

   **Validation:** If fewer than two arguments are provided, inform the user:

   > "Usage: /dyad:session-debug <session-data-url> <issue-number-or-url>"
   > "Example: /dyad:session-debug https://example.com/session.json 123"

   Then stop execution.

2. **Fetch the GitHub issue:**

   ```
   gh issue view <issue-number> --json title,body,comments,labels
   ```

   Understand:
   - What problem the user is reporting
   - Steps to reproduce (if provided)
   - Expected vs actual behavior
   - Any error messages the user mentioned

3. **Fetch the session debugging data:**

   Use `WebFetch` to retrieve the JSON session data from the provided URL.

4. **Analyze the session data:**

   Look for suspicious entries including:
   - **Errors**: Any error messages, stack traces, or exception logs
   - **Warnings**: Warning-level log entries that may indicate problems
   - **Failed requests**: HTTP errors, timeout failures, connection issues
   - **Unexpected states**: Null values where data was expected, empty responses
   - **Timing anomalies**: Unusually long operations, timeouts
   - **User actions before failure**: What the user did leading up to the issue

5. **Correlate with the reported issue:**

   For each suspicious entry found, assess:
   - Does the timing match when the user reported the issue occurring?
   - Does the error message relate to the feature/area the user mentioned?
   - Could this error cause the symptoms the user described?

6. **Rank the findings:**

   Create a ranked list of potential causes, ordered by likelihood:

   ```
   ## Most Likely Causes

   ### 1. [Error/Issue Name]
   - **Evidence**: What was found in the session data
   - **Timestamp**: When it occurred
   - **Correlation**: How it relates to the reported issue
   - **Confidence**: High/Medium/Low

   ### 2. [Error/Issue Name]
   ...
   ```

7. **Provide recommendations:**

   For each high-confidence finding, suggest:
   - Where in the codebase to investigate
   - Potential root causes
   - Suggested fixes if apparent

8. **Summarize:**
   - Total errors/warnings found
   - Top 3 most likely causes
   - Recommended next steps for investigation

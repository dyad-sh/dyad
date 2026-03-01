---
name: coney:feedback-to-issues
description: Turn customer feedback (usually an email) into discrete GitHub issues. Checks for duplicates, proposes new issues for approval, creates them, and drafts a reply email.
---

# Feedback to Issues

Turn customer feedback (usually an email) into discrete GitHub issues. Checks for duplicates, proposes new issues for approval, creates them, and drafts a reply email.

## Arguments

- `$ARGUMENTS`: The customer feedback text (email body, support ticket, etc.). Can also be a file path to a text file containing the feedback.

## Instructions

1. **Parse the feedback:**

   Read `$ARGUMENTS` carefully. If it looks like a file path, read the file contents.

   Break the feedback down into discrete, actionable issues. For each issue, identify:
   - A concise title (imperative form, e.g., "Add dark mode support")
   - The type: `bug`, `feature`, `improvement`, or `question`
   - A clear description of what the customer is reporting or requesting
   - Severity/priority estimate: `high`, `medium`, or `low`
   - Any relevant quotes from the original feedback

   Ignore pleasantries, greetings, and non-actionable commentary. Focus on extracting concrete problems, requests, and suggestions.

2. **Search for existing issues:**

   For each discrete issue identified, search GitHub for existing issues that may already cover it:

   ```bash
   gh issue list --repo "$(gh repo view --json nameWithOwner -q '.nameWithOwner')" --state all --search "<relevant keywords>" --limit 10 --json number,title,state,url
   ```

   Try multiple keyword variations for each issue to avoid missing duplicates. Search both open and closed issues.

3. **Present the report to the user:**

   Format the report in three sections:

   ### Already Filed Issues

   For each issue that already has a matching GitHub issue, show:
   - The extracted issue title
   - The matching GitHub issue(s) with number, title, state (open/closed), and URL
   - Brief explanation of why it matches

   ### Proposed New Issues

   For each issue that does NOT have an existing match, show:
   - **Title**: The proposed issue title
   - **Type**: bug / feature / improvement / question
   - **Priority**: high / medium / low
   - **Body preview**: The proposed issue body (include the relevant customer quote and a clear description of what needs to happen)
   - **Labels**: Suggest appropriate labels based on the issue type

   ### Summary
   - Total issues extracted from feedback: N
   - Already filed: N
   - New issues to create: N

   **Then ask the user to review and approve the proposal before proceeding.** Do NOT create any issues yet. Wait for explicit approval. The user may want to edit titles, descriptions, priorities, or skip certain issues.

4. **Create approved issues:**

   After the user approves (they may request modifications first — apply those), create each approved issue:

   ```bash
   gh issue create --title "<title>" --body "<body>" --label "<labels>"
   ```

   Report back each created issue with its number and URL.

5. **Draft a reply email:**

   After all issues are created, draft a brief, professional reply email for the customer. The email should:
   - Thank them for their feedback
   - Briefly acknowledge each item they raised
   - For items that already had existing issues: mention it's already being tracked
   - For newly created issues: mention it's been filed and will be looked into
   - Keep it concise — no more than a few short paragraphs
   - Use a friendly but professional tone
   - Include a link to the GitHub issue URL for each item so the customer can follow progress
   - End with an invitation to share more feedback anytime

   Present the draft email to the user for review before they send it.

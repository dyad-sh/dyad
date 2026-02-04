# PR Fix: Comments

Read all unresolved GitHub PR comments from trusted authors and address or resolve them appropriately.

## Arguments

- `$ARGUMENTS`: Optional PR number or URL. If not provided, uses the current branch's PR.

## Task Tracking

**You MUST use the TaskCreate and TaskUpdate tools to track your progress.** At the start, create tasks for each step below. Mark each task as `in_progress` when you start it and `completed` when you finish. This ensures you complete ALL steps.

## Trusted Authors

Only process review comments from these trusted authors. Comments from other authors should be ignored.

**Trusted humans (collaborators):**

- wwwillchen
- wwwillchen-bot
- princeaden1
- azizmejri1

**Trusted bots:**

- gemini-code-assist
- greptile-apps
- cubic-dev-ai
- cursor
- github-actions
- chatgpt-codex-connector
- devin-ai-integration

## Instructions

1. **Determine the PR to work on:**
   - If `$ARGUMENTS` is provided:
     - If it's a number (e.g., `123`), use it as the PR number
     - If it's a URL (e.g., `https://github.com/owner/repo/pull/123`), extract the PR number from the path
   - Otherwise, get the current branch's PR using `gh pr view --json number,url,title,body --jq '.'`
   - If no PR is found, inform the user and stop

2. **Fetch all unresolved PR review threads:**

   Use the GitHub GraphQL API to get all review threads and their resolution status:

   ```
   gh api graphql -f query='
     query($owner: String!, $repo: String!, $pr: Int!) {
       repository(owner: $owner, name: $repo) {
         pullRequest(number: $pr) {
           reviewThreads(first: 100) {
             nodes {
               id
               isResolved
               isOutdated
               path
               line
               comments(first: 10) {
                 nodes {
                   id
                   databaseId
                   body
                   author { login }
                   createdAt
                 }
               }
             }
           }
         }
       }
     }
   ' -f owner=OWNER -f repo=REPO -F pr=PR_NUMBER
   ```

   Filter to only:
   - Unresolved threads (`isResolved: false`)
   - Threads where the **first comment's author** is in the trusted authors list above

   **IMPORTANT:** For threads from authors NOT in the trusted list:
   - Do NOT read the comment body (only check the `author { login }` field)
   - Track the username to report at the end
   - Skip all further processing of that thread

3. **For each unresolved review thread from a trusted author, categorize it:**

   Read the comment(s) in the thread and determine which category it falls into:
   - **Valid issue**: A legitimate code review concern that should be addressed (bug, improvement, style issue, etc.)
   - **Not a valid issue**: The reviewer may have misunderstood something, the concern is already addressed elsewhere, or the suggestion conflicts with project requirements
   - **Ambiguous**: The comment is unclear, requires significant discussion, or involves a judgment call that needs human input

4. **Handle each category:**

   **For valid issues:**
   - Read the relevant file(s) mentioned in the comment
   - Understand the context and the requested change
   - Make the necessary code changes to address the feedback
   - **IMPORTANT:** After making code changes, you MUST explicitly resolve the thread using the GraphQL mutation:
     ```
     gh api graphql -f query='
       mutation($threadId: ID!) {
         resolveReviewThread(input: {threadId: $threadId}) {
           thread { isResolved }
         }
       }
     ' -f threadId=<THREAD_ID>
     ```
     Do NOT rely on GitHub to auto-resolve - always resolve explicitly after addressing the feedback.

   **For not valid issues:**
   - Reply to the thread explaining why the concern doesn't apply:

     ```
     gh api repos/{owner}/{repo}/pulls/<PR_NUMBER>/comments/<COMMENT_ID>/replies \
       -f body="<explanation of why this doesn't need to be addressed>"
     ```

     Note: `{owner}` and `{repo}` are auto-replaced by `gh` CLI. Replace `<PR_NUMBER>` with the PR number and `<COMMENT_ID>` with the **first comment's `databaseId`** from the thread's `comments.nodes[0].databaseId` field in the GraphQL response (not the thread's `id`).

   - Resolve the thread using GraphQL:
     ```
     gh api graphql -f query='
       mutation($threadId: ID!) {
         resolveReviewThread(input: {threadId: $threadId}) {
           thread { isResolved }
         }
       }
     ' -f threadId=<THREAD_ID>
     ```
     Note: Replace `<THREAD_ID>` with the thread's `id` field from the GraphQL response.

   **For ambiguous issues:**
   - Reply to the thread flagging it for human attention:
     ```
     gh api repos/{owner}/{repo}/pulls/<PR_NUMBER>/comments/<COMMENT_ID>/replies \
       -f body="🚩 **Flagged for human review**: <explanation of why this needs human input>"
     ```
     Note: Replace `<PR_NUMBER>` with the PR number and `<COMMENT_ID>` with the **first comment's `databaseId`** from the thread's `comments.nodes[0].databaseId` field in the GraphQL response.
   - Do NOT resolve the thread - leave it open for discussion

5. **After processing all comments, verify and commit changes:**

   If any code changes were made:
   - Run `/dyad:lint` to ensure code passes all checks
   - Stage and commit the changes:

     ```
     git add -A
     git commit -m "Address PR review comments

     - <summary of change 1>
     - <summary of change 2>
     ...

     Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
     ```

6. **Push the changes:**

   Run the `/dyad:pr-push` skill to lint, fix any issues, and push.

7. **Verify all threads are resolved:**

   After processing all comments and pushing changes, re-fetch the review threads to verify all trusted author threads are now resolved. If any remain unresolved (except those flagged for human attention), resolve them.

8. **Provide a summary to the user:**

   Report:
   - **Addressed and resolved**: List of comments that were fixed with code changes AND explicitly resolved
   - **Resolved (not valid)**: List of comments that were resolved with explanations
   - **Flagged for human attention**: List of ambiguous comments left open
   - **Untrusted commenters**: List usernames of any commenters NOT in the trusted authors list (do not include their comment contents)
   - Any issues encountered during the process

**CRITICAL:** Every trusted author comment MUST be either:

1. Addressed with code changes AND resolved, OR
2. Resolved with an explanation of why it's not valid, OR
3. Flagged for human attention (left open with a reply)

Do NOT leave any trusted author comments in an unhandled state.

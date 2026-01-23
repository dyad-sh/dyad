# PR Fix: Comments

Read all unresolved GitHub PR comments and address or resolve them appropriately.

## Arguments

- `$ARGUMENTS`: Optional PR number or URL. If not provided, uses the current branch's PR.

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

   Filter to only unresolved threads (`isResolved: false`).

3. **For each unresolved review thread, categorize it:**

   Read the comment(s) in the thread and determine which category it falls into:
   - **Valid issue**: A legitimate code review concern that should be addressed (bug, improvement, style issue, etc.)
   - **Not a valid issue**: The reviewer may have misunderstood something, the concern is already addressed elsewhere, or the suggestion conflicts with project requirements
   - **Ambiguous**: The comment is unclear, requires significant discussion, or involves a judgment call that needs human input

4. **Handle each category:**

   **For valid issues:**
   - Read the relevant file(s) mentioned in the comment
   - Understand the context and the requested change
   - Make the necessary code changes to address the feedback
   - The thread will be marked as resolved when the code is pushed (GitHub auto-resolves when the code changes)

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

7. **Provide a summary to the user:**

   Report:
   - **Addressed**: List of comments that were fixed with code changes
   - **Resolved (not valid)**: List of comments that were resolved with explanations
   - **Flagged for human attention**: List of ambiguous comments left open
   - Any issues encountered during the process

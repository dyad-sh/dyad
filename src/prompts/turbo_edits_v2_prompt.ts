export const TURBO_EDITS_V2_SYSTEM_PROMPT = `
## Search-replace file edits

Request to apply PRECISE, TARGETED modifications to an existing file by searching for specific sections of content and replacing them. This tool is for SURGICAL EDITS ONLY - specific changes to existing code.
You can perform multiple distinct search and replace operations within a single \`dyad-search-replace\` call by providing multiple SEARCH/REPLACE blocks in the \`diff\` parameter. This is the preferred way to make several targeted changes efficiently.
The SEARCH section must exactly match existing content including whitespace and indentation.
When applying the diffs, be extra careful to remember to change any closing brackets or other syntax that may be affected by the diff farther down in the file.
ALWAYS make as many changes in a single 'dyad-search-replace' call as possible using multiple SEARCH/REPLACE blocks.

Diff format:
\`\`\`
<<<<<<< SEARCH
:start_line: (required) The line number of original content where the search block starts.
-------
[exact content to find including whitespace]
=======
[new content to replace with]
>>>>>>> REPLACE
\`\`\`

Example:

Original file:
\`\`\`
1 | def calculate_total(items):
2 |     total = 0
3 |     for item in items:
4 |         total += item
5 |     return total
\`\`\`

Search/Replace content:
\`\`\`
<<<<<<< SEARCH
:start_line:1
-------
def calculate_total(items):
    total = 0
    for item in items:
        total += item
    return total
=======
def calculate_total(items):
    """Calculate total with 10% markup"""
    return sum(item * 1.1 for item in items)
>>>>>>> REPLACE

\`\`\`

Search/Replace content with multiple edits:
\`\`\`
<<<<<<< SEARCH
:start_line:1
-------
def calculate_total(items):
    sum = 0
=======
def calculate_sum(items):
    sum = 0
>>>>>>> REPLACE

<<<<<<< SEARCH
:start_line:4
-------
        total += item
    return total
=======
        sum += item
    return sum 
>>>>>>> REPLACE
\`\`\`


Usage:
<dyad-search-replace path="path/to/file.js">
<<<<<<< SEARCH
:start_line:1
-------
def calculate_total(items):
    sum = 0
=======
def calculate_sum(items):
    sum = 0
>>>>>>> REPLACE

<<<<<<< SEARCH
:start_line:4
-------
        total += item
    return total
=======
        sum += item
    return sum 
>>>>>>> REPLACE
</dyad-search-replace>

`;

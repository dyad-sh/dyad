// This approach is inspired by Roo Code
// https://github.com/RooCodeInc/Roo-Code/blob/fceb4130478b20de2bc854c8dd0aad743f844b53/src/core/diff/strategies/multi-search-replace.ts#L4
// but we've modified it to be simpler and not rely on line numbers.
//
// Also, credit to https://aider.chat/ for popularizing this approach

export const TURBO_EDITS_V2_SYSTEM_PROMPT = `

# Search-replace file edits

- Request to apply PRECISE, TARGETED modifications to an existing file by searching for specific sections of content and replacing them. This tool is for SURGICAL EDITS ONLY - specific changes to existing code.
- You can perform multiple distinct search and replace operations within a single \`dyad-search-replace\` call by providing multiple SEARCH/REPLACE blocks. This is the preferred way to make several targeted changes efficiently.
- The SEARCH section must match exactly ONE existing content section - it must be unique within the file, including whitespace and indentation.
- When applying the diffs, be extra careful to remember to change any closing brackets or other syntax that may be affected by the diff farther down in the file.
- ALWAYS make as many changes in a single 'dyad-search-replace' call as possible using multiple SEARCH/REPLACE blocks.
- Do not use both \`dyad-write\` and \`dyad-search-replace\` on the same file within a single response.
- Include a brief description of the changes you are making in the \`description\` parameter.

Diff format:
\`\`\`
<<<<<<< SEARCH
[exact content to find including whitespace]
=======
[new content to replace with]
>>>>>>> REPLACE
\`\`\`

Example:

Original file:
\`\`\`
def calculate_total(items):
    total = 0
    for item in items:
        total += item
    return total
\`\`\`

Search/Replace content:
\`\`\`
<<<<<<< SEARCH
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
def calculate_total(items):
    sum = 0
=======
def calculate_sum(items):
    sum = 0
>>>>>>> REPLACE

<<<<<<< SEARCH
        total += item
    return total
=======
        sum += item
    return sum
>>>>>>> REPLACE
\`\`\`


Usage:
<dyad-search-replace path="path/to/file.js" description="Brief description of the changes you are making">
<<<<<<< SEARCH
def calculate_total(items):
    sum = 0
=======
def calculate_sum(items):
    sum = 0
>>>>>>> REPLACE

<<<<<<< SEARCH
        total += item
    return total
=======
        sum += item
    return sum
>>>>>>> REPLACE
</dyad-search-replace>

`;

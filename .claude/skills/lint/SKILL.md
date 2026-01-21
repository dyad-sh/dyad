---
name: lint
description: Run TypeScript checks, Prettier formatting, and ESLint to find and fix code quality issues
---

# Lint and Fix Code

Run all linting checks and fix any errors found.

## Process

1. **Run TypeScript check**: Execute `npm run ts` to find type errors
2. **Run Prettier**: Execute `npm run prettier` to check formatting issues
3. **Run ESLint**: Execute `npm run lint` to find linting violations
4. **Fix all errors**: For each error found:
   - Read the relevant file
   - Apply the appropriate fix
   - Re-run the check to verify the fix worked
5. **Iterate**: Continue until all checks pass cleanly

## Commands

- `npm run ts` - TypeScript type checking
- `npm run prettier` - Prettier formatting check
- `npm run lint` - ESLint code linting

## Important

- Fix errors one at a time, verifying each fix before moving on
- For formatting issues, you may run `npm run prettier -- --write` if available
- For lint issues with auto-fix support, you may run `npm run lint -- --fix` if available
- Re-run all three checks at the end to ensure everything passes

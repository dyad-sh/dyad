# Lint

Run pre-commit checks including formatting, linting, and type-checking, and fix any errors.

## Instructions

1. **Run formatting check and fix:**

   ```
   npm run fmt
   ```

   This will automatically fix any formatting issues.

2. **Run linting with auto-fix:**

   ```
   npm run lint:fix
   ```

   This will fix any auto-fixable lint errors.

3. **Fix remaining lint errors manually:**

   If there are lint errors that could not be auto-fixed, read the affected files and fix the errors manually. Common issues include:
   - Unused variables or imports (remove them)
   - Missing return types (add them)
   - Any other ESLint rule violations

4. **Run type-checking:**

   ```
   npm run ts
   ```

5. **Fix any type errors:**

   If there are type errors, read the affected files and fix them. Common issues include:
   - Type mismatches (correct the types)
   - Missing type annotations (add them)
   - Null/undefined handling issues (add appropriate checks)

6. **Re-run all checks to verify:**

   After making manual fixes, re-run the checks to ensure everything passes:

   ```
   npm run fmt && npm run lint && npm run ts
   ```

7. **Summarize the results:**
   - Report which checks passed
   - List any fixes that were made manually
   - If any errors could not be fixed, explain why and ask the user for guidance
   - If all checks pass, confirm the code is ready to commit

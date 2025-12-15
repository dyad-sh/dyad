#!/bin/bash

echo "=========================================="
echo "Deploying File Saving Improvements"
echo "=========================================="
echo ""

# Check if there are changes to commit
if [[ -z $(git status -s) ]]; then
    echo "✅ No changes to commit"
else
    echo "📝 Changes detected, committing..."
    git add -A
    git commit -m "feat: Complete file saving improvements

- Enhanced Next.js system prompt with explicit format requirements
- Added detailed logging to chatSSE with visual separators
- Improved error messages to distinguish NO_FILES vs MISSING_PACKAGE_JSON
- Updated frontend error handling with emojis and helpful suggestions
- Added @ts-ignore for templateId until migration runs
- Copied templates.ts to server directory"
    
    echo "✅ Changes committed"
fi

echo ""
echo "🚀 Pushing to remote..."
git push origin main

echo ""
echo "=========================================="
echo "✅ Deployment Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Wait for the server to rebuild (check Coolify/deployment logs)"
echo "2. Test by creating a new app"
echo "3. Check server logs for:"
echo "   - [SSE] ========== FILE PARSING DEBUG =========="
echo "   - [SSE] Parsed X files"
echo ""
echo "Test command:"
echo "  Create app and send: 'crée une app Next.js simple'"
echo ""

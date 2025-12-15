#!/bin/bash

echo "=== Diagnostic: Template System Prompts ==="
echo ""

echo "1. Checking if templates.ts exists in server..."
if [ -f "server/src/shared/templates.ts" ]; then
    echo "✅ server/src/shared/templates.ts exists"
    echo "   File size: $(wc -c < server/src/shared/templates.ts) bytes"
else
    echo "❌ server/src/shared/templates.ts NOT FOUND"
fi

echo ""
echo "2. Checking if templateUtils.ts exists..."
if [ -f "server/src/utils/templateUtils.ts" ]; then
    echo "✅ server/src/utils/templateUtils.ts exists"
    cat server/src/utils/templateUtils.ts | grep "import.*templates"
else
    echo "❌ server/src/utils/templateUtils.ts NOT FOUND"
fi

echo ""
echo "3. Checking recent server logs for template loading..."
echo "   (Looking for 'Using template system prompt')"
echo ""
echo "Run this on your server:"
echo "docker logs dyad-container-name 2>&1 | grep -i 'template' | tail -20"
echo ""
echo "4. Test code block parsing..."
echo "   Create a test file to verify parseCodeBlocks works:"
echo ""
echo "=== End Diagnostic ==="

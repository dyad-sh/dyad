#!/bin/bash
# Regenerate iOS platform with CocoaPods for Ionic Appflow compatibility

set -e

echo "Removing existing iOS platform..."
rm -rf ios/

echo "Adding iOS platform with CocoaPods..."
# Set environment variable to force CocoaPods
export CAPACITOR_COCOAPODS=1
npx cap add ios

echo "iOS platform regenerated successfully"
echo "Next steps:"
echo "1. Commit the changes: git add ios/ && git commit -m 'fix: regenerate iOS with CocoaPods'"
echo "2. Push to trigger Appflow build: git push"

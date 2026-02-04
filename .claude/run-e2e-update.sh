#!/bin/bash
# Run e2e tests with snapshot update
export PLAYWRIGHT_HTML_OPEN=never
cd "$(dirname "$0")/.."
npx playwright test --update-snapshots --reporter=line
